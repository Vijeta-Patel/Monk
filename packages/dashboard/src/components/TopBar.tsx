import { useEffect, useState } from 'react';
import type { MonkState } from '@monk/shared/api';
import type { Status } from '../data/useMonk.ts';
import { usd } from '../lib/format.ts';
import { prefersReducedMotion, type ThemeName } from '../theme.ts';

// Same faces and timings as packages/tui/design/src/art.ts.
const FACE = {
  idle: { frames: ['(- -)', '(- -)', '(- -)', '(o o)'], ms: 900 },
  fault: { frames: ['(O o)', '(o O)', '(O o)', '(o O)'], ms: 420 },
  happy: { frames: ['(^ ^)'], ms: 1000 },
};

function useFace(lastFaultAt: number, lastRecoverAt: number): { face: string; mood: keyof typeof FACE } {
  const [tick, setTick] = useState(0);
  const now = Date.now();
  const mood: keyof typeof FACE =
    lastRecoverAt > lastFaultAt && now - lastRecoverAt < 2200 ? 'happy' : now - lastFaultAt < 1800 ? 'fault' : 'idle';
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), prefersReducedMotion() ? 1000 : 140);
    return () => clearInterval(t);
  }, []);
  const f = FACE[mood];
  const frame = prefersReducedMotion() ? 0 : Math.floor((tick * 140) / f.ms) % f.frames.length;
  return { face: f.frames[frame]!, mood };
}

export function TopBar(props: {
  state: MonkState | null;
  injected: number;
  recovered: number;
  status: Status;
  streaming: boolean;
  demo: 'param' | 'unreachable' | null;
  theme: ThemeName;
  onToggleTheme: () => void;
  lastFaultAt: number;
  lastRecoverAt: number;
  runningEvals: number;
}) {
  const { face, mood } = useFace(props.lastFaultAt, props.lastRecoverAt);
  const s = props.state;
  const chaosOn = !!s && s.chaos.enabled && s.chaos.profile !== 'off';
  const faceColor = mood === 'fault' ? 'text-fault' : mood === 'happy' ? 'text-ok' : 'text-saffron';
  const sep = <span className="text-ghost">·</span>;

  let doing: React.ReactNode;
  if (props.status === 'down') doing = <><span className="text-faint">○</span> waiting for monk up</>;
  else if (props.status === 'connecting') doing = <><span className="text-saffron">⠹</span> connecting</>;
  else if (props.runningEvals > 0) doing = <><span className="text-saffron">⠹</span> eval running</>;
  else if (mood === 'fault') doing = <><span className="text-fault">⚡</span> recovering</>;
  else doing = <><span className="text-ok">●</span> {props.streaming ? 'live' : 'ready'}</>;

  return (
    <header className="sticky top-0 z-30 border-b border-ghost bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[2400px] items-center gap-5 px-6 text-[1.1rem]">
        <span className={`font-extrabold whitespace-pre ${faceColor}`} aria-label={`monk is ${mood}`}>
          {face}
        </span>
        <span className="rounded-md bg-saffron-fill px-2 py-0.5 text-[1.05rem] font-extrabold tracking-wide text-on-saffron">monk</span>
        {s ? (
          <div className="flex min-w-0 items-center gap-3 truncate text-muted">
            <span className="text-ink">{s.model}</span>
            {sep}
            <span>
              chaos{' '}
              <span className={`font-bold ${chaosOn ? 'text-fault' : 'text-muted'}`}>
                {chaosOn ? `${s.chaos.profile} ${Math.round(s.chaos.faultRate * 100)}%` : 'off'}
              </span>
            </span>
            {sep}
            <span>
              gen <span className="font-bold text-ink">{s.generation}</span>
            </span>
            {sep}
            <span>
              <span className="font-bold text-ink">{s.skills.active}</span> skills
              {s.skills.newToday ? <span className="text-faint"> (+{s.skills.newToday} today)</span> : null}
            </span>
            {sep}
            <span className="font-bold text-ink tabular">{usd(s.costTodayUsd)}</span>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-5 whitespace-nowrap">
          {props.demo ? (
            <span
              className="rounded-md px-2 py-0.5 text-[0.85rem] font-bold text-saffron ring-1 ring-saffron/70"
              title={props.demo === 'unreachable' ? 'Nothing answered on :8788, so this page is showing generated data.' : 'Started with ?demo=1.'}
            >
              demo data{props.demo === 'unreachable' ? ' · api unreachable' : ''}
            </span>
          ) : null}
          <span className="font-bold tabular" aria-label={`${props.injected} faults injected, ${props.recovered} recovered`}>
            <span className="text-fault">⚡</span>
            <span className="text-ink">{props.injected.toLocaleString()}</span>
            <span className="ml-3 text-ok">✓</span>
            <span className="text-ink">{props.recovered.toLocaleString()}</span>
          </span>
          <span className="text-muted">{doing}</span>
          <button onClick={props.onToggleTheme} className="rounded-md px-2.5 py-1 text-[0.85rem] text-muted ring-1 ring-ghost hover:text-ink" aria-label="toggle light and dark theme">
            {props.theme === 'dark' ? '◐ light' : '◑ dark'}
          </button>
        </div>
      </div>
    </header>
  );
}
