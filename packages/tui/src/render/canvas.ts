// A small cell buffer every painter draws into. Pure (no OpenTUI), so layout is unit-testable
// and the same cells feed the OpenTUI renderer, the snapshot harness and the PNG export.
import type { Paint } from '../theme.ts';
import { graphemes, width } from './text.ts';

export type Style = { fg?: Paint; bg?: Paint; bold?: boolean; underline?: boolean };
/** A run of text in one style. */
export type Seg = readonly [text: string, style?: Style];

const BOLD = 1;
const UNDERLINE = 2;
/** Continuation cell of a 2-cell glyph. */
export const TAIL = '';

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly ch: string[];
  readonly fg: (Paint | undefined)[];
  readonly bg: (Paint | undefined)[];
  readonly attr: Uint8Array;

  constructor(w: number, h: number, fill?: Style) {
    this.w = Math.max(0, w);
    this.h = Math.max(0, h);
    const n = this.w * this.h;
    this.ch = new Array<string>(n).fill(' ');
    this.fg = new Array<Paint | undefined>(n).fill(undefined);
    this.bg = new Array<Paint | undefined>(n).fill(fill?.bg);
    this.attr = new Uint8Array(n);
  }

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  private setCell(x: number, y: number, g: string, style: Style | undefined): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    // Overwriting half of a wide glyph blanks the other half.
    const old = this.ch[i] ?? ' ';
    if (old === TAIL && x > 0) this.ch[i - 1] = ' ';
    else if (x + 1 < this.w && this.ch[i + 1] === TAIL && width(old) === 2) this.ch[i + 1] = ' ';
    this.ch[i] = g;
    this.fg[i] = style?.fg;
    if (style?.bg !== undefined) this.bg[i] = style.bg;
    this.attr[i] = (style?.bold ? BOLD : 0) | (style?.underline ? UNDERLINE : 0);
  }

  /** Writes text starting at x; returns the column after the last cell written. Clips at `maxX` (exclusive). */
  put(x: number, y: number, text: string, style?: Style, maxX = this.w): number {
    let cx = x;
    for (const g of graphemes(text)) {
      const gw = Math.max(1, width(g));
      if (cx + gw > maxX) break;
      if (gw === 2) {
        this.setCell(cx, y, g, style);
        this.setCell(cx + 1, y, TAIL, style);
      } else {
        this.setCell(cx, y, g, style);
      }
      cx += gw;
    }
    return cx;
  }

  segs(x: number, y: number, segs: readonly Seg[], maxX = this.w): number {
    let cx = x;
    for (const [text, style] of segs) cx = this.put(cx, y, text, style, maxX);
    return cx;
  }

  /** Right-aligns segs so the last cell lands at column `right` (inclusive). */
  segsRight(right: number, y: number, segs: readonly Seg[]): number {
    const w = segs.reduce((n, [t]) => n + width(t), 0);
    const x = right - w + 1;
    this.segs(x, y, segs);
    return x;
  }

  fill(x: number, y: number, w: number, h: number, style: Style, ch = ' '): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setCell(xx, yy, ch, style);
  }

  /** Sets background only, keeping characters. */
  paintBg(x: number, y: number, w: number, h: number, bg: Paint): void {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (this.inside(xx, yy)) this.bg[this.idx(xx, yy)] = bg;
  }

  /** Copies another canvas in at (x, y). Transparent (unset) backgrounds keep what is below. */
  blit(src: Canvas, x: number, y: number): void {
    for (let sy = 0; sy < src.h; sy++)
      for (let sx = 0; sx < src.w; sx++) {
        const dx = x + sx;
        const dy = y + sy;
        if (!this.inside(dx, dy)) continue;
        const si = sy * src.w + sx;
        const di = this.idx(dx, dy);
        this.ch[di] = src.ch[si] ?? ' ';
        this.fg[di] = src.fg[si];
        if (src.bg[si] !== undefined) this.bg[di] = src.bg[si];
        this.attr[di] = src.attr[si] ?? 0;
      }
  }

  /** Dims everything to ink-ghost (behind a popup). Keeps characters and backgrounds. */
  dim(fromRow = 0): void {
    for (let i = fromRow * this.w; i < this.ch.length; i++) {
      this.fg[i] = 'ink-ghost';
      this.attr[i] = 0;
    }
  }

  cell(x: number, y: number): { ch: string; fg: Paint | undefined; bg: Paint | undefined; bold: boolean; underline: boolean } {
    const i = this.idx(x, y);
    const a = this.attr[i] ?? 0;
    return { ch: this.ch[i] ?? ' ', fg: this.fg[i], bg: this.bg[i], bold: (a & BOLD) !== 0, underline: (a & UNDERLINE) !== 0 };
  }

  /** Text rows as a terminal shows them; continuation cells of wide glyphs are skipped. */
  lines(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      for (let x = 0; x < this.w; x++) {
        const c = this.ch[this.idx(x, y)] ?? ' ';
        if (c !== TAIL) row += c;
      }
      out.push(row);
    }
    return out;
  }

  /** Runs of identical style per row, for the renderer. */
  runs(y: number): { text: string; fg: Paint | undefined; bg: Paint | undefined; bold: boolean; underline: boolean }[] {
    const out: { text: string; fg: Paint | undefined; bg: Paint | undefined; bold: boolean; underline: boolean }[] = [];
    for (let x = 0; x < this.w; x++) {
      const i = this.idx(x, y);
      const c = this.ch[i] ?? ' ';
      if (c === TAIL) continue;
      const fg = this.fg[i];
      const bg = this.bg[i];
      const a = this.attr[i] ?? 0;
      const last = out[out.length - 1];
      if (last && last.fg === fg && last.bg === bg && last.bold === ((a & BOLD) !== 0) && last.underline === ((a & UNDERLINE) !== 0)) {
        last.text += c;
      } else {
        out.push({ text: c, fg, bg, bold: (a & BOLD) !== 0, underline: (a & UNDERLINE) !== 0 });
      }
    }
    return out;
  }
}

export type BoxChars = { tl: string; tr: string; bl: string; br: string; h: string; v: string; hb?: string; vr?: string };
export const ROUNDED: BoxChars = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
export const DASHED: BoxChars = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '┄', v: '┆' };
export const DOUBLE: BoxChars = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' };
export const SQUARE: BoxChars = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };

/**
 * Draws a box outline. Titles sit on the top edge after `╭─` (left) or before `─╮` (right),
 * each as segs so they can carry their own style.
 */
export function drawBox(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  chars: BoxChars,
  style: Style,
  opts: { title?: readonly Seg[]; right?: readonly Seg[]; bottomLeft?: readonly Seg[]; bottomRight?: readonly Seg[] } = {},
): void {
  if (w < 2 || h < 2) return;
  const edge = (row: number, l: string, r: string, left?: readonly Seg[], right?: readonly Seg[]) => {
    c.put(x, row, l, style);
    c.put(x + 1, row, chars.h.repeat(w - 2), style);
    c.put(x + w - 1, row, r, style);
    if (left) c.segs(x + 2, row, left, x + w - 2);
    if (right) c.segsRight(x + w - 3, row, right);
  };
  edge(y, chars.tl, chars.tr, opts.title, opts.right);
  for (let yy = y + 1; yy < y + h - 1; yy++) {
    c.put(x, yy, chars.v, style);
    c.put(x + w - 1, yy, chars.v, style);
  }
  edge(y + h - 1, chars.bl, chars.br, opts.bottomLeft, opts.bottomRight);
}

export function segsWidth(segs: readonly Seg[]): number {
  return segs.reduce((n, [t]) => n + width(t), 0);
}
