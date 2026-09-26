import { useEffect, useState } from 'react';
import type { ApiClient, ChaosState } from '@monk/shared/api';
import { API_FAULTS, MOBILE_FAULTS } from '../lib/faults.ts';
import { splitTool } from '../lib/transforms.ts';
import { Panel } from './ui.tsx';

type Note = { ok: boolean; text: string } | null;

const field = 'rounded-md bg-sunken px-3 py-1.5 text-ink ring-1 ring-ghost focus:ring-saffron outline-none disabled:opacity-50';
const btn = 'rounded-md px-3.5 py-1.5 font-bold ring-1 transition-colors disabled:opacity-50 whitespace-nowrap';

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[0.8rem] font-bold text-faint">{children}</div>;
}

export function Controls(props: { api: ApiClient; chaos: ChaosState | null; tools: string[]; onChanged: () => void }) {
  const chaos = props.chaos;
  const [rate, setRate] = useState(chaos?.faultRate ?? 0.2);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [fault, setFault] = useState<string>('rate_limit');
  const [tool, setTool] = useState<string>('');
  const [suite, setSuite] = useState('github');
  const [benchProfile, setBenchProfile] = useState('moderate');
  const [seeds, setSeeds] = useState(3);
  const [gens, setGens] = useState(5);

  useEffect(() => {
    if (chaos && busy !== 'rate') setRate(chaos.faultRate);
  }, [chaos?.faultRate]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      setNote({ ok: true, text: await fn() });
      props.onChanged();
    } catch (e) {
      setNote({ ok: false, text: `couldn't do that: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const profiles = chaos?.profiles.length ? chaos.profiles : ['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile'];
  const on = !!chaos?.enabled && chaos.profile !== 'off';
  const disabled = !chaos;

  return (
    <Panel title="controls" caption={chaos ? `seed ${chaos.seed}` : undefined}>
      <div className="flex flex-col gap-5">
        <div>
          <Label>chaos</Label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={disabled || busy !== null}
              onClick={() => run('toggle', async () => {
                const s = await props.api.setChaos({ enabled: !on });
                return s.enabled ? `chaos on · ${s.profile}` : 'chaos off';
              })}
              className={`${btn} ${on ? 'text-fault ring-fault' : 'text-muted ring-ghost'}`}
              aria-pressed={on}
            >
              {on ? '⚡ on' : '○ off'}
            </button>
            <select
              aria-label="chaos profile"
              disabled={disabled || busy !== null}
              value={chaos?.profile ?? ''}
              onChange={(e) => run('profile', async () => {
                const s = await props.api.setChaos({ profile: e.target.value });
                return `profile ${s.profile}`;
              })}
              className={field}
            >
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <label className="ml-auto flex min-w-[12rem] flex-1 items-center gap-3">
              <span className="text-[0.85rem] text-muted">rate</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={rate}
                disabled={disabled}
                onChange={(e) => setRate(Number(e.target.value))}
                onPointerUp={() => chaos && rate !== chaos.faultRate && run('rate', async () => `fault rate ${Math.round((await props.api.setChaos({ faultRate: rate })).faultRate * 100)}%`)}
                onKeyUp={() => chaos && rate !== chaos.faultRate && run('rate', async () => `fault rate ${Math.round((await props.api.setChaos({ faultRate: rate })).faultRate * 100)}%`)}
                className="flex-1"
                aria-label="fault rate"
              />
              <span className="w-[4ch] text-right font-bold text-ink tabular">{Math.round(rate * 100)}%</span>
            </label>
          </div>
        </div>

        <div>
          <Label>inject a fault</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="fault type" value={fault} onChange={(e) => setFault(e.target.value)} className={field} disabled={disabled}>
              <optgroup label="api">
                {API_FAULTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </optgroup>
              <optgroup label="phone">
                {MOBILE_FAULTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </optgroup>
            </select>
            <select aria-label="tool" value={tool} onChange={(e) => setTool(e.target.value)} className={`${field} min-w-0 flex-1`} disabled={disabled}>
              <option value="">any tool</option>
              {props.tools.map((t) => (
                <option key={t} value={t}>
                  {splitTool(t).upstream ? `${splitTool(t).upstream} · ${splitTool(t).name}` : t}
                </option>
              ))}
            </select>
            <button
              disabled={disabled || busy !== null}
              onClick={() => run('inject', async () => {
                await props.api.inject({ fault, ...(tool ? { tool } : {}) });
                return `queued ⚡ ${fault}${tool ? ` on ${splitTool(tool).name}` : ''} for the next call`;
              })}
              className={`${btn} text-fault ring-fault hover:bg-fault/10`}
            >
              ⚡ inject
            </button>
          </div>
          {chaos?.pending.length ? (
            <p className="mt-2 text-[0.85rem] text-muted">
              <span className="text-saffron">•</span> waiting to fire: {chaos.pending.map((p) => p.fault + (p.tool ? ` on ${splitTool(p.tool).name}` : '')).join(', ')}
            </p>
          ) : null}
        </div>

        <div>
          <Label>start an eval run</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="suite" value={suite} onChange={(e) => setSuite(e.target.value)} className={field} disabled={disabled}>
              <option value="github">github</option>
              <option value="mobile">mobile</option>
              <option value="github,mobile">github + mobile</option>
            </select>
            <select aria-label="bench profile" value={benchProfile} onChange={(e) => setBenchProfile(e.target.value)} className={field} disabled={disabled}>
              {profiles.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[0.85rem] text-muted">
              seeds
              <input type="number" min={1} max={10} value={seeds} onChange={(e) => setSeeds(Number(e.target.value))} className={`${field} w-[4.2rem]`} disabled={disabled} />
            </label>
            <label className="flex items-center gap-1.5 text-[0.85rem] text-muted">
              gens
              <input type="number" min={0} max={10} value={gens} onChange={(e) => setGens(Number(e.target.value))} className={`${field} w-[4.2rem]`} disabled={disabled} />
            </label>
            <button
              disabled={disabled || busy !== null}
              onClick={() => run('bench', async () => {
                const { benchId } = await props.api.startBench({ suite, profile: benchProfile, seeds, generations: gens });
                return `started ${benchId}`;
              })}
              className={`${btn} ml-auto bg-saffron-fill text-on-saffron ring-saffron`}
            >
              › start run
            </button>
          </div>
        </div>

        <p className="min-h-[1.4em] text-[0.9rem]" role="status" aria-live="polite">
          {busy ? (
            <span className="text-muted">
              <span className="text-saffron">⠹</span> on it…
            </span>
          ) : note ? (
            <span className="text-ink">
              <span className={note.ok ? 'text-ok' : 'text-fail'}>{note.ok ? '✓' : '✗'}</span> {note.text}
            </span>
          ) : null}
        </p>
      </div>
    </Panel>
  );
}
