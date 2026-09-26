// Pieces shared by several screens: the mascot, section headings, the key-hints row.
import {
  FAULT_CAPTIONS,
  FAULT_MS,
  FLOAT_MS,
  MASCOT_BLINK,
  MONK_BODY,
  MONK_FAULT_SEQUENCE,
  MONK_SPARKS,
  THOUGHT_DOTS,
  TWINKLE,
  frameIndex,
  onceIndex,
  pick,
  type Clock,
} from '../anim/frames.ts';
import { Canvas, type Seg, type Style } from '../render/canvas.ts';
import { width } from '../render/text.ts';
import type { Mood } from './mood.ts';

export const S = {
  ink: { fg: 'ink' },
  inkBold: { fg: 'ink', bold: true },
  muted: { fg: 'ink-muted' },
  faint: { fg: 'ink-faint' },
  ghost: { fg: 'ink-ghost' },
  saffron: { fg: 'saffron' },
  saffronBold: { fg: 'saffron', bold: true },
  ok: { fg: 'ok' },
  fail: { fg: 'fail' },
  fault: { fg: 'fault' },
  skill: { fg: 'skill' },
  gate: { fg: 'gate' },
  gateBold: { fg: 'gate', bold: true },
} as const satisfies Record<string, Style>;

// Twinkle positions around the idle monk, relative to the body's left column and top row.
const TWINKLES: { dx: number; dy: number; color: 'saffron' | 'skill' }[] = [
  { dx: -2, dy: 0, color: 'saffron' },
  { dx: -3, dy: 2, color: 'skill' },
  { dx: -2, dy: 4, color: 'saffron' },
  { dx: 12, dy: 1, color: 'skill' },
  { dx: 13, dy: 3, color: 'saffron' },
  { dx: 13, dy: 5, color: 'skill' },
];

type Body = keyof typeof MONK_BODY;

function drawBody(c: Canvas, x: number, y: number, body: Body): void {
  MONK_BODY[body].forEach((row, i) => c.put(x, y + i, row, S.inkBold));
}

/**
 * The 11-wide mascot with its mood. `x` is the body's left column, `top` the row the calm body
 * occupies when floated up (the aura and the shadow row are relative to it).
 * Returns the row of the shadow, so captions can sit under it.
 */
export function drawMascot(c: Canvas, x: number, top: number, mood: Mood, clock: Clock, faultAt: number | null): number {
  if (mood === 'idle') {
    // Float: frames 0-1 sit one row lower; the shadow row is fixed and shrinks while floating up.
    const down = frameIndex(clock, 4, FLOAT_MS) < 2 ? 1 : 0;
    drawBody(c, x, top + down, 'calm');
    c.put(x, top + 6, down ? '~~~~~~~~~~~' : ' ~~~~~~~~~ ', S.ghost);
    TWINKLES.forEach((t, i) => {
      const g = pick(TWINKLE.frames, clock, TWINKLE.ms, 0, i * TWINKLE.phaseMs);
      c.put(x + t.dx, top + t.dy, g, { fg: t.color });
    });
    return top + 6;
  }
  if (mood === 'fault') {
    const k = faultAt === null ? 0 : onceIndex(clock, MONK_FAULT_SEQUENCE.length, FAULT_MS, faultAt);
    const body = MONK_FAULT_SEQUENCE[k] as Body;
    drawBody(c, x, top, body);
    c.put(x, top + 5, '~~~~~~~~~~~', S.ghost);
    const sparks = MONK_SPARKS[k] ?? '     ';
    c.put(x + 3, top - 1, sparks, k >= 6 ? S.ok : S.fault);
    return top + 5;
  }
  const blink = mood === 'gate' ? MASCOT_BLINK.hold : mood === 'look' ? MASCOT_BLINK.look : MASCOT_BLINK.work;
  const body = pick(blink.faces, clock, blink.ms) as Body;
  drawBody(c, x, top, body);
  c.put(x, top + 5, '~~~~~~~~~~~', S.ghost);
  if (mood !== 'gate') c.put(x + 7, top - 1, pick(THOUGHT_DOTS.frames, clock, THOUGHT_DOTS.ms), S.saffron);
  return top + 5;
}

export function faultCaption(clock: Clock, faultAt: number | null): string {
  const k = faultAt === null ? 0 : onceIndex(clock, FAULT_CAPTIONS.length, FAULT_MS, faultAt);
  return FAULT_CAPTIONS[k] ?? 'got it';
}

/** `plan                       1 of 6`: bold lowercase heading, value right-aligned. */
export function heading(c: Canvas, x: number, y: number, w: number, title: string, value: readonly Seg[] = []): void {
  c.put(x, y, title, S.inkBold);
  if (value.length) c.segsRight(x + w - 1, y, value);
}

/** A caption centered in a column; odd leftovers go right unless `roundUp`. */
export function centered(c: Canvas, x: number, y: number, w: number, text: string, style: Style, roundUp = false): void {
  const spare = w - width(text);
  c.put(x + (roundUp ? Math.ceil(spare / 2) : Math.floor(spare / 2)), y, text, style);
}

/** One faint row of `key label` pairs. */
export function hints(c: Canvas, y: number, pairs: readonly (readonly [string, string])[], maxX = c.w): void {
  let x = 2;
  for (const [key, label] of pairs) {
    const need = width(key) + 1 + width(label);
    if (x + need > maxX) break;
    x = c.put(x, y, key, S.muted);
    x = c.put(x + 1, y, label, S.faint);
    x += 3;
  }
}

export const SEP = (): Seg => ['  ·  ', S.faint];
