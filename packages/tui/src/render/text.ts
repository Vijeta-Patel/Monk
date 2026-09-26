// Cell measurement. Always string-width, never .length (⚡ is 2 cells).
import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemes(s: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(s)) out.push(segment);
  return out;
}

export function width(s: string): number {
  return stringWidth(s);
}

/** Cuts to at most `w` cells, ending with `…` when something was cut. */
export function truncate(s: string, w: number): string {
  if (w <= 0) return '';
  if (width(s) <= w) return s;
  let out = '';
  let used = 0;
  for (const g of graphemes(s)) {
    const gw = width(g);
    if (used + gw > w - 1) break;
    out += g;
    used += gw;
  }
  return `${out}…`;
}

export function padEnd(s: string, w: number): string {
  const n = w - width(s);
  return n > 0 ? s + ' '.repeat(n) : s;
}

export function padStart(s: string, w: number): string {
  const n = w - width(s);
  return n > 0 ? ' '.repeat(n) + s : s;
}

export function center(s: string, w: number): string {
  const left = Math.floor((w - width(s)) / 2);
  return padEnd(' '.repeat(Math.max(0, left)) + s, w);
}

/** Word wrap to `w` cells; words longer than a line are hard-split. Keeps explicit newlines. */
export function wrap(text: string, w: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/ +/).filter((x, i) => x !== '' || i === 0);
    let line = '';
    for (const word of words) {
      if (word === '') continue;
      const candidate = line === '' ? word : `${line} ${word}`;
      if (width(candidate) <= w) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      if (width(word) <= w) {
        line = word;
        continue;
      }
      // Hard-split a long token.
      let chunk = '';
      for (const g of graphemes(word)) {
        if (width(chunk + g) > w) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += g;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

export function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** mm:ss for running timers. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
