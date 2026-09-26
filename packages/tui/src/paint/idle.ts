// The welcome screen in the conversation column.
import { WORDMARK, typewriter, wordmarkBand, wordmarkLit, type Clock } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, segsWidth, type Seg } from '../render/canvas.ts';
import { graphemes, width } from '../render/text.ts';
import type { AppState, Connection } from '../state/types.ts';
import { S } from './common.ts';

export const SHOWCASE = 'Test PR #12 on the phone before we ship';
export const TAGLINE = 'an agent that gets better every time something breaks';

const TRY: [string, string][] = [
  [SHOWCASE, ''],
  ['/resume', 'pick up where Telegram left off'],
  ['/chaos', 'break something on purpose'],
  ['/skills', 'see what monk has learned'],
];

function conn(name: string, state: Connection): Seg[] {
  if (state === 'down') return [['✗', S.fail], [` ${name}`, S.fail]];
  if (state === 'unknown') return [['○', S.faint], [` ${name}`, S.faint]];
  return [['✓', S.ok], [` ${name}`, S.muted]];
}

export function paintIdle(c: Canvas, s: AppState, l: Layout, clock: Clock): void {
  const cx = l.convX;
  const cw = l.convW;
  const full = l.full;
  const top = full ? l.bodyTop + 2 : l.bodyTop + 1;
  // Wordmark: saffron, with a 2-column ink band sweeping across.
  const wx = cx + Math.floor((cw - width(WORDMARK[0]!)) / 2);
  const band = wordmarkBand(clock);
  WORDMARK.forEach((line, r) => {
    graphemes(line).forEach((g, col) => {
      if (g !== ' ') c.put(wx + col, top + r, g, { fg: wordmarkLit(col, band) ? 'ink' : 'saffron' });
    });
  });
  c.put(cx + Math.floor((cw - width(TAGLINE)) / 2), top + 4, TAGLINE, S.muted);

  const cardW = full ? 58 : 60;
  const kx = cx + Math.floor((cw - cardW) / 2);
  const ky = top + (full ? 7 : 7);
  drawBox(c, kx, ky, cardW, TRY.length + 2, ROUNDED, { fg: 'line' }, { title: [[' try ', S.muted]] });
  TRY.forEach(([cmd, help], i) => {
    const segs: Seg[] = [['›', S.saffron], [' '], [cmd, S.ink]];
    if (help) segs.push([' '.repeat(Math.max(1, 9 - width(cmd))), {}], [help, S.muted]);
    c.segs(kx + 2, ky + 1 + i, segs);
  });

  const st = s.status;
  const parts: Seg[][] = [
    conn('github', st.connections.github),
    conn('sandbox', st.connections.sandbox),
    conn('phone', st.connections.phone),
    [['⚡', S.fault], [` chaos ${st.chaosEnabled ? st.profile : 'off'}`, S.muted]],
    [['↳', S.skill], [` ${s.skills.filter((k) => k.status === 'active').length} skills`, S.muted]],
  ];
  const line: Seg[] = parts.flatMap((p, i) => (i === 0 ? p : [['    '] as Seg, ...p]));
  const lw = segsWidth(line);
  const ly = full ? ky + TRY.length + 4 : ky + TRY.length + 4;
  c.segs(cx + Math.floor((cw - lw) / 2), ly, line);
}

/** The typewriter suggestion shown in an empty, focused input on the idle screen. */
export function idlePlaceholder(clock: Clock, since: number): string {
  return typewriter(clock, SHOWCASE, since);
}
