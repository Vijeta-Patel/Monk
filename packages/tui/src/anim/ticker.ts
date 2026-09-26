// The one global ticker (25 fps). Everything that moves reads its time from here.
import { useEffect, useState } from 'react';
import { TICK_MS, type Clock } from './frames.ts';

type Listener = (now: number) => void;

export class Ticker {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: number;
  private readonly source: () => number;
  /** Frozen tickers never advance (snapshot harness, reduced motion). */
  readonly frozen: boolean;

  constructor(opts: { now?: () => number; frozen?: boolean } = {}) {
    this.source = opts.now ?? Date.now;
    this.current = this.source();
    this.frozen = opts.frozen ?? false;
  }

  now(): number {
    return this.current;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (!this.timer && !this.frozen) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      (this.timer as { unref?: () => void }).unref?.();
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  tick(): void {
    this.current = this.source();
    for (const fn of this.listeners) fn(this.current);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Current clock for painters; re-renders the caller once per tick. */
export function useClock(ticker: Ticker, still: boolean, reduced: boolean): Clock {
  const [now, setNow] = useState(() => ticker.now());
  useEffect(() => ticker.subscribe(setNow), [ticker]);
  return { now, still, reduced };
}
