import { Fragment, useMemo } from 'react';
import type { HeatCell } from '@monk/shared/api';
import { buildHeatMatrix, splitTool, type HeatEntry } from '../lib/transforms.ts';
import { pct } from '../lib/format.ts';
import { Empty, Panel } from './ui.tsx';

/** Sequential, one hue (ok): pale = monk rarely recovers, deep = it reliably does. */
function fill(rate: number): { background: string; color: string } {
  const mix = Math.round(10 + rate * 80);
  return {
    background: `color-mix(in oklab, var(--ok) ${mix}%, var(--bg-raised))`,
    color: mix >= 56 ? 'var(--bg)' : 'var(--ink)',
  };
}

const wrap = (s: string) => s.replace(/_/g, '_​');

export function Heatmap(props: { cells: HeatCell[] | null; loading: boolean }) {
  const m = useMemo(() => buildHeatMatrix(props.cells ?? []), [props.cells]);
  const has = m.faultTypes.length > 0;
  const groups = useMemo(() => {
    const g: { upstream: string; span: number }[] = [];
    for (const t of m.tools) {
      const u = splitTool(t).upstream;
      const last = g[g.length - 1];
      if (last && last.upstream === u) last.span++;
      else g.push({ upstream: u, span: 1 });
    }
    return g;
  }, [m.tools]);

  const caption = has ? (
    <span className="tabular">
      {m.total.injected.toLocaleString()} faults · <span className="text-ok">✓</span> {pct(m.total.rate)} recovered
    </span>
  ) : null;

  return (
    <Panel title="recovery heatmap" caption={caption} right={has ? <Scale /> : null}>
      {!has ? (
        <Empty title={props.loading ? 'loading…' : 'no faults recorded yet.'}>
          {props.loading ? null : 'Each cell will show how often monk recovers from one fault type on one tool.'}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-[2px] text-[0.85rem]"
            style={{ gridTemplateColumns: `minmax(9.5rem, max-content) repeat(${m.tools.length}, minmax(3.4rem, 1fr)) minmax(3.6rem, 4.2rem)` }}
            role="table"
            aria-label="recovery rate by fault type and tool"
          >
            {groups.some((g) => g.upstream) ? (
              <>
                <div />
                {groups.map((g, i) => (
                  <div key={i} style={{ gridColumn: `span ${g.span}` }} className="mx-0.5 border-b border-line pb-0.5 text-center text-[0.75rem] font-bold text-faint">
                    {g.upstream || 'other'}
                  </div>
                ))}
                <div />
              </>
            ) : null}
            <div role="columnheader" className="self-end pb-1 text-[0.75rem] text-faint">fault ↓ · tool →</div>
            {m.tools.map((t) => (
              <div key={t} role="columnheader" title={t} className="self-end px-0.5 pb-1 text-center text-[0.75rem] leading-tight break-words text-muted">
                {wrap(splitTool(t).name)}
              </div>
            ))}
            <div role="columnheader" className="self-end pb-1 text-center text-[0.75rem] font-bold text-muted">all</div>
            {m.faultTypes.map((f) => (
              <Fragment key={f}>
                <div role="rowheader" className="flex items-center gap-1.5 pr-2 whitespace-nowrap text-ink">
                  <span className="text-fault" aria-hidden>⚡</span>
                  {f}
                </div>
                {m.tools.map((t) => (
                  <Cell key={t} e={m.get(f, t)} label={`${f} on ${t}`} />
                ))}
                <Cell e={m.rowTotals.get(f)!} label={`${f}, all tools`} strong />
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Cell({ e, label, strong }: { e: HeatEntry; label: string; strong?: boolean }) {
  if (e.rate === null)
    return (
      <div role="cell" aria-label={`${label}: no faults`} className="flex h-10 items-center justify-center rounded-[3px] bg-sunken/60 text-ghost">
        ·
      </div>
    );
  const few = e.injected < 5;
  return (
    <div
      role="cell"
      title={`${label}: ${e.recovered} of ${e.injected} recovered`}
      aria-label={`${label}: ${Math.round(e.rate * 100)}% recovered, ${e.recovered} of ${e.injected}`}
      className={`flex h-10 flex-col items-center justify-center rounded-[3px] leading-none tabular ${strong ? 'font-extrabold' : 'font-bold'}`}
      style={fill(e.rate)}
    >
      <span className={few ? 'opacity-70' : ''}>{Math.round(e.rate * 100)}</span>
      <span className="mt-0.5 text-[0.62rem] font-medium opacity-80">n={e.injected}</span>
    </div>
  );
}

function Scale() {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-2 text-[0.75rem] text-faint" aria-label="color scale: recovery rate 0 to 100 percent">
      <span>recovered</span>
      <div className="flex gap-[2px]">
        {stops.map((s) => (
          <span key={s} className="flex h-5 w-8 items-center justify-center rounded-[3px] text-[0.65rem] font-bold" style={fill(s)}>
            {Math.round(s * 100)}
          </span>
        ))}
      </div>
      <span>%</span>
    </div>
  );
}
