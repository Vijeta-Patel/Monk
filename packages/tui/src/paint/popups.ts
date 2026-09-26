// Popups over the dimmed screen: everything (ctrl+p), slash commands and their arguments,
// the chaos picker, resume, step details and help.
import type { Clock } from '../anim/frames.ts';
import { CARET, pick } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, type Seg, type Style } from '../render/canvas.ts';
import { truncate, wrap } from '../render/text.ts';
import { FAULT_HELP, PROFILE_HELP } from '../state/describe.ts';
import type { AppState, StepItem } from '../state/types.ts';
import { S } from './common.ts';

export type Command = { name: string; help: string; args?: 'chaos' | 'agent' | 'resume' | 'bench' | 'cron' | 'link' };

export const COMMANDS: Command[] = [
  { name: '/new', help: 'start fresh' },
  { name: '/agent', help: 'talk to a different agent', args: 'agent' },
  { name: '/link', help: 'join from Telegram or Discord', args: 'link' },
  { name: '/stop', help: 'stop what monk is doing' },
  { name: '/chaos', help: 'break something on purpose', args: 'chaos' },
  { name: '/skills', help: 'see what monk has learned' },
  { name: '/cron', help: 'schedule a task', args: 'cron' },
  { name: '/status', help: "what's connected right now" },
  { name: '/bench', help: 'run the benchmark, watch it live', args: 'bench' },
  { name: '/resume', help: 'pick up a Telegram or Discord chat', args: 'resume' },
];

/** Subsequence match; returns matched indexes or null. */
export function fuzzy(query: string, text: string): number[] | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) {
    if (t[i] === q[j]) {
      out.push(i);
      j++;
    }
  }
  return j === q.length ? out : null;
}

/** Text with matched characters saffron, bold and underlined. */
function highlighted(text: string, hits: number[] | null, base: Style): Seg[] {
  if (!hits || hits.length === 0) return [[text, base]];
  const segs: Seg[] = [];
  const set = new Set(hits);
  let run = '';
  let runHit = false;
  const flush = () => {
    if (run) segs.push([run, runHit ? { fg: 'saffron', bold: true, underline: true } : base]);
    run = '';
  };
  [...text].forEach((ch, i) => {
    const h = set.has(i);
    if (h !== runHit) {
      flush();
      runHit = h;
    }
    run += ch;
  });
  flush();
  return segs;
}

// ---------------------------------------------------------------------------------------------
// Everything (ctrl+p)

export type PaletteItem = { group: string; label: string; value: string; key: string; action: string };

export function paletteItems(s: AppState): PaletteItem[] {
  const st = s.status;
  const known = s.skills.filter((k) => k.status === 'active').length;
  return [
    { group: 'chaos', label: 'switch chaos profile', value: st.chaosEnabled ? st.profile : 'off', key: 'ctrl+k', action: 'chaos.pick' },
    { group: 'chaos', label: 'throw a fault right now', value: 'api or phone', key: '', action: 'chaos.inject' },
    { group: 'chaos', label: 'set how often faults happen', value: `${Math.round(st.faultRate * 100)}%`, key: '', action: 'chaos.rate' },
    { group: 'chaos', label: 'turn chaos off for a bit', value: '', key: '', action: 'chaos.off' },
    { group: 'bench', label: 'run the benchmark under chaos', value: '/bench', key: '', action: 'bench' },
    { group: 'recent', label: 'open skills', value: `${known} known`, key: 'ctrl+s', action: 'skills' },
    { group: 'recent', label: 'resume a telegram chat', value: '/resume', key: '', action: 'resume' },
    { group: 'recent', label: 'start fresh', value: '/new', key: '', action: 'new' },
    { group: 'view', label: 'toggle the sidebar', value: '', key: 'ctrl+l', action: 'sidebar' },
    { group: 'view', label: 'details of the selected step', value: '', key: 'ctrl+o', action: 'details' },
    { group: 'view', label: 'stop what monk is doing', value: '/stop', key: 'esc', action: 'stop' },
    { group: 'view', label: "what's connected right now", value: '/status', key: '', action: 'status' },
    ...COMMANDS.map((cmd) => ({ group: 'commands', label: cmd.help, value: cmd.name, key: '', action: `cmd:${cmd.name}` })),
  ];
}

/** Matches for the query, then the `recent` group, which always stays listed. */
export function filterPalette(items: PaletteItem[], query: string): { item: PaletteItem; hits: number[] | null; match: boolean }[] {
  if (!query.trim()) return items.map((item) => ({ item, hits: null, match: true }));
  const out: { item: PaletteItem; hits: number[] | null; match: boolean }[] = [];
  for (const item of items) {
    const inGroup = fuzzy(query, item.group);
    const inLabel = fuzzy(query, item.label);
    if (inGroup || inLabel) out.push({ item, hits: inLabel, match: true });
  }
  for (const item of items) if (item.group === 'recent' && !out.some((o) => o.item === item)) out.push({ item, hits: null, match: false });
  return out;
}

export function paintPalette(c: Canvas, s: AppState, l: Layout, clock: Clock, query: string, selected: number): void {
  c.dim(2);
  const w = Math.min(72, l.w - 4);
  const x = Math.floor((l.w - w) / 2);
  const y = l.full ? 5 : 3;
  const h = Math.min(23, l.hintsY - y - 1);
  c.fill(x, y, w, h, { bg: 'bg-raised' });
  drawBox(c, x, y, w, h, ROUNDED, S.saffron, { title: [[' everything ', S.ink]], right: [[' ctrl+p ', S.faint]] });
  const all = paletteItems(s);
  const shown = filterPalette(all, query);
  c.put(x + 3, y + 2, '›', S.saffron);
  const qEnd = c.put(x + 5, y + 2, query, S.ink);
  c.put(qEnd, y + 2, pick(CARET.frames, clock, CARET.ms), S.saffron);
  c.segsRight(x + w - 4, y + 2, [[`${shown.filter((m) => m.match).length} of ${all.length}`, S.faint]]);
  c.put(x + 2, y + 3, '─'.repeat(w - 4), S.ghost);
  let row = y + 4;
  let lastGroup = '';
  const bottom = y + h - 3;
  shown.forEach(({ item, hits }, i) => {
    if (row > bottom) return;
    if (item.group !== lastGroup) {
      if (lastGroup !== '') row++;
      if (row > bottom) return;
      c.put(x + 3, row++, item.group, S.faint);
      lastGroup = item.group;
    }
    if (row > bottom) return;
    const sel = i === selected;
    if (sel) {
      c.paintBg(x + 1, row, w - 2, 1, 'bg-select');
      c.put(x + 2, row, '›', S.saffron);
    }
    c.segs(x + 5, row, highlighted(item.label, hits, sel ? S.ink : S.muted), x + 40);
    if (item.value) c.put(x + 42, row, truncate(item.value, 20), S.muted);
    if (item.key) c.segsRight(x + w - 4, row, [[item.key, S.faint]]);
    row++;
  });
  c.segs(x + 3, y + h - 2, [['↑↓', S.muted], [' move   ', S.faint], ['enter', S.muted], [' go   ', S.faint], ['esc', S.muted], [' close', S.faint]]);
}

// ---------------------------------------------------------------------------------------------
// Slash commands and their arguments

export type SlashView =
  | { mode: 'commands'; query: string; selected: number }
  | { mode: 'args'; command: string; query: string; selected: number };

export function slashView(input: string, selected: number): SlashView | null {
  if (!input.startsWith('/')) return null;
  const sp = input.indexOf(' ');
  if (sp < 0) return { mode: 'commands', query: input.slice(1), selected };
  const command = input.slice(0, sp);
  const cmd = COMMANDS.find((c2) => c2.name === command);
  if (!cmd?.args || cmd.args !== 'chaos') return null;
  return { mode: 'args', command, query: input.slice(sp + 1), selected };
}

export function slashMatches(query: string): { cmd: Command; hits: number[] | null }[] {
  return COMMANDS.map((cmd) => ({ cmd, hits: query ? fuzzy(query, cmd.name.slice(1)) : [] }));
}

export type ArgOption = { group: 'profile' | 'fault'; name: string; help: string };

export function chaosArgOptions(query: string, profiles: string[]): ArgOption[] {
  const q = query.toLowerCase();
  const profs = profiles.filter((p) => p.startsWith(q)).map((p) => ({ group: 'profile' as const, name: p, help: PROFILE_HELP[p] ?? '' }));
  const faults = FAULT_HELP.filter(([f]) => f.startsWith(q)).map(([f, help]) => ({ group: 'fault' as const, name: f, help }));
  return [...profs, ...faults];
}

export function paintSlash(c: Canvas, s: AppState, l: Layout, v: SlashView): void {
  const x = 2;
  // The list covers the conversation rows it spans; the sidebar stays visible.
  const clear = (top: number, h: number) => c.fill(0, top, l.full ? l.ruleX : l.w, h, { bg: 'bg' });
  if (v.mode === 'commands') {
    const list = slashMatches(v.query);
    const matched = list.filter((m) => m.hits !== null).length;
    const w = 59;
    const h = list.length + 4;
    const y = l.bodyBottom - h + 1;
    clear(y, h);
    c.fill(x, y, w, h, { bg: 'bg-raised' });
    drawBox(c, x, y, w, h, ROUNDED, { fg: 'line' }, { title: [[' commands ', S.ink]], right: v.query ? [[` ${matched} match `, S.faint]] : [] });
    list.forEach(({ cmd, hits }, i) => {
      const ry = y + 1 + i;
      const sel = i === v.selected;
      const dim = hits === null;
      if (sel) c.put(x + 2, ry, '›', S.saffron);
      const nameHits = hits ? hits.map((k) => k + 1) : null;
      c.segs(x + 4, ry, highlighted(cmd.name, dim ? null : nameHits, dim ? S.ghost : S.ink));
      c.put(x + 14, ry, cmd.help, dim ? S.ghost : S.muted);
    });
    if (v.query) c.put(x + 4, y + h - 2, 'the rest stay listed, dimmed', S.faint);
    return;
  }
  const opts = chaosArgOptions(v.query, s.status.profiles);
  const w = 63;
  const rows: { kind: 'group' | 'opt'; text: string; help?: string; idx?: number }[] = [];
  let lastGroup = '';
  opts.forEach((o, i) => {
    if (o.group !== lastGroup) {
      rows.push({ kind: 'group', text: o.group });
      lastGroup = o.group;
    }
    rows.push({ kind: 'opt', text: o.name, help: o.help, idx: i });
  });
  const maxRows = Math.max(1, l.bodyBottom - l.bodyTop - 3);
  const shown = rows.slice(0, maxRows);
  const h = shown.length + 2;
  const y = l.bodyBottom - h + 1;
  clear(y, h);
  c.fill(x, y, w, h, { bg: 'bg-raised' });
  drawBox(c, x, y, w, h, ROUNDED, { fg: 'line' }, { title: [[` ${v.command} · pick a profile or a fault `, S.ink]] });
  shown.forEach((r, i) => {
    const ry = y + 1 + i;
    if (r.kind === 'group') {
      c.put(x + 4, ry, r.text, S.faint);
      return;
    }
    const sel = r.idx === v.selected;
    if (sel) c.put(x + 2, ry, '›', S.saffron);
    c.segs(x + 4, ry, highlighted(r.text, v.query ? [...Array(v.query.length).keys()] : null, sel ? S.ink : S.muted));
    c.put(x + 24, ry, truncate(r.help ?? '', w - 27), S.muted);
  });
}

// ---------------------------------------------------------------------------------------------
// Small centered popups

function centeredBox(c: Canvas, l: Layout, w: number, h: number, title: string, right = ''): { x: number; y: number; w: number; h: number } {
  c.dim(2);
  const bw = Math.min(w, l.w - 4);
  const bh = Math.min(h, l.hintsY - 3);
  const x = Math.floor((l.w - bw) / 2);
  const y = Math.max(2, Math.floor((l.hintsY - bh) / 2));
  c.fill(x, y, bw, bh, { bg: 'bg-raised' });
  drawBox(c, x, y, bw, bh, ROUNDED, S.saffron, { title: [[` ${title} `, S.ink]], ...(right ? { right: [[` ${right} `, S.faint]] } : {}) });
  return { x, y, w: bw, h: bh };
}

export function paintChaosPicker(c: Canvas, s: AppState, l: Layout, selected: number): void {
  const profiles = s.status.profiles;
  const b = centeredBox(c, l, 56, profiles.length + 5, 'chaos profile', 'ctrl+k');
  profiles.forEach((p, i) => {
    const ry = b.y + 2 + i;
    const sel = i === selected;
    if (sel) {
      c.paintBg(b.x + 1, ry, b.w - 2, 1, 'bg-select');
      c.put(b.x + 2, ry, '›', S.saffron);
    }
    c.put(b.x + 4, ry, p, p === s.status.profile ? S.fault : S.ink);
    c.put(b.x + 16, ry, truncate(PROFILE_HELP[p] ?? '', b.w - 19), S.muted);
  });
  c.segs(b.x + 3, b.y + b.h - 2, [['enter', S.muted], [' switch   ', S.faint], ['esc', S.muted], [' close', S.faint]]);
}

export function paintResume(c: Canvas, s: AppState, l: Layout, selected: number): void {
  const b = centeredBox(c, l, 72, Math.max(6, s.sessions.length + 5), 'resume', '/resume');
  if (s.sessions.length === 0) {
    c.put(b.x + 3, b.y + 2, 'no earlier sessions yet', S.faint);
  }
  s.sessions.slice(0, b.h - 5).forEach((ss, i) => {
    const ry = b.y + 2 + i;
    const sel = i === selected;
    if (sel) {
      c.paintBg(b.x + 1, ry, b.w - 2, 1, 'bg-select');
      c.put(b.x + 2, ry, '›', S.saffron);
    }
    c.put(b.x + 4, ry, truncate(ss.title, b.w - 30), S.ink);
    c.put(b.x + b.w - 24, ry, ss.platform, S.skill);
    c.segsRight(b.x + b.w - 3, ry, [[ss.updatedAt, S.faint]]);
  });
  c.segs(b.x + 3, b.y + b.h - 2, [['enter', S.muted], [' open   ', S.faint], ['esc', S.muted], [' close', S.faint]]);
}

export function paintDetails(c: Canvas, l: Layout, st: StepItem): void {
  const b = centeredBox(c, l, Math.min(100, l.w - 4), l.hintsY - 4, 'details', 'ctrl+o');
  const room = b.w - 6;
  const lines: [string, Style][] = [];
  lines.push([`tool     ${st.tool}${st.server ? ` · ${st.server}` : ''}`, S.ink]);
  lines.push([`owner    ${st.owner}`, S.muted]);
  if (st.faultType) lines.push([`fault    ${st.faultType}${st.faultId ? ` · ${st.faultId}` : ''}`, S.fault]);
  lines.push(['', S.ink], ['arguments', S.inkBold]);
  let args = st.args;
  try {
    args = JSON.stringify(JSON.parse(st.args), null, 2);
  } catch {
    /* raw */
  }
  for (const ln of args.split('\n')) for (const w of wrap(ln, room)) lines.push([w, S.muted]);
  lines.push(['', S.ink], ['result', S.inkBold]);
  for (const ln of (st.result ?? '(still running)').split('\n')) for (const w of wrap(ln, room)) lines.push([w, S.muted]);
  lines.slice(0, b.h - 3).forEach(([t, style], i) => c.put(b.x + 3, b.y + 1 + i, t, style));
}

export const HELP_KEYS: [string, string][] = [
  ['enter', 'send'],
  ['shift+enter', 'new line'],
  ['esc', 'stop the turn'],
  ['/', 'commands'],
  ['ctrl+p', 'everything'],
  ['tab', 'move around'],
  ['pgup pgdn', 'scroll back · shift+↑↓ a line'],
  ['home end', 'oldest · back to the newest'],
  ['shift+drag', 'select text'],
  ['ctrl+o', 'details of a step'],
  ['ctrl+l', 'sidebar'],
  ['ctrl+k', 'chaos profile'],
  ['ctrl+s', 'skills'],
  ['ctrl+c', 'quit'],
];

export function paintHelp(c: Canvas, l: Layout): void {
  const b = centeredBox(c, l, 52, HELP_KEYS.length + 4, 'keys', '?');
  // Short terminals get as many rows as fit inside the box.
  HELP_KEYS.slice(0, Math.max(0, b.h - 4)).forEach(([k, v], i) => {
    c.put(b.x + 4, b.y + 2 + i, k, S.saffron);
    c.put(b.x + 18, b.y + 2 + i, v, S.muted);
  });
}
