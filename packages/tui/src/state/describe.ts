// Plain words for tool calls and faults. Tool names and raw arguments stay one ctrl+o away.
import { truncate } from '../render/text.ts';

export type Described = { doing: string; done: string; sandbox: boolean; owner?: string };

function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

const WORDS: Record<string, string> = { pr: 'PR', prs: 'PRs', pull: 'PR', pulls: 'PRs', repo: 'repo', apk: 'apk' };

function humanize(name: string): string {
  return name
    .replace(/^mobile_/, '')
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((w) => WORDS[w.toLowerCase()] ?? w.toLowerCase())
    .join(' ');
}

function pastTense(verb: string): string {
  const irregular: Record<string, string> = {
    get: 'got', read: 'read', run: 'ran', make: 'made', find: 'found', take: 'took', write: 'wrote', send: 'sent', build: 'built', set: 'set', put: 'put',
  };
  if (irregular[verb]) return irregular[verb];
  if (verb.endsWith('e')) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  return `${verb}ed`;
}

export function gerund(verb: string): string {
  const irregular: Record<string, string> = { run: 'running', get: 'getting', set: 'setting', put: 'putting', ship: 'shipping', stop: 'stopping', plan: 'planning' };
  if (irregular[verb]) return irregular[verb];
  if (verb.endsWith('ie')) return `${verb.slice(0, -2)}ying`;
  if (verb.endsWith('e') && !verb.endsWith('ee')) return `${verb.slice(0, -1)}ing`;
  return `${verb}ing`;
}

/** Describes a tool call in plain words, present ("doing") and past ("done"). */
export function describeCall(name: string, argsJson: string): Described {
  const a = parseArgs(argsJson);
  const n = name.toLowerCase();
  const pr = str(a.pull_number ?? a.pullNumber ?? a.number);
  const cmd = str(a.command ?? a.cmd ?? a.code);
  if (n === 'exec' || n === 'sandbox_exec' || n === 'run_command' || n === 'execute_code') {
    const c = cmd ?? '';
    if (/test/i.test(c)) return { doing: 'running unit tests in the sandbox', done: 'ran the unit tests in the sandbox', sandbox: true };
    if (/assemble|build|compile|gradlew\b/i.test(c)) return { doing: 'building the app in the sandbox', done: 'built the app in the sandbox', sandbox: true };
    const short = truncate(c.split('\n')[0] ?? '', 40);
    return { doing: `running ${short} in the sandbox`, done: `ran ${short} in the sandbox`, sandbox: true };
  }
  if (n === 'create_sub_agent') {
    const who = str(a.name) ?? 'a helper';
    return { doing: `asking ${who.toLowerCase()} to help`, done: `asked ${who.toLowerCase()} to help`, sandbox: false };
  }
  if (n === 'ask_user_question') return { doing: 'waiting for your answer', done: 'you answered', sandbox: false, owner: 'you' };
  if (n.startsWith('wait')) return { doing: humanize(name), done: humanize(name), sandbox: false, owner: 'you' };
  if (n === 'get_pull_request' && pr) return { doing: `reading PR #${pr}`, done: `read PR #${pr}`, sandbox: false };
  if ((n === 'get_pull_request_files' || n === 'list_pull_request_files') && pr)
    return { doing: 'getting the changed files', done: 'got the changed files', sandbox: false };
  if (n === 'merge_pull_request' && pr) return { doing: `merging PR #${pr}`, done: `merged PR #${pr}`, sandbox: false };
  if (n === 'create_release') {
    const tag = str(a.tag_name ?? a.tag) ?? '';
    return { doing: `publishing release ${tag}`.trim(), done: `published release ${tag}`.trim(), sandbox: false };
  }
  if (n === 'create_issue') return { doing: 'filing an issue', done: 'filed an issue', sandbox: false };
  if (n === 'web_search') return { doing: `searching for ${truncate(str(a.query) ?? '', 30)}`, done: `searched for ${truncate(str(a.query) ?? '', 30)}`, sandbox: false };
  if (n === 'web_fetch') return { doing: 'reading a web page', done: 'read a web page', sandbox: false };
  if (n.startsWith('mobile_')) {
    if (n.includes('install')) return { doing: 'installing the app on the phone', done: 'installed the app on the phone', sandbox: false };
    if (n.includes('launch')) return { doing: 'opening the app', done: 'opened the app', sandbox: false };
    if (n.includes('screenshot')) return { doing: 'taking a screenshot', done: 'took a screenshot', sandbox: false };
    if (n.includes('swipe')) return { doing: `swiping ${str(a.direction) ?? ''}`.trim(), done: `swiped ${str(a.direction) ?? ''}`.trim(), sandbox: false };
    if (n.includes('click') || n.includes('tap')) return { doing: 'tapping the screen', done: 'tapped the screen', sandbox: false };
    if (n.includes('list_elements') || n.includes('elements')) return { doing: 'looking at the screen', done: 'looked at the screen', sandbox: false };
    if (n.includes('type')) return { doing: 'typing on the phone', done: 'typed on the phone', sandbox: false };
    if (n.includes('press')) return { doing: `pressing ${str(a.button) ?? 'a button'}`, done: `pressed ${str(a.button) ?? 'a button'}`, sandbox: false };
  }
  // Generic: verb_object → "verb object" / "verbed object".
  const words = humanize(name).split(' ');
  const verb = words[0] ?? name;
  const rest = words.slice(1).join(' ');
  const suffix = pr ? ` #${pr}` : '';
  return { doing: `${gerund(verb)} ${rest}${suffix}`.trim(), done: `${pastTense(verb)} ${rest}${suffix}`.trim(), sandbox: false };
}

export function serviceOf(tool: string): string {
  const t = tool.toLowerCase();
  if (t.startsWith('mobile_')) return 'the phone';
  if (/pull|issue|repo|release|commit|branch|search_code|github|gist|workflow/.test(t)) return 'GitHub';
  return 'the tool';
}

/** What a fault looks like to a person. */
export function faultPhrase(type: string, tool: string): string {
  const s = serviceOf(tool);
  const S = s.charAt(0).toUpperCase() + s.slice(1);
  switch (type) {
    case 'rate_limit':
      return `${S} said slow down`;
    case 'timeout':
      return `${S} timed out`;
    case 'server_error':
      return `${S} had a server error`;
    case 'malformed_json':
      return `${S} sent garbled data`;
    case 'schema_drift':
      return `${S} changed its answer format`;
    case 'auth_expired':
      return `the ${s.replace(/^the /, '')} login expired`;
    case 'permission_denied':
      return `${S} said no access`;
    case 'stale_data':
      return `${S} sent old data`;
    case 'partial_result':
      return `${S} sent a list cut short`;
    case 'latency_spike':
      return `${S} was very slow`;
    case 'app_crash':
      return 'the app crashed';
    case 'permission_dialog':
      return 'chaos raised a permission prompt';
    case 'popup':
      return 'chaos dropped a popup on the phone';
    case 'element_not_found':
      return "the button wasn't there";
    case 'slow_network':
      return "the phone's network crawled";
    case 'orientation_flip':
      return 'the phone rotated';
    default:
      return `${S} failed · ${type}`;
  }
}

/** One-line meaning of each fault, in the order the slash list offers them. */
export const FAULT_HELP: [string, string][] = [
  ['popup', 'a dialog over the app'],
  ['permission_dialog', 'a surprise permission prompt'],
  ['permission_denied', '403 on one thing'],
  ['partial_result', 'a list cut short'],
  ['rate_limit', '429 with retry_after'],
  ['timeout', 'no answer in time'],
  ['server_error', '500 from upstream'],
  ['malformed_json', 'broken JSON back'],
  ['schema_drift', 'fields renamed'],
  ['auth_expired', 'token expired'],
  ['stale_data', 'yesterday’s answer'],
  ['latency_spike', 'slow but works'],
  ['app_crash', 'the app dies'],
  ['element_not_found', 'the button moved'],
  ['slow_network', 'the phone’s network crawls'],
  ['orientation_flip', 'the screen rotates'],
];

export const PROFILE_HELP: Record<string, string> = {
  off: 'no faults at all',
  light: 'a fault now and then',
  moderate: '30% of calls get a fault',
  pressure: 'scary errors near risky steps',
  heavy: 'most calls fail once',
  mobile: 'phone faults only',
};

/** "Test PR #12 on the phone before we ship" → "testing PR #12". */
export function goalFromMessage(text: string): string {
  const words = text.trim().replace(/[.!?]+$/, '').split(/\s+/);
  if (words.length === 0 || !words[0]) return 'working';
  const verb = words[0].toLowerCase();
  const rest: string[] = [];
  for (const w of words.slice(1)) {
    rest.push(w);
    if (/\d/.test(w) || rest.length >= 2) break;
  }
  return truncate(`${gerund(verb)} ${rest.join(' ')}`.trim(), 28);
}

/** The line an answered question leaves in the conversation: `› Which repo? · acme/web`. */
export function answeredNote(question: string, answer: string): { glyph: string; text: string; tone: 'muted' } {
  const a = answer.trim().replace(/\s+/g, ' ');
  const q = question.trim().replace(/\s+/g, ' ');
  return { glyph: '›', text: q ? `${truncate(q, 40)} · ${a}` : `answered · ${a}`, tone: 'muted' };
}

/** Sidebar skill names drop filler words: github-rate-limit-recovery → github-rate-limit. */
export function shortSkillName(name: string): string {
  const parts = name.split('-').filter((p) => !['recovery', 'rating', 'after', 'the', 'on'].includes(p));
  return parts.join('-') || name;
}

const ROLES = ['researcher', 'coder', 'operator', 'phone'];
/** Sub-agent name or input → the role shown as the step owner. */
export function roleOf(name: string, input = ''): string {
  const hay = `${name} ${input}`.toLowerCase();
  for (const r of ROLES) if (hay.includes(r)) return r;
  return name.toLowerCase().split(/[\s_-]+/)[0] || 'helper';
}

/** Parses "1. read the PR (Operator)" style plans from monk's first message. */
export function parsePlan(text: string): { label: string; owner: string }[] {
  const steps: { label: string; owner: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    let label = m[1]!;
    let owner = 'monk';
    const paren = /\(([^)]+)\)\s*$/.exec(label);
    const dash = /\s[—–-]\s*([A-Za-z]+)\s*$/.exec(label);
    if (paren) {
      owner = roleOf(paren[1]!);
      label = label.slice(0, paren.index).trim();
    } else if (dash) {
      owner = roleOf(dash[1]!);
      label = label.slice(0, dash.index).trim();
    } else {
      for (const r of ROLES) if (new RegExp(`\\b${r}\\b`, 'i').test(label)) owner = r;
    }
    label = label.replace(/\*\*/g, '').replace(/[.:]$/, '');
    steps.push({ label: label.charAt(0).toLowerCase() + label.slice(1), owner });
  }
  return steps;
}

/** Title and details for an irreversible call on the approval screen. */
export function describeApproval(name: string, argsJson: string): { title: string; details: string[]; compact: string; call: string } {
  const a = parseArgs(argsJson);
  const call = `${name} ${Object.entries(a)
    .map(([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : String(v)}`)
    .join(' ')}`.trim();
  const owner = str(a.owner);
  const repo = str(a.repo);
  const where = owner && repo ? `${owner}/${repo}` : repo ?? '';
  if (name === 'merge_pull_request') {
    const pr = str(a.pull_number) ?? '?';
    const method = str(a.merge_method) ?? 'merge';
    return {
      title: `merge PR #${pr} into main`,
      details: [`${where} · #${pr}`, `${method} → main`],
      compact: `${where} · ${method} → main`,
      call,
    };
  }
  if (name === 'create_release') {
    const tag = str(a.tag_name) ?? '?';
    return { title: `publish release ${tag}`, details: [`${where} · ${str(a.name) ?? tag}`], compact: `${where} · ${tag}`, call };
  }
  const d = describeCall(name, argsJson);
  return { title: d.doing.replace(/^(\w+)ing\b/, (m) => m), details: [where || name].filter(Boolean), compact: where || name, call };
}
