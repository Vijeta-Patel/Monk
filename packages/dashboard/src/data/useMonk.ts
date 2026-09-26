import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ApiClient, CurvePoint, EvalRunRow, HeatCell, MonkState, SkillRow } from '@monk/shared/api';
import type { StoredEvent } from '@monk/shared/events';
import { feedReducer, initialFeed, staleBy, type FeedState, type Resource } from '../lib/transforms.ts';

export type Status = 'connecting' | 'live' | 'down';

export type Live = {
  /** Skill names committed while this page was open. */
  newSkills: Set<string>;
  /** Drafted, waiting on sandbox verification. */
  verifying: Set<string>;
  lastFaultAt: number;
  lastRecoverAt: number;
  sessionTokens: number;
  sessionCostUsd: number;
  recentCosts: { ts: string; tfSessionId: string; tokens: number; costUsd: number }[];
  runningEvals: Map<string, { suite: string; generation: number; done: number; tasks: number; costUsd: number }>;
};

export type MonkData = {
  status: Status;
  streaming: boolean;
  retryIn: number;
  everConnected: boolean;
  state: MonkState | null;
  skills: SkillRow[] | null;
  heat: HeatCell[] | null;
  runs: EvalRunRow[] | null;
  curve: CurvePoint[] | null;
  feed: FeedState;
  live: Live;
  refresh: (r?: Resource[]) => void;
};

const RETRY_S = 3;
const DEBOUNCE: Record<Resource, number> = { state: 400, skills: 500, runs: 700, curve: 900, heatmap: 1500 };

const freshLive = (): Live => ({
  newSkills: new Set(), verifying: new Set(), lastFaultAt: 0, lastRecoverAt: 0, sessionTokens: 0, sessionCostUsd: 0,
  recentCosts: [], runningEvals: new Map(),
});

function applyLive(l: Live, e: StoredEvent): Live {
  switch (e.kind) {
    case 'fault.injected':
      return { ...l, lastFaultAt: Date.now() };
    case 'fault.recovered':
      return { ...l, lastRecoverAt: Date.now() };
    case 'skill.drafted':
      return { ...l, verifying: new Set(l.verifying).add(e.data.name) };
    case 'skill.verified':
    case 'skill.discarded': {
      const v = new Set(l.verifying);
      v.delete(e.data.name);
      return { ...l, verifying: v };
    }
    case 'skill.committed': {
      const v = new Set(l.verifying);
      v.delete(e.data.name);
      return { ...l, verifying: v, newSkills: new Set(l.newSkills).add(e.data.name) };
    }
    case 'session.cost': {
      const tokens = e.data.inputTokens + e.data.outputTokens;
      return {
        ...l,
        sessionTokens: l.sessionTokens + tokens,
        sessionCostUsd: l.sessionCostUsd + e.data.costUsd,
        recentCosts: [{ ts: e.ts, tfSessionId: e.data.tfSessionId, tokens, costUsd: e.data.costUsd }, ...l.recentCosts].slice(0, 30),
      };
    }
    case 'eval.run.started': {
      const m = new Map(l.runningEvals);
      m.set(e.data.runId, { suite: e.data.suite, generation: e.data.generation, done: 0, tasks: e.data.tasks, costUsd: 0 });
      return { ...l, runningEvals: m };
    }
    case 'eval.task.done': {
      const cur = l.runningEvals.get(e.data.runId);
      if (!cur) return l;
      const m = new Map(l.runningEvals);
      m.set(e.data.runId, { ...cur, done: cur.done + 1, costUsd: cur.costUsd + e.data.costUsd });
      return { ...l, runningEvals: m };
    }
    case 'eval.run.done': {
      const m = new Map(l.runningEvals);
      m.delete(e.data.runId);
      return { ...l, runningEvals: m };
    }
    default:
      return l;
  }
}

/** The API has no "tail from now"; page through history to find the cursor instead of replaying it. */
async function latestEventId(api: ApiClient): Promise<number> {
  let cursor = 0;
  for (let page = 0; page < 50; page++) {
    const batch = await api.events(cursor, 1000);
    if (batch.length) cursor = batch[batch.length - 1]!.id;
    if (batch.length < 1000) break;
  }
  return cursor;
}

export function useMonk(api: ApiClient, opts: { replayRecent?: boolean } = {}): MonkData {
  const [status, setStatus] = useState<Status>('connecting');
  const [streaming, setStreaming] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [everConnected, setEverConnected] = useState(false);
  const [state, setState] = useState<MonkState | null>(null);
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [heat, setHeat] = useState<HeatCell[] | null>(null);
  const [runs, setRuns] = useState<EvalRunRow[] | null>(null);
  const [curve, setCurve] = useState<CurvePoint[] | null>(null);
  const [feed, dispatch] = useReducer(feedReducer, initialFeed);
  const [live, setLive] = useState<Live>(freshLive);
  const timers = useRef(new Map<Resource, ReturnType<typeof setTimeout>>());
  const alive = useRef(true);

  const fetchOne = useCallback(
    async (r: Resource) => {
      try {
        if (r === 'state') setState(await api.state());
        else if (r === 'skills') setSkills(await api.skills());
        else if (r === 'heatmap') setHeat(await api.heatmap());
        else if (r === 'runs') setRuns(await api.runs());
        else if (r === 'curve') setCurve(await api.curve());
      } catch {
        // The heartbeat decides whether the API is down; one failed refetch keeps the last render.
      }
    },
    [api],
  );

  const refresh = useCallback(
    (rs: Resource[] = ['state', 'skills', 'heatmap', 'runs', 'curve']) => {
      for (const r of rs) {
        if (timers.current.has(r)) continue;
        timers.current.set(
          r,
          setTimeout(() => {
            timers.current.delete(r);
            if (alive.current) void fetchOne(r);
          }, DEBOUNCE[r]),
        );
      }
    },
    [fetchOne],
  );

  // Initial load, with calm retries while `monk up` isn't running.
  useEffect(() => {
    alive.current = true;
    let stop: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const connect = async () => {
      setStatus((s) => (s === 'live' ? s : 'connecting'));
      try {
        const st = await api.state();
        if (!alive.current) return;
        setState(st);
        const [sk, hm, rn, cv, fl] = await Promise.allSettled([api.skills(), api.heatmap(), api.runs(), api.curve(), api.faults(undefined, 100)]);
        if (!alive.current) return;
        if (sk.status === 'fulfilled') setSkills(sk.value);
        if (hm.status === 'fulfilled') setHeat(hm.value);
        if (rn.status === 'fulfilled') setRuns(rn.value);
        if (cv.status === 'fulfilled') setCurve(cv.value);
        if (fl.status === 'fulfilled') dispatch({ type: 'seed', faults: fl.value });
        setStatus('live');
        setEverConnected(true);
        const after = opts.replayRecent ? 0 : await latestEventId(api).catch(() => 0);
        if (!alive.current) return;
        stop?.();
        stop = api.subscribe(
          (e) => {
            setStreaming(true);
            dispatch({ type: 'event', event: e });
            setLive((l) => applyLive(l, e));
            const stale = staleBy(e.kind);
            if (stale.length) refresh(stale);
          },
          { after, onError: () => setStreaming(false) },
        );
        setStreaming(true);
      } catch {
        if (!alive.current) return;
        setStatus('down');
        setStreaming(false);
        let n = RETRY_S;
        setRetryIn(n);
        retryTimer = setInterval(() => {
          n -= 1;
          setRetryIn(Math.max(0, n));
          if (n <= 0) {
            if (retryTimer) clearInterval(retryTimer);
            retryTimer = null;
            void connect();
          }
        }, 1000);
      }
    };
    void connect();

    heartbeat = setInterval(async () => {
      if (retryTimer) return;
      try {
        setState(await api.state());
        setStatus('live');
      } catch {
        setStatus('down');
        stop?.();
        stop = null;
        if (!retryTimer) void connect();
      }
    }, 15_000);

    return () => {
      alive.current = false;
      stop?.();
      if (retryTimer) clearInterval(retryTimer);
      if (heartbeat) clearInterval(heartbeat);
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, [api, refresh, opts.replayRecent]);

  return { status, streaming, retryIn, everConnected, state, skills, heat, runs, curve, feed, live, refresh };
}
