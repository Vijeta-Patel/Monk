// Colors come straight from the TUI design tokens so the dashboard and the terminal stay one product.
import { useCallback, useEffect, useState } from 'react';
import tokens from '../../tui/design/tokens.json';

export type ThemeName = 'dark' | 'light';
type Pair = { dark: string; light: string };

const base: Record<string, Pair> = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t.value]));

/**
 * Chart-only additions, derived from the tokens and checked with the dataviz validator:
 * `control` is the de-emphasised chaos-off reference line (ΔE ≥ 15 from saffron and skill,
 * ≥ 3:1 on bg in both themes). The rest are washes for bands and heat cells.
 */
const extra: Record<string, Pair> = {
  control: { dark: '#6F7A81', light: '#8C8A84' },
  grid: { dark: '#252C30', light: '#DDD9CF' },
};

export const TOKENS: Record<string, Pair> = { ...base, ...extra };

export type Palette = Record<
  | 'bg' | 'bg-raised' | 'bg-sunken' | 'bg-select' | 'line' | 'ink' | 'ink-muted' | 'ink-faint' | 'ink-ghost'
  | 'saffron' | 'saffron-fill' | 'on-saffron' | 'ok' | 'fail' | 'fault' | 'skill' | 'gate' | 'gate-fill' | 'on-gate'
  | 'control' | 'grid',
  string
>;

export function palette(theme: ThemeName): Palette {
  return Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, v[theme]])) as Palette;
}

function cssFor(theme: ThemeName): string {
  return Object.entries(TOKENS)
    .map(([k, v]) => `--${k}:${v[theme]};`)
    .join('');
}

let installed = false;
export function installThemeVars(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const style = document.createElement('style');
  style.dataset.monk = 'tokens';
  style.textContent =
    `:root,:root[data-theme="dark"]{${cssFor('dark')}color-scheme:dark}` +
    `:root[data-theme="light"]{${cssFor('light')}color-scheme:light}`;
  document.head.prepend(style);
}

const KEY = 'monk.dashboard.theme';

function readStored(): ThemeName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeName {
  // Dark unless the system explicitly asks for light: this is a projector-first screen.
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function initialTheme(): ThemeName {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'dark' || q === 'light') return q;
  return readStored() ?? systemTheme();
}

export function useTheme(): [ThemeName, () => void] {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (readStored()) return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const on = () => setTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode: the toggle still works for this visit */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
