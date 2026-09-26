// Design tokens with terminal capability detection. Colors come only from design/src/theme.ts.
import { RGBA } from '@opentui/core';
import { dark, light, xterm256, type Token } from '../design/src/theme.ts';

export { dark, light, xterm256, type Token };

export type ThemeName = 'dark' | 'light';
export type ColorDepth = 'truecolor' | '256';

/** A cell color: a design token, or a raw hex (only phone screenshot pixels use raw colors). */
export type Paint = Token | `#${string}`;

export function detectColorDepth(env: Record<string, string | undefined> = process.env): ColorDepth {
  const ct = (env.COLORTERM ?? '').toLowerCase();
  return ct === 'truecolor' || ct === '24bit' ? 'truecolor' : '256';
}

export function detectThemeName(
  env: Record<string, string | undefined> = process.env,
  terminalMode: 'dark' | 'light' | null = null,
): ThemeName {
  const forced = (env.MONK_THEME ?? '').toLowerCase();
  if (forced === 'light' || forced === 'dark') return forced;
  if (terminalMode) return terminalMode;
  // COLORFGBG="15;0" style hint: a light background has a high bg index.
  const fgbg = env.COLORFGBG?.split(';').pop();
  if (fgbg !== undefined && /^\d+$/.test(fgbg)) {
    const n = Number(fgbg);
    if (n === 7 || n === 15) return 'light';
  }
  return 'dark';
}

export type Theme = {
  name: ThemeName;
  depth: ColorDepth;
  hex(token: Token): string;
  /** Resolves a paint to an OpenTUI color; cached. */
  color(paint: Paint): RGBA;
};

export function createTheme(name: ThemeName, depth: ColorDepth): Theme {
  const table = name === 'dark' ? dark : light;
  const indexes = name === 'dark' ? xterm256.dark : xterm256.light;
  const cache = new Map<string, RGBA>();
  return {
    name,
    depth,
    hex: (token) => table[token],
    color(paint) {
      const hit = cache.get(paint);
      if (hit) return hit;
      let rgba: RGBA;
      if (paint.startsWith('#')) {
        rgba = depth === 'truecolor' ? RGBA.fromHex(paint) : RGBA.fromIndex(nearest256(paint), paint);
      } else {
        const token = paint as Token;
        rgba = depth === 'truecolor' ? RGBA.fromHex(table[token]) : RGBA.fromIndex(indexes[token], table[token]);
      }
      cache.set(paint, rgba);
      return rgba;
    },
  };
}

/** Nearest xterm-256 color-cube or grey index for a raw pixel color. */
export function nearest256(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const levels = [0, 95, 135, 175, 215, 255];
  const idx = (v: number) => {
    let best = 0;
    for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i]! - v) < Math.abs(levels[best]! - v)) best = i;
    return best;
  };
  const [ri, gi, bi] = [idx(r), idx(g), idx(b)];
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const cubeDist = (levels[ri]! - r) ** 2 + (levels[gi]! - g) ** 2 + (levels[bi]! - b) ** 2;
  const avg = (r + g + b) / 3;
  const gi2 = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const grey = 8 + gi2 * 10;
  const greyDist = (grey - r) ** 2 + (grey - g) ** 2 + (grey - b) ** 2;
  return greyDist < cubeDist ? 232 + gi2 : cube;
}
