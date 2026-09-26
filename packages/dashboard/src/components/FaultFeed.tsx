import { useEffect, useState } from 'react';
import type { ChaosState } from '@monk/shared/api';
import { feedCounts, splitTool, type FeedItem } from '../lib/transforms.ts';
import { clock, duration, shortId, steps } from '../lib/format.ts';
import { prefersReducedMotion } from '../theme.ts';
import { Empty, Panel } from './ui.tsx';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const t = setInterval(() => setI((x) => (x + 1) % SPIN.length), 80);
    return () => clearInterval(t);
  }, [active]);
  return prefersReducedMotion() ? '●' : SPIN[i]!;
}

export function FaultFeed(props: { items: FeedItem[]; chaos: ChaosState | null; streaming: boolean }) {
  const c = feedCounts(props.items);
  const spin = useSpinner(c.pending > 0);
  const caption = props.items.length ? (
    <span className="tabular">
      last {props.items.length} · <span className="text-ok">✓</span> {c.recovered} recovered · <span className="text-fail">✗</span> {c.unrecovered} not
    </span>
  ) : null;
  const right = (
    <span className="flex items-center gap-2 text-[0.8rem] text-faint">
      <span className={props.streaming ? 'text-ok' : 'text-faint'}>{props.streaming ? '●' : '○'}</span>
      {props.streaming ? 'live' : 'reconnecting'}
    </span>
  );
  return (
    <Panel title="live faults" caption={caption} right={right} className="h-full" bodyClassName="relative">
      {props.items.length === 0 ? (
        <Empty title="no faults yet.">
          {props.chaos
            ? props.chaos.enabled && props.chaos.profile !== 'off'
              ? `Chaos is ${props.chaos.profile} at ${Math.round(props.chaos.faultRate * 100)}%. Faults show up here the moment they're injected; talk to monk or start a run.`
              : 'Chaos is off. Turn on a profile below, or inject one fault by name.'
            : 'Faults show up here the moment the chaos proxy injects them.'}
        </Empty>
      ) : (
        <ol className="absolute inset-0 overflow-y-auto pr-1" aria-live="polite" aria-relevant="additions">
          {props.items.map((it) => (
            <Row key={it.faultId} it={it} spin={spin} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Row({ it, spin }: { it: FeedItem; spin: string }) {
  const { upstream, name } = splitTool(it.tool);
  return (
    <li className={`grid grid-cols-[1.7rem_minmax(0,1fr)_auto] gap-x-2 border-b border-ghost/50 px-1 py-2 ${it.live ? 'arrive' : ''}`}>
      <span className="row-span-2 text-fault" aria-hidden>
        ⚡
      </span>
      <div className="truncate">
        <span className="font-bold text-ink">{it.faultType}</span>
        {it.manual ? <span className="ml-2 rounded px-1 text-[0.75rem] text-muted ring-1 ring-ghost">injected</span> : null}
      </div>
      <Outcome it={it} spin={spin} />
      <div className="truncate text-[0.85rem] text-muted">
        {upstream ? <span className="text-faint">{upstream} · </span> : null}
        {name}
        <span className="text-faint"> · {shortId(it.session)}</span>
      </div>
      <div className="text-right text-[0.85rem] whitespace-nowrap text-faint tabular" title={it.ms !== null ? `recovered in ${duration(it.ms)}` : undefined}>
        {clock(it.at)}
      </div>
    </li>
  );
}

function Outcome({ it, spin }: { it: FeedItem; spin: string }) {
  if (it.outcome === 'recovered')
    return (
      <div className="text-right whitespace-nowrap">
        <span className="text-ok">✓</span> <span className="text-ink">recovered</span>
        {it.steps !== null ? <span className="text-muted tabular"> · {steps(it.steps)}</span> : null}
      </div>
    );
  if (it.outcome === 'unrecovered')
    return (
      <div className="text-right whitespace-nowrap">
        <span className="text-fail">✗</span> <span className="text-ink">not recovered</span>
      </div>
    );
  return (
    <div className="text-right whitespace-nowrap">
      <span className="text-saffron">{spin}</span> <span className="text-muted">recovering</span>
    </div>
  );
}
