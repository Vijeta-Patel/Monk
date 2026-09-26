import { useMemo } from 'react';
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts';
import type { EvalRunRow } from '@monk/shared/api';
import { buildCostBars, type CostBar } from '../lib/transforms.ts';
import { compact, usd } from '../lib/format.ts';
import { useSize } from '../lib/useSize.ts';
import type { Palette } from '../theme.ts';
import type { Live } from '../data/useMonk.ts';
import { Empty, Panel, Stat } from './ui.tsx';

export function CostMeter(props: { runs: EvalRunRow[] | null; costToday: number | null; live: Live; pal: Palette; loading: boolean }) {
  const bars = useMemo(() => buildCostBars(props.runs ?? []), [props.runs]);
  const done = bars.filter((b) => !b.running);
  const last = done[done.length - 1];
  const running = [...props.live.runningEvals.values()];

  return (
    <Panel title="cost" caption="tokens and $ per run · newest right">
      <div className="mb-3 grid grid-cols-3 gap-4">
        <Stat label="today" value={usd(props.costToday)} />
        <Stat label="last run" value={last ? usd(last.costUsd) : '–'} sub={last ? `${compact(last.tokens)} tokens` : undefined} />
        <Stat
          label="this page"
          value={usd(props.live.sessionCostUsd)}
          sub={`${compact(props.live.sessionTokens)} tokens`}
        />
      </div>
      {running.length ? (
        <p className="mb-2 text-[0.85rem] text-muted">
          <span className="text-saffron">⠹</span> running: {running.map((r) => `${r.suite} gen ${r.generation} (${r.done}/${r.tasks})`).join(', ')}
        </p>
      ) : null}
      {bars.length === 0 ? (
        <Empty title={props.loading ? 'loading…' : 'no runs yet.'} command={props.loading ? undefined : 'monk bench run'} className="min-h-32" />
      ) : (
        <Columns bars={bars} pal={props.pal} />
      )}
    </Panel>
  );
}

function Columns({ bars, pal }: { bars: CostBar[]; pal: Palette }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const rem = typeof document !== 'undefined' ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
  const lastIdx = bars.length - 1;
  return (
    <div ref={ref} className="h-44 w-full" role="img" aria-label={`dollars per run for the last ${bars.length} runs`}>
      {size.width > 0 ? (
        <BarChart width={size.width} height={size.height} data={bars} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={3}>
          <XAxis dataKey="id" tick={false} tickLine={false} axisLine={{ stroke: pal.line }} height={6} />
          <YAxis
            width={48}
            tickLine={false}
            axisLine={false}
            tickCount={3}
            tickFormatter={(v: number) => usd(v)}
            tick={{ fill: pal['ink-faint'], fontSize: rem * 0.75, fontFamily: 'inherit' }}
          />
          <Tooltip cursor={{ fill: pal['bg-select'], opacity: 0.6 }} content={<Tip />} isAnimationActive={false} />
          <Bar dataKey="costUsd" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {bars.map((b, i) => (
              <Cell key={b.id} fill={b.running || i === lastIdx ? pal.saffron : pal.control} />
            ))}
          </Bar>
        </BarChart>
      ) : null}
    </div>
  );
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: CostBar }[] }) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  return (
    <div className="rounded-lg bg-sunken px-3 py-2 text-[0.85rem] shadow-lg ring-1 ring-ghost">
      <div className="font-bold text-ink">{b.label}</div>
      <div className="text-muted tabular">
        {b.running ? 'running · ' : ''}
        {usd(b.costUsd)} · {compact(b.tokens)} tokens
      </div>
    </div>
  );
}
