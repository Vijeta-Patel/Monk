export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(digits)}%`;

export const pts = (x: number | null | undefined): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)} pts`;

export function usd(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  if (x === 0) return '$0';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  if (x < 10) return `$${x.toFixed(2)}`;
  return `$${x.toFixed(1)}`;
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Session ids are long; the tail is what people recognise. */
export const shortId = (id: string | null | undefined): string => (id ? (id.length > 8 ? `…${id.slice(-6)}` : id) : '–');

export const steps = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : `${n} step${n === 1 ? '' : 's'}`;
