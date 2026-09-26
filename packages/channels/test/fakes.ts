import { loadConfig, openDb, type ChaosState, type TrueForge, type TrueForgeApi } from '@monk/shared';
import { createGateway, type GatewayCore } from '../src/gateway.ts';
import type { ChannelAdapter, ChaosApi, CronApi, InboundMessage, OutboundMessage } from '../src/types.ts';

type Raw = TrueForgeApi.TurnStreamingEvent;

export function ev(e: { type: Raw['type'] } & Record<string, unknown>): Raw {
  return { createdAt: '2026-09-23T00:00:00Z', threadId: 'main', ...e } as unknown as Raw;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A scripted turn: yields raw events; numbers are pauses in ms. */
export type Step = Raw | number | (() => Promise<void>);

export function done(extra: Record<string, unknown> = {}): Raw {
  return ev({
    type: 'turn.done',
    id: 'done',
    threadId: null,
    state: { status: 'done', completedAt: 'x', output: null, requiredActions: [], metrics: { totalInputTokens: 10, totalOutputTokens: 5 }, ...extra },
  });
}

export function paused(): Raw {
  return done({ requiredActions: [{}] });
}

export function textTurn(chunks: string[], gapMs = 0): Step[] {
  const steps: Step[] = [ev({ type: 'turn.created', id: 't0', turnId: 'turn1', input: [] }), ev({ type: 'model.message', id: 'm1', content: '' })];
  for (const c of chunks) {
    if (gapMs) steps.push(gapMs);
    steps.push(ev({ type: 'model.message.delta', id: 'm1', content: c }));
  }
  steps.push(done());
  return steps;
}

export function toolCallMsg(id: string, callId: string, name: string, args: unknown, content = ''): Raw {
  return ev({
    type: 'model.message',
    id,
    content,
    toolCalls: [
      {
        id: callId,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
        toolInfo: name === 'ask_user_question' ? { type: 'local', name } : { type: 'mcp', name, serverId: 's', serverName: 'monk-chaos' },
      },
    ],
  });
}

export class FakeTrueForge {
  created: string[] = [];
  turns: { sessionId: string; input: unknown[] }[] = [];
  cancelled: string[] = [];
  scripts: Step[][] = [];
  private cancelWaiters: (() => void)[] = [];
  private n = 0;

  /** Resolves when /stop cancels the session; use inside a script. */
  untilCancelled = (): Promise<void> => new Promise((r) => this.cancelWaiters.push(r));

  sessions = {
    create: async (_req: unknown) => {
      const id = `ses_${++this.n}`;
      this.created.push(id);
      return { data: { id } };
    },
    cancel: async (id: string) => {
      this.cancelled.push(id);
      for (const w of this.cancelWaiters.splice(0)) w();
      return {};
    },
    createTurnStream: async (sessionId: string, req: { input: unknown[] }) => {
      this.turns.push({ sessionId, input: req.input });
      const script = this.scripts.shift() ?? textTurn(['ok.']);
      return (async function* () {
        for (const s of script) {
          if (typeof s === 'number') await sleep(s);
          else if (typeof s === 'function') await s();
          else yield s;
        }
      })();
    },
  };

  asClient(): TrueForge {
    return this as unknown as TrueForge;
  }
}

export type Sent = { id: string; chatId: string; out: OutboundMessage; at: number };
export type Edit = { chatId: string; msgId: string; text: string; at: number };

export class FakeAdapter implements ChannelAdapter {
  name: string;
  limit: number;
  sent: Sent[] = [];
  edits: Edit[] = [];
  private n = 0;
  private handler: ((m: InboundMessage) => Promise<void>) | null = null;

  constructor(name: string, limit = 4096) {
    this.name = name;
    this.limit = limit;
  }
  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.handler = onMessage;
  }
  async send(chatId: string, out: OutboundMessage) {
    const id = `${this.name}-${++this.n}`;
    this.sent.push({ id, chatId, out, at: Date.now() });
    return id;
  }
  async editStream(chatId: string, msgId: string, text: string) {
    this.edits.push({ chatId, msgId, text, at: Date.now() });
  }
  /** Current text of a message: its last edit, else what was sent. */
  textOf(msgId: string): string {
    const e = this.edits.filter((x) => x.msgId === msgId).at(-1);
    return e?.text ?? this.sent.find((s) => s.id === msgId)?.out.text ?? '';
  }
  last(): Sent {
    return this.sent.at(-1)!;
  }
  withButtons(): Sent[] {
    return this.sent.filter((s) => s.out.buttons?.length);
  }
  async emit(m: InboundMessage) {
    await this.handler?.(m);
  }
}

export function fakeChaos(profiles = ['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile']) {
  const calls: { set: unknown[]; inject: unknown[] } = { set: [], inject: [] };
  let state: ChaosState = { enabled: true, profile: 'moderate', faultRate: 0.3, seed: 1, profiles, pending: [] };
  let screen: Buffer | null = null;
  const api: ChaosApi = {
    state: () => state,
    set: async (patch) => {
      calls.set.push(patch);
      state = { ...state, ...patch };
      return state;
    },
    inject: async (req) => {
      calls.inject.push(req);
      state = { ...state, pending: [...state.pending, { fault: req.fault, tool: req.tool ?? null, mcpSessionId: null }] };
      return state;
    },
    screenshot: async () => screen,
  };
  return { api, calls, setScreen: (b: Buffer | null) => (screen = b) };
}

export function fakeCron() {
  const calls = { parse: [] as string[], create: [] as unknown[], reload: 0, remove: [] as string[] };
  const api: CronApi = {
    parse: async (text) => {
      calls.parse.push(text);
      return {
        cron: '0 9 * * 1-5',
        human: 'every weekday at 09:00',
        prompt: 'summarize open PRs in acme/app',
        timezone: 'Asia/Kolkata',
        kind: 'prompt',
        chaosProfile: null,
        nextRuns: ['2026-09-24T03:30:00.000Z'],
      };
    },
    create: async (job) => {
      calls.create.push(job);
      return { id: 'job_1' };
    },
    list: async () => [],
    remove: async (id) => {
      calls.remove.push(id);
      return id === 'job_1';
    },
    reload: async () => {
      calls.reload++;
    },
  };
  return { api, calls };
}

export function setup(opts: { allowed?: string; intervalMs?: number; discordLimit?: number } = {}) {
  const db = openDb(':memory:');
  const cfg = loadConfig({ env: { ALLOWED_USERS: opts.allowed ?? 'telegram:1,42,discord:7', TIMEZONE: 'Asia/Kolkata' }, rootDir: '/tmp' });
  const tf = new FakeTrueForge();
  const tg = new FakeAdapter('telegram', 4096);
  const dc = new FakeAdapter('discord', opts.discordLimit ?? 2000);
  const chaos = fakeChaos();
  const cron = fakeCron();
  const gw: GatewayCore = createGateway({
    db,
    client: tf.asClient(),
    cfg,
    adapters: [tg, dc],
    chaos: chaos.api,
    cron: cron.api,
    streamIntervalMs: opts.intervalMs ?? 0,
  });
  const say = async (a: FakeAdapter, text: string, from: { chatId?: string; userId?: string; userName?: string } = {}) => {
    const userId = from.userId ?? (a.name === 'telegram' ? '1' : '7');
    await gw.handle({ platform: a.name, chatId: from.chatId ?? `c-${userId}`, userId, userName: from.userName ?? '@chetan', text, messageId: 'm' });
  };
  const tap = async (a: FakeAdapter, data: string, from: { chatId?: string; userId?: string; userName?: string } = {}) => {
    const userId = from.userId ?? (a.name === 'telegram' ? '1' : '7');
    await gw.handle({ platform: a.name, chatId: from.chatId ?? `c-${userId}`, userId, userName: from.userName ?? '@chetan', text: '', messageId: 'm', callback: data });
  };
  return { db, cfg, tf, tg, dc, chaos, cron, gw, say, tap };
}
