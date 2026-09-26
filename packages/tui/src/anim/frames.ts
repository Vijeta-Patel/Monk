// Frame selection for every animation. Frames and intervals come from design/src/art.ts; this file
// only decides which frame shows at a given time. Pure, so it is unit-tested.
import {
  CARET,
  FACE,
  HAZARD,
  MONK_BODY,
  MONK_FAULT_SEQUENCE,
  MONK_SPARKS,
  PULSE,
  RIPPLE,
  SPARKLE,
  SPINNER,
  STREAM_CURSOR,
  THOUGHT_DOTS,
  TWINKLE,
  APPROVAL_SIGN,
  BOLT,
  CRATE,
  WORDMARK,
} from '../../design/src/art.ts';

export {
  CARET,
  FACE,
  HAZARD,
  MONK_BODY,
  MONK_FAULT_SEQUENCE,
  MONK_SPARKS,
  PULSE,
  RIPPLE,
  SPARKLE,
  SPINNER,
  STREAM_CURSOR,
  THOUGHT_DOTS,
  TWINKLE,
  APPROVAL_SIGN,
  BOLT,
  CRATE,
  WORDMARK,
};

export const FPS = 25;
export const TICK_MS = 1000 / FPS;

/**
 * Animation clock handed to every painter. `still` freezes every animation on its first frame
 * (reduced motion, and the snapshot harness); `reduced` additionally swaps the spinner for `●`.
 */
export type Clock = { now: number; still: boolean; reduced: boolean };

export function isReducedMotion(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.MONK_REDUCED_MOTION;
  return v === '1' || v === 'true';
}

/** Index into an n-frame list with interval `ms`, measured from `since` and shifted by `phase`. */
export function frameIndex(clock: Clock, n: number, ms: number, since = 0, phase = 0): number {
  if (clock.still || clock.reduced || n <= 1) return 0;
  const t = clock.now - since + phase;
  if (t < 0) return 0;
  return Math.floor(t / ms) % n;
}

/** Index that plays once and then holds on the last frame. */
export function onceIndex(clock: Clock, n: number, ms: number, since: number): number {
  if (clock.still || clock.reduced) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor((clock.now - since) / ms)));
}

export function pick<T>(frames: readonly T[], clock: Clock, ms: number, since = 0, phase = 0): T {
  return frames[frameIndex(clock, frames.length, ms, since, phase)]!;
}

export function spinner(clock: Clock): string {
  if (clock.reduced) return '●';
  return pick(SPINNER.frames, clock, SPINNER.ms);
}

export function caret(clock: Clock, since = 0): string {
  return pick(CARET.frames, clock, CARET.ms, since);
}

export function streamCursor(clock: Clock): string {
  return pick(STREAM_CURSOR.frames, clock, STREAM_CURSOR.ms);
}

export type FaceMood = keyof typeof FACE;
export function face(clock: Clock, mood: FaceMood, since = 0): string {
  const f = FACE[mood];
  return pick(f.frames, clock, f.ms, mood === 'fault' ? since : 0);
}

/**
 * Shimmer over the filled part of a bar: a 2-cell `▓▓` band sweeps the filled cells, then rests
 * for 6 frames. `filled` cells of `█`, the rest `░`. Frame count is filled + 6 (70 ms each).
 */
export const SHIMMER_MS = 70;
export function shimmerBar(clock: Clock, total: number, filled: number, since = 0): string {
  const n = filled + 6;
  const k = frameIndex(clock, n, SHIMMER_MS, since);
  let out = '';
  for (let i = 0; i < total; i++) {
    if (i >= filled) out += '░';
    else out += i === k - 1 || i === k ? '▓' : '█';
  }
  return out;
}

/** Wordmark shimmer: a 2-column `ink` band sweeps the 20 columns, then a 14-step gap. */
export const WORDMARK_MS = 70;
export const WORDMARK_FRAMES = 34;
export function wordmarkBand(clock: Clock): number {
  return frameIndex(clock, WORDMARK_FRAMES, WORDMARK_MS);
}
export function wordmarkLit(col: number, band: number): boolean {
  return col === band - 1 || col === band;
}

/** Typewriter suggestion: blinks the full text 8 frames, then retypes it two characters per frame. */
export const TYPEWRITER_MS = 90;
export function typewriterFrames(text: string): string[] {
  const frames: string[] = [];
  for (let i = 0; i < 8; i++) frames.push(i % 2 === 0 ? `${text}█` : `${text} `);
  for (let i = 0; 2 * i < text.length; i++) frames.push(`${text.slice(0, 2 * i)}█`);
  return frames;
}
export function typewriter(clock: Clock, text: string, since = 0): string {
  const frames = typewriterFrames(text);
  return pick(frames, clock, TYPEWRITER_MS, since);
}

/** Hazard stripes of width w for frame k: the pattern shifts one cell per frame. */
export function hazard(clock: Clock, w: number): string {
  const p = HAZARD.pattern;
  const k = frameIndex(clock, p.length, HAZARD.ms);
  let out = '';
  for (let i = 0; i < w; i++) out += p[(((i + p.length - 1 - k) % p.length) + p.length) % p.length];
  return out;
}

/** Idle float: body offsets [1,1,0,0] at 700 ms; shadow shrinks while up. */
export const FLOAT_MS = 700;
export const FLOAT_OFFSETS = [1, 1, 0, 0] as const;
export function floatOffset(clock: Clock): number {
  return pick(FLOAT_OFFSETS, clock, FLOAT_MS);
}

/** Blink patterns (face per frame) for the mascot moods. */
export const MASCOT_BLINK = {
  work: { faces: ['work', 'work', 'work', 'work', 'work', 'calm'] as const, ms: 450 },
  look: { faces: ['work', 'work', 'work', 'calm'] as const, ms: 450 },
  hold: { faces: ['work', 'calm', 'work', 'work'] as const, ms: 600 },
};

export const FAULT_MS = 420;
export const FAULT_CAPTIONS = ['whoa', 'whoa', 'hmm', 'hmm', 'got it', 'got it', 'got it', 'got it', 'got it'] as const;

/** Bolt color cycle at 110 ms (from art.ts comment); flashes at most twice per 1.3 s. */
export const BOLT_COLORS = ['fault', 'fault', 'fault', 'fault', 'ink', 'fault', 'ink', 'fault', 'fault', 'ink-ghost', 'ink-ghost', 'fault'] as const;
export const BOLT_MS = 110;

export const STEAM = { frames: [' ~ ', '~ ~', ' ~ ', '   '], ms: 350 } as const;
export const LIVE_DOT = { frames: ['●', '●', '○'], ms: 500 } as const;
export const ARROW = { ms: 300, frames: 3 } as const;
export const DRAFTING = { frames: ['drafting.  ', 'drafting.. ', 'drafting...'], ms: 400 } as const;
export const SELECTED_BOOK = { frames: ['▲', '▲', ' '], ms: 500 } as const;
export const NEW_TWINKLE = { frames: ['✦', '✧', '✦', '✦'], ms: 300 } as const;
export const BOOK_GROW_MS = 260;
export const SPARKLINE_MS = 180;
export const SIGN_MS = 700;
export const ARM_MS = 600;
