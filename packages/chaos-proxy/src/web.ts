import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Web search and fetch for Monk. Stock TrueForge's built-in web_search needs a Parallel key and
 * TrueFoundry mode, so standalone Monk brings its own: DuckDuckGo's HTML endpoint (no key), or Tavily
 * when TAVILY_API_KEY is set.
 */

export type SearchResult = { title: string; url: string; snippet: string };

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_FETCH_CHARS = 20_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k]!;
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return m;
    });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<url>; unwrap them. */
function unwrapDdg(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  return decodeEntities(m ? decodeURIComponent(m[1]!) : href);
}

export function parseDuckDuckGo(html: string, limit = 8): SearchResult[] {
  const out: SearchResult[] = [];
  // One chunk per result: each starts at its title link and runs to the next one.
  for (const chunk of html.split(/(?=<a[^>]*class="result__a")/).slice(1)) {
    const link = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    if (!link) continue;
    const url = unwrapDdg(link[1]!);
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1] ?? '';
    out.push({ title: stripTags(link[2]!), url, snippet: stripTags(snippet) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function webSearch(query: string, opts: { fetchImpl?: typeof fetch; tavilyKey?: string } = {}): Promise<SearchResult[]> {
  const f = opts.fetchImpl ?? fetch;
  if (opts.tavilyKey) {
    const res = await f('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.tavilyKey}` },
      body: JSON.stringify({ query, max_results: 8 }),
    });
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
  }
  const res = await f('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return parseDuckDuckGo(await res.text());
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Refuses anything but public http(s): the agent must not reach this machine's services through it. */
export async function assertPublicUrl(raw: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((r) => r.address)): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new Error('refusing a local address');
  const addrs = isIP(host) ? [host] : await resolve(host);
  if (addrs.some(isPrivateAddress)) throw new Error('refusing a private or local address');
  return url;
}

export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return title ? `# ${stripTags(title)}\n\n${text}` : text;
}

export async function webFetch(raw: string, opts: { fetchImpl?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {}): Promise<string> {
  let url = await assertPublicUrl(raw, opts.resolve);
  const f = opts.fetchImpl ?? fetch;
  // Follow redirects by hand so each hop is checked too.
  for (let hop = 0; hop < 5; hop++) {
    const res = await f(url, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20_000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await assertPublicUrl(new URL(loc, url).toString(), opts.resolve);
      continue;
    }
    if (!res.ok) throw new Error(`fetch ${url.hostname}: ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text|json|xml/.test(type)) throw new Error(`fetch ${url.hostname}: unsupported content type ${type}`);
    const body = await res.text();
    const text = /html/.test(type) ? htmlToText(body) : body;
    return text.length > MAX_FETCH_CHARS ? `${text.slice(0, MAX_FETCH_CHARS)}\n\n[truncated at ${MAX_FETCH_CHARS} characters]` : text;
  }
  throw new Error('too many redirects');
}
