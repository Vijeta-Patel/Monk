import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import type { CurvePoint, EvalRunRow } from '@monk/shared/api';
import { buildCurveSeries, curveSuites, gainIsSignificant, spreadLabels, type CurveRow, type CurveSeries } from '../lib/transforms.ts';
import { pct, usd } from '../lib/format.ts';
import { useSize } from '../lib/useSize.ts';
import type { Palette } from '../theme.ts';
import { Empty, Panel, Seg } from './ui.tsx';

const M = { top: 20, right: 190, bottom: 4, left: 4 };
const Y_W = 58;
const X_H = 40;
const PAD = { left: 56, right: 28 };

export function Curve(props: { points: CurvePoint[] | null; runs: EvalRunRow[] | null; pal: Palette; loading: boolean }) {
  const suites = useMemo(() => curveSuites(props.points ?? []), [props.points]);
  const [picked, setPicked] = useState<string | null>(null);
  const suite = picked && suites.includes(picked) ? picked : (suites[0] ?? 'github');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = useMemo(() => buildCurveSeries(props.points ?? [], suite), [props.points, suite]);
  const profile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of props.runs ?? []) if (r.suite === suite && r.profile !== 'off') counts.set(r.profile, (counts.get(r.profile) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [props.runs, suite]);

  const right = (
    <>
      {suites.length > 1 ? <Seg label="suite" value={suite} onChange={setPicked} options={suites.map((s) => ({ value: s, label: s }))} /> : null}
      <Seg label="view" value={view} onChange={setView} options={[{ value: 'chart', label: 'chart' }, { value: 'table', label: 'table' }]} />
    </>
  );

  const seeds = series.rows[0]?.seeds;
  const caption = `success under chaos per generation${profile ? ` · profile ${profile}` : ''}${seeds ? ` · mean of ${seeds} seeds, 95% ci` : ''}`;

  return (
    <Panel title="learning curve" caption={caption} right={series.rows.length ? right : null} className="h-full" bodyClassName="flex flex-col">
      {series.rows.length === 0 ? (
        <Empty
          title={props.loading ? 'loading the curve…' : 'no runs yet.'}
          command={props.loading ? undefined : 'monk bench run --suite github,mobile --profile moderate --seeds 3 --generations 5'}
        >
          {props.loading ? null : 'Run a bench: generation 0 with no skills, then one learning round per generation. Every generation adds a point here.'}
        </Empty>
      ) : (
        <>
          <Headline s={series} />
          {view === 'chart' ? <Chart s={series} pal={props.pal} /> : <CurveTable s={series} />}
          <Legend s={series} pal={props.pal} />
        </>
      )}
    </Panel>
  );
}

function Headline({ s }: { s: CurveSeries }) {
  const f = s.first;
  const l = s.last;
  const sig = gainIsSignificant(s);
  if (!f) return null;
  const gain = l && f.on !== null && l.on !== null ? l.on - f.on : null;
  return (
    <div className="mb-2 flex flex-wrap items-end gap-x-10 gap-y-3">
      <div>
        <div className="flex items-baseline gap-4 leading-none">
          <span className="text-[3.6rem] font-extrabold tracking-tight text-muted">{pct(f.on)}</span>
          {l ? (
            <>
              <span className="text-[2.2rem] text-faint">→</span>
              <span className="text-[3.6rem] font-extrabold tracking-tight text-ink">{pct(l.on)}</span>
            </>
          ) : null}
        </div>
        <div className="mt-2 text-[0.95rem] text-muted">
          {gain !== null ? (
            <>
              <span className="font-bold text-ink">{gain >= 0 ? '+' : '−'}{Math.abs(Math.round(gain * 100))} pts</span> under chaos, gen {f.generation} → gen {l!.generation}
              <span className="ml-3">
                {sig ? (
                  <span><span className="text-ok">✓</span> intervals don't overlap</span>
                ) : (
                  <span><span className="text-faint">○</span> intervals overlap, not significant yet</span>
                )}
              </span>
            </>
          ) : (
            <>generation {f.generation} baseline · learning adds the next point</>
          )}
        </div>
      </div>
      <div className="ml-auto grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
        <MiniStat label="chaos tax" from={f.tax} to={l?.tax ?? null} fmt={(x) => `${Math.round(x * 100)} pts`} lowerIsBetter />
        <MiniStat label="held-out" from={f.heldOut} to={l?.heldOut ?? null} fmt={(x) => pct(x)} />
        <MiniStat label="steps to recover" from={f.stepsToRecover} to={l?.stepsToRecover ?? null} fmt={(x) => x.toFixed(1)} lowerIsBetter />
        <MiniStat label="$ per solved" from={f.costPerSolved} to={l?.costPerSolved ?? null} fmt={usd} lowerIsBetter />
      </div>
    </div>
  );
}

function MiniStat(props: { label: string; from: number | null; to: number | null; fmt: (x: number) => string; lowerIsBetter?: boolean }) {
  const { from, to } = props;
  const better = from !== null && to !== null ? (props.lowerIsBetter ? to < from : to > from) : null;
  return (
    <div>
      <div className="text-[0.8rem] text-faint">{props.label}</div>
      <div className="mt-0.5 text-[1.25rem] font-bold whitespace-nowrap text-ink">
        {from !== null ? <span className="text-faint">{props.fmt(from)}</span> : '–'}
        {to !== null ? (
          <>
            <span className="mx-1.5 text-faint">→</span>
            {props.fmt(to)}
            {better !== null ? (
              <span className={`ml-1.5 text-[0.9rem] ${better ? 'text-ok' : 'text-fail'}`} aria-label={better ? 'better' : 'worse'}>
                {better ? '✓' : '✗'}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Chart({ s, pal }: { s: CurveSeries; pal: Palette }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const rows = s.rows;
  const gMin = rows[0]!.generation;
  const gMax = rows[rows.length - 1]!.generation;
  const W = size.width;
  const H = size.height;
  const x0 = M.left + Y_W + PAD.left;
  const x1 = W - M.right - PAD.right;
  const y0 = M.top;
  const y1 = H - M.bottom - X_H;
  const xOf = (g: number) => (gMax === gMin ? (x0 + x1) / 2 : x0 + ((g - gMin) / (gMax - gMin)) * (x1 - x0));
  const yOf = (v: number) => y0 + (1 - v) * (y1 - y0);
  const last = rows[rows.length - 1]!;
  const first = rows[0]!;
  // No draw-in: the curve must be readable the instant it's on the projector (and in screenshots).
  const anim = false;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  const ends = [
    { key: 'on', v: last.on, color: pal.saffron, text: 'chaos on', strong: true },
    { key: 'off', v: last.off, color: pal.control, text: s.offIsReference ? `chaos off · gen ${s.offReferenceGen}` : 'chaos off' },
    { key: 'held', v: last.heldOut, color: pal.skill, text: 'held-out' },
  ].filter((e): e is typeof e & { v: number } => e.v !== null);
  const placed = spreadLabels(ends.map((e) => yOf(e.v)), 30, y0 + 8, y1 - 8);
  const lx = x1 + PAD.right;

  // Label the band where it is widest so "chaos tax" sits inside the wash.
  const widest = rows.reduce<CurveRow | null>((a, r) => (r.tax !== null && (a === null || (a.tax ?? 0) < r.tax) ? r : a), null);

  return (
    <div ref={ref} className="relative min-h-[180px] flex-1" role="img" aria-label={`Learning curve for ${s.suite}: success under chaos from ${pct(first.on)} at gen ${first.generation} to ${pct(last.on)} at gen ${last.generation}`}>
      {W > 0 && H > 0 ? (
        <div className="absolute inset-0">
          <ComposedChart width={W} height={H} data={rows} margin={M}>
            <CartesianGrid stroke={pal.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="generation"
              type="number"
              domain={[gMin, gMax]}
              ticks={rows.map((r) => r.generation)}
              tickFormatter={(g: number) => `gen ${g}`}
              padding={PAD}
              height={X_H}
              tickLine={false}
              axisLine={{ stroke: pal.line }}
              tick={{ fill: pal['ink-muted'], fontSize: rem * 0.95, fontFamily: 'inherit' }}
              tickMargin={12}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              width={Y_W}
              tickLine={false}
              axisLine={false}
              tick={{ fill: pal['ink-faint'], fontSize: rem * 0.85, fontFamily: 'inherit' }}
            />
            <Tooltip
              cursor={{ stroke: pal.line, strokeWidth: 1 }}
              content={<CurveTip pal={pal} refGen={s.offIsReference ? s.offReferenceGen : null} />}
              isAnimationActive={false}
            />
            <Area dataKey="taxBand" stroke="none" fill={pal.fault} fillOpacity={0.12} isAnimationActive={anim} activeDot={false} />
            <Area dataKey="ci" stroke="none" fill={pal.saffron} fillOpacity={0.2} isAnimationActive={anim} activeDot={false} />
            <Line
              dataKey="off"
              stroke={pal.control}
              strokeWidth={2}
              dot={s.offIsReference ? false : { r: 4, fill: pal.control, stroke: pal['bg-raised'], strokeWidth: 2 }}
              activeDot={{ r: 6, fill: pal.control, stroke: pal['bg-raised'], strokeWidth: 2 }}
              isAnimationActive={anim}
            />
            <Line
              dataKey="heldOut"
              stroke={pal.skill}
              strokeWidth={2}
              dot={{ r: 4, fill: pal.skill, stroke: pal['bg-raised'], strokeWidth: 2 }}
              activeDot={{ r: 6, fill: pal.skill, stroke: pal['bg-raised'], strokeWidth: 2 }}
              isAnimationActive={anim}
            />
            <Line
              dataKey="on"
              stroke={pal.saffron}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 6, fill: pal.saffron, stroke: pal['bg-raised'], strokeWidth: 2.5 }}
              activeDot={{ r: 8, fill: pal.saffron, stroke: pal['bg-raised'], strokeWidth: 2.5 }}
              isAnimationActive={anim}
            />
          </ComposedChart>
          <svg className="pointer-events-none absolute inset-0" width={W} height={H} aria-hidden>
            {widest && widest.taxBand && widest.tax !== null && widest.tax > 0.08 ? (
              <text
                x={xOf(widest.generation) + (widest === first ? 14 : 0)}
                y={yOf((widest.taxBand[0] + widest.taxBand[1]) / 2) + 5}
                textAnchor={widest === first ? 'start' : 'middle'}
                fill={pal['ink-muted']}
                fontSize="0.85em"
                fontWeight={700}
              >
                chaos tax {Math.round(widest.tax * 100)} pts
              </text>
            ) : null}
            {first.on !== null && rows.length > 1 ? (
              <text x={xOf(first.generation) - 16} y={yOf(first.on) + 6} textAnchor="end" fill={pal.ink} fontSize="1.05em" fontWeight={800}>
                {pct(first.on)}
              </text>
            ) : null}
            {ends.map((e, i) => {
              const py = yOf(e.v);
              const ly = placed[i]!;
              const px = xOf(last.generation);
              return (
                <g key={e.key}>
                  {Math.abs(ly - py) > 3 ? <path d={`M${px + 10},${py} L${lx - 6},${ly}`} stroke={pal['ink-ghost']} strokeWidth={1} fill="none" /> : null}
                  <line x1={lx} x2={lx + 18} y1={ly} y2={ly} stroke={e.color} strokeWidth={e.strong ? 4 : 2.5} strokeLinecap="round" />
                  <text x={lx + 26} y={ly + 6} fill={pal.ink} fontSize={e.strong ? '1.1em' : '0.95em'} fontWeight={e.strong ? 800 : 600}>
                    {pct(e.v)}
                    <tspan fill={pal['ink-muted']} fontWeight={500} fontSize="0.85em" dx="8">
                      {e.text}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

type TipProps = { active?: boolean; payload?: { payload: CurveRow }[]; pal: Palette; refGen: number | null };

function CurveTip({ active, payload, pal, refGen }: TipProps) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  const row = (color: string, label: string, value: string, sub?: string) => (
    <div className="flex items-center gap-3">
      <span className="inline-block h-[3px] w-4 rounded" style={{ background: color }} />
      <span className="text-muted">{label}</span>
      <span className="ml-auto pl-6 font-bold text-ink tabular">{value}</span>
      {sub ? <span className="text-faint tabular">{sub}</span> : null}
    </div>
  );
  return (
    <div className="min-w-72 rounded-lg bg-sunken px-4 py-3 text-[0.9rem] shadow-lg ring-1 ring-ghost">
      <div className="mb-2 font-bold text-ink">
        gen {r.generation} <span className="font-medium text-faint">· {r.seeds} seeds</span>
      </div>
      <div className="flex flex-col gap-1">
        {row(pal.saffron, 'chaos on', pct(r.on), r.ci ? `${pct(r.ci[0])}–${pct(r.ci[1])}` : undefined)}
        {row(pal.control, refGen !== null ? `chaos off (gen ${refGen})` : 'chaos off', pct(r.off))}
        {row(pal.fault, 'chaos tax', r.tax === null ? '–' : `${Math.round(r.tax * 100)} pts`)}
        {row(pal.skill, 'held-out', pct(r.heldOut))}
        <div className="mt-1 flex gap-4 text-faint">
          <span>recovery {pct(r.recovery)}</span>
          {r.stepsToRecover !== null ? <span>{r.stepsToRecover.toFixed(1)} steps</span> : null}
          {r.costPerSolved !== null ? <span>{usd(r.costPerSolved)}/solved</span> : null}
        </div>
      </div>
    </div>
  );
}

function Legend({ s, pal }: { s: CurveSeries; pal: Palette }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
  const line = (c: string, w = 3) => <span className="inline-block w-5 rounded" style={{ height: w, background: c }} />;
  const wash = (c: string, o: number) => (
    <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: `color-mix(in oklab, ${c} ${o}%, transparent)` }} />
  );
  return (
    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[0.85rem] text-muted">
      {item(line(pal.saffron, 4), 'chaos on (full monk)')}
      {item(wash(pal.saffron, 22), '95% ci')}
      {item(line(pal.control), s.offIsReference ? `chaos off control (gen ${s.offReferenceGen})` : 'chaos off control')}
      {item(wash(pal.fault, 16), 'chaos tax = off − on')}
      {item(line(pal.skill), 'held-out tasks, chaos on')}
    </div>
  );
}

function CurveTable({ s }: { s: CurveSeries }) {
  return (
    <div className="min-h-[180px] flex-1 overflow-auto">
      <table className="w-full text-left text-[0.95rem] tabular">
        <thead className="text-[0.8rem] text-faint">
          <tr>
            {['gen', 'chaos on', '95% ci', 'chaos off', 'chaos tax', 'held-out', 'recovery', 'steps', '$ / solved', 'seeds'].map((h) => (
              <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.generation} className="border-t border-ghost/60">
              <td className="py-1.5 pr-4 text-muted">gen {r.generation}</td>
              <td className="pr-4 font-bold text-ink">{pct(r.on)}</td>
              <td className="pr-4 text-muted">{r.ci ? `${pct(r.ci[0])}–${pct(r.ci[1])}` : '–'}</td>
              <td className="pr-4 text-ink">{pct(r.off)}</td>
              <td className="pr-4 text-ink">{r.tax === null ? '–' : `${Math.round(r.tax * 100)} pts`}</td>
              <td className="pr-4 text-ink">{pct(r.heldOut)}</td>
              <td className="pr-4 text-ink">{pct(r.recovery)}</td>
              <td className="pr-4 text-ink">{r.stepsToRecover?.toFixed(1) ?? '–'}</td>
              <td className="pr-4 text-ink">{usd(r.costPerSolved)}</td>
              <td className="text-muted">{r.seeds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
