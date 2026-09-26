// Tiny dependency-free line chart with CI whiskers, for REPORT.md. Palette: dataviz reference slots 1-4.
export type ChartSeries = { name: string; points: { x: number; y: number; lo?: number; hi?: number }[] };

const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function lineChartSvg(opts: {
  title: string;
  xLabel: string;
  series: ChartSeries[];
  format: (v: number) => string;
  yMax?: number;
}): string {
  const W = 640, H = 340, L = 56, R = 120, T = 56, B = 44;
  const series = opts.series.slice(0, 4);
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const xMin = Math.min(0, ...xs);
  const xMax = Math.max(1, ...xs);
  const yMax = opts.yMax ?? niceMax(Math.max(0, ...all.map((p) => p.hi ?? p.y)));
  const sx = (x: number) => L + ((x - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - y / yMax) * (H - T - B);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.title)}">`);
  out.push(`<style>
  svg { --bg:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e4e3df; ${LIGHT.map((c, i) => `--s${i + 1}:${c};`).join(' ')} font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  @media (prefers-color-scheme: dark) { svg { --bg:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#3a3a37; ${DARK.map((c, i) => `--s${i + 1}:${c};`).join(' ')} } }
  .t { fill: var(--ink); font-size: 15px; font-weight: 600; } .a { fill: var(--ink2); font-size: 11px; } .l { fill: var(--ink); font-size: 12px; }
</style>`);
  out.push(`<rect width="${W}" height="${H}" fill="var(--bg)"/>`);
  out.push(`<text class="t" x="${L}" y="24">${esc(opts.title)}</text>`);
  series.forEach((s, i) => {
    const lx = L + i * 130;
    out.push(`<line x1="${lx}" y1="40" x2="${lx + 16}" y2="40" stroke="var(--s${i + 1})" stroke-width="2"/><text class="l" x="${lx + 22}" y="44">${esc(s.name)}</text>`);
  });
  for (let k = 0; k <= 4; k++) {
    const v = (yMax * k) / 4;
    out.push(`<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--grid)" stroke-width="1"/><text class="a" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${esc(opts.format(v))}</text>`);
  }
  for (let x = Math.ceil(xMin); x <= xMax; x++) out.push(`<text class="a" x="${sx(x)}" y="${H - B + 18}" text-anchor="middle">${x}</text>`);
  out.push(`<text class="a" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(opts.xLabel)}</text>`);
  series.forEach((s, i) => {
    const c = `var(--s${i + 1})`;
    // Nudge series apart so their CI whiskers don't overlap at the same generation.
    const dx = (i - (series.length - 1) / 2) * 6;
    const px = (x: number) => sx(x) + dx;
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (pts.length === 0) return;
    for (const p of pts) {
      if (p.lo === undefined || p.hi === undefined || p.hi === p.lo) continue;
      out.push(`<path d="M${px(p.x)} ${sy(p.lo)}V${sy(p.hi)}M${px(p.x) - 4} ${sy(p.lo)}h8M${px(p.x) - 4} ${sy(p.hi)}h8" stroke="${c}" stroke-width="1.5" opacity="0.6" fill="none"/>`);
    }
    out.push(`<polyline points="${pts.map((p) => `${px(p.x)},${sy(p.y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const p of pts) {
      const ci = p.lo !== undefined && p.hi !== undefined ? ` (95% CI ${opts.format(p.lo)} to ${opts.format(p.hi)})` : '';
      out.push(`<circle cx="${px(p.x)}" cy="${sy(p.y)}" r="4" fill="${c}" stroke="var(--bg)" stroke-width="2"><title>${esc(`${s.name}, ${opts.xLabel} ${p.x}: ${opts.format(p.y)}${ci}`)}</title></circle>`);
    }
    const last = pts.at(-1)!;
    out.push(`<text class="l" x="${px(last.x) + 10}" y="${sy(last.y) + 4}">${esc(`${s.name} ${opts.format(last.y)}`)}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}
