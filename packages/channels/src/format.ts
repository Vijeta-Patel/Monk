// Pure text helpers shared by the gateway and the adapters. No network, no state.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inlineToHtml(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `<b>${inlineToHtml(heading[1] ?? '')}</b>`;
  let out = '';
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    out += escapeHtml(line.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<b>${escapeHtml(m[2])}</b>`;
    else out += `<a href="${escapeAttr(m[4] ?? '')}">${escapeHtml(m[3] ?? '')}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(line.slice(last));
}

function preBlock(code: string[], lang: string): string {
  const body = escapeHtml(code.join('\n'));
  return /^[\w+-]+$/.test(lang) ? `<pre><code class="language-${lang}">${body}</code></pre>` : `<pre>${body}</pre>`;
}

/**
 * Monk's markdown subset → Telegram HTML parse mode. Everything that is not markup is escaped,
 * and an unclosed fence (mid-stream) still renders as a code block.
 */
export function mdToTelegramHtml(md: string): string {
  const res: string[] = [];
  let code: string[] | null = null;
  let lang = '';
  for (const line of md.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('```')) {
      if (code === null) {
        code = [];
        lang = t.slice(3).trim();
      } else {
        res.push(preBlock(code, lang));
        code = null;
      }
      continue;
    }
    if (code !== null) code.push(line);
    else res.push(inlineToHtml(line));
  }
  if (code !== null) res.push(preBlock(code, lang));
  return res.join('\n');
}

/** Strips Monk markdown to plain text (fallback when a platform rejects formatting). */
export function mdToPlain(md: string): string {
  return md
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('```'))
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
}

function fenceStateAfter(piece: string, opener: string | null): string | null {
  let open = opener;
  for (const line of piece.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('```')) open = open ? null : t.trimEnd();
  }
  return open;
}

function cutPoint(s: string, budget: number): number {
  const window = s.slice(0, budget);
  const para = window.lastIndexOf('\n\n');
  if (para > budget * 0.5) return para;
  const line = window.lastIndexOf('\n');
  if (line > budget * 0.3) return line;
  const space = window.lastIndexOf(' ');
  if (space > budget * 0.3) return space;
  return budget;
}

/**
 * Splits text into chunks of at most `limit` chars at paragraph, line or word boundaries. A code
 * fence cut in two is closed at the end of one chunk and reopened (with its language) in the next.
 */
export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  let opener: string | null = null;
  while (rest.length > 0) {
    const prefix = opener ? `${opener}\n` : '';
    if (prefix.length + rest.length <= limit) {
      out.push(prefix + rest);
      break;
    }
    const budget = Math.max(16, limit - prefix.length - 4);
    const cut = cutPoint(rest, budget);
    const piece = rest.slice(0, cut).replace(/\s+$/, '');
    rest = rest.slice(cut).replace(/^\s*\n/, '').replace(/^ /, '');
    const open = fenceStateAfter(piece, opener);
    out.push(prefix + piece + (open ? '\n```' : ''));
    opener = open;
  }
  return out.filter((c) => c.trim().length > 0);
}

/** Longest fenced code block, in chars (an unclosed fence counts to the end). */
export function longestCodeBlock(text: string): number {
  let longest = 0;
  let start = -1;
  let len = 0;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (start < 0) {
        start = 0;
        len = 0;
      } else {
        longest = Math.max(longest, len);
        start = -1;
      }
      continue;
    }
    if (start >= 0) len += line.length + 1;
  }
  if (start >= 0) longest = Math.max(longest, len);
  return longest;
}

/** Keeps the end of `text` within `limit`, cut at a line boundary, for live previews. */
export function tailOf(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = limit - 2;
  let tail = text.slice(text.length - room);
  const nl = tail.indexOf('\n');
  if (nl >= 0 && nl < room * 0.5) tail = tail.slice(nl + 1);
  return `…\n${tail}`;
}

/** First ~n chars, cut at a paragraph or line when possible. */
export function headOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const window = text.slice(0, n);
  const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
  const head = cut > n * 0.4 ? window.slice(0, cut) : window;
  // Don't leave a dangling fence in the preview.
  return fenceStateAfter(head, null) ? `${head}\n\`\`\`` : `${head.trimEnd()} …`;
}

export function fmtDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** `merge_pull_request` / `github__mergePullRequest` → "merge pull request". */
export function humanizeTool(name: string): string {
  const base = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name;
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words || 'tool';
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/**
 * What a tool call will touch, parsed from its JSON args: repo, PR, branch, tag, app and friends.
 * Identifiers are shown in full (exact where it matters); free text is clipped.
 */
export function toolTargets(name: string, args: string): { label: string; value: string }[] {
  const obj = safeJson(args);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const a = obj as Record<string, unknown>;
  const used = new Set<string>();
  const out: { label: string; value: string }[] = [];
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = scalar(a[k]);
      if (v !== null) {
        used.add(k);
        return v;
      }
    }
    return null;
  };
  const add = (label: string, keys: string[], fmt: (v: string) => string = (v) => v) => {
    const v = pick(keys);
    if (v !== null) out.push({ label, value: fmt(v) });
  };

  const owner = pick(['owner', 'org', 'organization']);
  const repo = pick(['repo', 'repository', 'full_name', 'repo_name', 'repoName']);
  if (owner && repo) out.push({ label: 'repo', value: repo.includes('/') ? repo : `${owner}/${repo}` });
  else if (repo) out.push({ label: 'repo', value: repo });
  else if (owner) out.push({ label: 'owner', value: owner });

  const isPr = /pull|(^|_)pr(_|$)|merge/i.test(name);
  const hash = (v: string) => (/^\d+$/.test(v) ? `#${v}` : v);
  add('pr', ['pull_number', 'pullNumber', 'pr_number', 'prNumber', 'pr'], hash);
  add('issue', ['issue_number', 'issueNumber'], hash);
  add(isPr ? 'pr' : 'issue', ['number'], hash);
  add('branch', ['branch', 'branch_name', 'ref']);
  add('from', ['head']);
  add('into', ['base']);
  add('tag', ['tag', 'tag_name', 'tagName', 'version']);
  add('app', ['app', 'package', 'packageName', 'package_name', 'bundleId', 'bundle_id', 'appId', 'app_id']);
  add('sha', ['sha', 'commit_sha', 'commit_id', 'commitSha']);
  add('method', ['merge_method', 'mergeMethod']);
  add('path', ['path', 'file', 'file_path']);
  add('title', ['title', 'name'], (v) => clip(v, 80));

  let extras = 0;
  for (const [k, v] of Object.entries(a)) {
    if (used.has(k) || extras >= 3) continue;
    const s = scalar(v);
    if (s === null) continue;
    out.push({ label: k.replace(/_/g, ' ').toLowerCase(), value: clip(s, 60) });
    extras++;
  }
  return out;
}

/** One-line reason from an MCP error body (`{"error": ...}`) or raw text. */
export function errorSummary(content: string, max = 48): string {
  const parsed = safeJson(content);
  let msg = content;
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const e = (parsed as { error: unknown }).error;
    if (typeof e === 'string') msg = e;
    else if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
      msg = (e as { message: string }).message;
    } else msg = JSON.stringify(e);
  }
  return clip(msg.split('\n')[0] ?? '', max).toLowerCase();
}

/** Aligned `label  value` rows, for use inside a code fence. */
export function table(rows: { label: string; value: string }[]): string {
  const w = Math.max(0, ...rows.map((r) => r.label.length));
  return rows.map((r) => `${r.label.padEnd(w)}  ${r.value}`).join('\n');
}

const TIME_FMT = new Map<string, Intl.DateTimeFormat>();

export function clockTime(date: Date, timeZone: string): string {
  let f = TIME_FMT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    TIME_FMT.set(timeZone, f);
  }
  return f.format(date);
}

export function dateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
