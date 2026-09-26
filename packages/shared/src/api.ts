// Contract for the Monk API (served by `monk up`, default http://localhost:8788).
// Dashboard, TUI and channels code against these types; the server implements them.
import type { FaultType, StoredEvent } from './events.ts';

export type ChaosState = {
  enabled: boolean;
  profile: string;
  faultRate: number;
  seed: number;
  profiles: string[];
  /** Fault queued by /chaos inject, applied to the next eligible call. */
  pending: { fault: string; tool: string | null; mcpSessionId: string | null }[];
};

/** Control over the chaos proxy; implemented by @monk/chaos-proxy's ChaosControl. */
export type ChaosApi = {
  state(): ChaosState;
  set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }): Promise<ChaosState>;
  inject(req: { fault: FaultType; tool?: string; tfSessionId?: string }): Promise<ChaosState>;
  screenshot(): Promise<Buffer | null>;
};

/** A JSON-schema-constrained model call (OpenRouter in production, canned in tests). */
export type Llm = (req: { system: string; user: string; schema: object }) => Promise<unknown>;

export type SkillRow = {
  name: string;
  type: 'recovery' | 'procedure' | 'tool_quirk';
  description: string;
  version: number;
  verified: boolean;
  status: 'draft' | 'active' | 'discarded' | 'retired';
  uses: number;
  wins: number;
  winRate: number | null;
  faultTypes: string[];
  tools: string[];
  generation: number;
  updatedAt: string;
};

export type SkillDetail = SkillRow & {
  body: string;
  markdown: string;
  history: { sha: string; date: string; message: string }[];
  verification: Record<string, unknown> | null;
};

export type FaultRow = {
  id: string;
  tfSessionId: string | null;
  tool: string;
  faultType: string;
  injectedAt: string;
  recoveredAt: string | null;
  recoverySteps: number | null;
  outcome: 'pending' | 'recovered' | 'unrecovered';
  manual: boolean;
};

export type HeatCell = { faultType: string; tool: string; injected: number; recovered: number };

export type EvalRunRow = {
  id: string;
  benchId: string | null;
  suite: string;
  profile: string;
  seed: number;
  generation: number;
  variant: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, number> | null;
};

/** One point per (suite, variant, generation): mean over seeds with 95% bootstrap CI. */
export type CurvePoint = {
  suite: string;
  variant: string;
  generation: number;
  chaos: boolean;
  seeds: number;
  successRate: { mean: number; lo: number; hi: number };
  recoveryRate: { mean: number; lo: number; hi: number };
  stepsToRecover: number | null;
  costPerSolved: number | null;
  heldOutSuccess: number | null;
};

export type MonkState = {
  chaos: ChaosState;
  generation: number;
  skills: { active: number; newToday: number };
  model: string;
  agent: string;
  costTodayUsd: number;
};

export type CronJobRow = {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  prompt: string;
  kind: 'prompt' | 'chaos_drill';
  deliverTo: { platform: string; chatId: string };
  chaosProfile: string | null;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  nextRun: string | null;
};

export type ApiRoutes = {
  'GET /api/state': MonkState;
  'GET /api/events': StoredEvent[]; // ?after=&limit=&kind=; with Accept: text/event-stream it streams
  'GET /api/skills': SkillRow[];
  'GET /api/skills/:name': SkillDetail;
  'GET /api/faults': FaultRow[]; // ?session=<tf session id>&limit=
  'GET /api/heatmap': HeatCell[];
  'GET /api/runs': EvalRunRow[];
  'GET /api/curve': CurvePoint[];
  'GET /api/cron': CronJobRow[];
  'POST /api/chaos': ChaosState; // body { enabled?, profile?, faultRate?, seed? }
  'GET /api/phone/screen': never; // image/png of the emulator, 404 when no phone
  'POST /api/chaos/inject': ChaosState; // body { fault, tool?, tfSessionId? }
  'POST /api/bench/run': { benchId: string }; // body { suite, profile, seeds, generations }
  'POST /api/sessions/link': { ok: true }; // body { tfSessionId, mcpSessionId } (clients without DB access, e.g. the TUI)
  'POST /api/sessions/cost': { ok: true }; // body { tfSessionId, inputTokens, outputTokens }
};

/** Tiny typed client; works in Node, Bun and the browser. */
export function createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  return {
    state: () => call<MonkState>('GET', '/api/state'),
    events: (after = 0, limit = 200) => call<StoredEvent[]>('GET', `/api/events?after=${after}&limit=${limit}`),
    skills: () => call<SkillRow[]>('GET', '/api/skills'),
    skill: (name: string) => call<SkillDetail>('GET', `/api/skills/${encodeURIComponent(name)}`),
    faults: (tfSessionId?: string, limit = 100) =>
      call<FaultRow[]>('GET', `/api/faults?limit=${limit}${tfSessionId ? `&session=${encodeURIComponent(tfSessionId)}` : ''}`),
    heatmap: () => call<HeatCell[]>('GET', '/api/heatmap'),
    runs: () => call<EvalRunRow[]>('GET', '/api/runs'),
    curve: () => call<CurvePoint[]>('GET', '/api/curve'),
    cron: () => call<CronJobRow[]>('GET', '/api/cron'),
    setChaos: (patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }) => call<ChaosState>('POST', '/api/chaos', patch),
    inject: (req: { fault: string; tool?: string; tfSessionId?: string }) => call<ChaosState>('POST', '/api/chaos/inject', req),
    startBench: (req: { suite: string; profile: string; seeds: number; generations: number }) =>
      call<{ benchId: string }>('POST', '/api/bench/run', req),
    linkSession: (req: { tfSessionId: string; mcpSessionId: string }) => call<{ ok: true }>('POST', '/api/sessions/link', req),
    reportCost: (req: { tfSessionId: string; inputTokens: number; outputTokens: number }) => call<{ ok: true }>('POST', '/api/sessions/cost', req),
    /** Server-sent events; returns a stop function. Uses fetch streaming so it also works in Bun. */
    subscribe(onEvent: (e: StoredEvent) => void, opts: { after?: number; onError?: (err: unknown) => void } = {}) {
      const ctrl = new AbortController();
      let cursor = opts.after ?? 0;
      const loop = async () => {
        while (!ctrl.signal.aborted) {
          try {
            const res = await fetchFn(`${baseUrl}/api/events?after=${cursor}`, {
              headers: { accept: 'text/event-stream' },
              signal: ctrl.signal,
            });
            if (!res.body) throw new Error('no body');
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let idx: number;
              while ((idx = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
                if (!data) continue;
                const ev = JSON.parse(data) as StoredEvent;
                cursor = ev.id;
                onEvent(ev);
              }
            }
          } catch (err) {
            if (ctrl.signal.aborted) return;
            opts.onError?.(err);
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      };
      void loop();
      return () => ctrl.abort();
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
