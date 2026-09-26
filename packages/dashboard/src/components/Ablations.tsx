import { useMemo } from 'react';
import type { EvalRunRow } from '@monk/shared/api';
import { buildAblations } from '../lib/transforms.ts';
import { pct, usd } from '../lib/format.ts';
import { Empty, Panel } from './ui.tsx';

const LABEL: Record<string, [string, string]> = {
  full: ['full monk', 'reference'],
  no_verify: ['no verification', 'raw drafts, unchecked'],
  chaos_off_learning: ['learned with chaos off', 'skills from normal runs'],
  learned_chaos_off: ['learned with chaos off', 'skills from normal runs'],
  random: ['random skill', 'shuffled fault mapping'],
  no_retire: ['no retirement', 'bad skills never pruned'],
};

export function Ablations(props: { runs: EvalRunRow[] | null; loading: boolean }) {
  const { rows, suite } = useMemo(() => {
    const runs = props.runs ?? [];
    const suites = [...new Set(runs.map((r) => r.suite))];
    let best: { rows: ReturnType<typeof buildAblations>; suite: string | null } = { rows: [], suite: null };
    for (const s of suites) {
      const rows = buildAblations(runs, s);
      if (rows.length > best.rows.length) best = { rows, suite: s };
    }
    return best;
  }, [props.runs]);

  const gen = rows[0]?.generation;
  return (
    <Panel title="ablations" caption={rows.length ? `what caused the gain · ${suite} · gen ${gen} · chaos on` : undefined}>
      {rows.length === 0 ? (
        <Empty title={props.loading ? 'loading…' : 'no ablations yet.'} command={props.loading ? undefined : 'monk bench ablate --suite github --variants all --seeds 3'}>
          {props.loading ? null : 'Each variant removes one piece of monk and reruns the suite, so the gain can be pinned on its cause.'}
        </Empty>
      ) : (
        <table className="w-full text-left tabular">
          <thead className="text-[0.8rem] text-faint">
            <tr>
              <th className="pb-1.5 font-medium">variant</th>
              <th className="pb-1.5 font-medium">success</th>
              <th className="pb-1.5 pr-3 text-right font-medium">vs full</th>
              <th className="pb-1.5 pr-3 text-right font-medium">recovery</th>
              <th className="pb-1.5 pr-3 text-right font-medium">steps</th>
              <th className="pb-1.5 text-right font-medium">$/solved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [name, why] = LABEL[r.variant] ?? [r.variant.replace(/_/g, ' '), ''];
              const ref = r.variant === 'full';
              return (
                <tr key={r.variant} className="border-t border-ghost/50">
                  <td className="py-2 pr-3">
                    <div className={`whitespace-nowrap ${ref ? 'font-bold text-ink' : 'text-ink'}`}>{name}</div>
                    <div className="text-[0.75rem] text-faint">
                      {why}
                      {why ? ' · ' : ''}
                      {r.runs} runs
                    </div>
                  </td>
                  <td className="w-[30%] pr-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-[3.2ch] text-right ${ref ? 'font-bold text-ink' : 'text-ink'}`}>{pct(r.success)}</span>
                      <div className="relative h-3 flex-1 rounded-sm bg-sunken" aria-hidden>
                        {r.successLo !== null && r.successHi !== null ? (
                          <span
                            className="absolute top-[-3px] h-[18px] rounded-sm bg-ghost/60"
                            style={{ left: `${r.successLo * 100}%`, width: `${Math.max(0.5, (r.successHi - r.successLo) * 100)}%` }}
                            title="seed spread"
                          />
                        ) : null}
                        <span
                          className={`absolute inset-y-0 left-0 rounded-r-[4px] ${ref ? 'bg-saffron' : 'bg-control'}`}
                          style={{ width: `${(r.success ?? 0) * 100}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="pr-3 text-right whitespace-nowrap">
                    {r.delta === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="text-ink">
                        {r.delta >= 0 ? '+' : '−'}
                        {Math.abs(Math.round(r.delta))} pts
                      </span>
                    )}
                  </td>
                  <td className="pr-3 text-right text-ink">{pct(r.recovery)}</td>
                  <td className="pr-3 text-right text-ink">{r.steps?.toFixed(1) ?? '–'}</td>
                  <td className="text-right text-ink">{usd(r.costPerSolved)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
