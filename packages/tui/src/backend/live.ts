// Live backend: turns go to TrueForge through the SDK, everything else through the Monk API.
import { createApiClient, type ApiClient, type SkillRow } from '@monk/shared/api';
import type { MonkConfig } from '@monk/shared/config';
import type { StoredEvent } from '@monk/shared/events';
import { redact } from '@monk/shared/redact';
import { CHAOS_PROXY_SERVER_NAME } from '@monk/shared/tools';
import { createTrueForgeClient, normalizeTurnStream, runTurn, type TrueForge, type TrueForgeApi, type TurnEvent, type TurnInput } from '@monk/shared/trueforge';
import type { Action, Extra } from '../state/actions.ts';
import type { Effect } from '../state/keys.ts';
import type { AppState, Connection, SessionSummary, SkillInfo } from '../state/types.ts';
import { decodeScreen, tapCell } from './phone-frame.ts';
import { lastSessionId, rememberSession } from './session-file.ts';
import type { Dispatch, MonkBackend } from './types.ts';

const TYPE: Record<string, SkillInfo['type']> = { recovery: 'recovery', procedure: 'procedure', tool_quirk: 'tool_quirk' };

export function toSkillInfo(r: SkillRow, sessionStart: number): SkillInfo {
  return {
    name: r.name,
    type: TYPE[r.type] ?? 'recovery',
    version: r.version,
    verified: r.verified,
    checking: r.status === 'draft',
    status: r.status,
    winRate: r.winRate,
    uses: r.uses,
    wins: r.wins,
    isNew: Date.parse(r.updatedAt) >= sessionStart && r.uses === 0,
    description: r.description,
    generation: r.generation,
  };
}

function modelShort(m: string): string {
  return m.split('/').pop() ?? m;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export class LiveBackend implements MonkBackend {
  readonly kind = 'live' as const;
  private client: TrueForge;
  private api: ApiClient;
  private dispatch: Dispatch = () => {};
  private getState: () => AppState = () => {
    throw new Error('not started');
  };
  private sessionId: string | null = null;
  private mcpSessionId: string | null = null;
  private running: Promise<void> | null = null;
  private queue: TurnInput[] = [];
  private stopSse: (() => void) | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private startedAt = Date.now();
  private lastFrameAt = 0;
  private frameInFlight = false;
  private screen = { w: 1080, h: 2400 };
  private agent = 'monk';
  private readonly cfg: MonkConfig;
  private readonly opts: { continue: boolean };

  constructor(cfg: MonkConfig, opts: { continue: boolean }) {
    this.cfg = cfg;
    this.opts = opts;
    this.client = createTrueForgeClient(cfg);
    this.api = createApiClient(cfg.monkApiUrl);
  }

  private extra(ev: Extra): void {
    this.dispatch({ type: 'extra', ev, at: Date.now() });
  }

  private note(text: string, tone: 'faint' | 'ok' | 'fail' | 'gate' | 'muted' = 'faint', glyph = '·'): void {
    this.extra({ kind: 'note', glyph, text: redact(text), tone });
  }

  async start(dispatch: Dispatch, getState: () => AppState): Promise<void> {
    this.dispatch = dispatch;
    this.getState = getState;
    this.extra({ kind: 'status', patch: { model: modelShort(this.cfg.MODEL), agent: this.agent } });
    void this.refreshStatus();
    void this.refreshSkills();
    this.timers.push(setInterval(() => void this.refreshStatus(), 15_000));
    this.stopSse = this.api.subscribe((e) => this.onMonkEvent(e), {
      onError: () => this.extra({ kind: 'status', patch: { api: 'down' } }),
    });
    if (this.opts.continue) {
      const id = lastSessionId();
      if (id) await this.resume(id);
    }
  }

  async stop(): Promise<void> {
    this.stopSse?.();
    for (const t of this.timers) clearInterval(t);
    if (this.getState().turn.running && this.sessionId) await this.client.sessions.cancel(this.sessionId).catch(() => {});
  }

  private async refreshStatus(): Promise<void> {
    const conn = (ok: boolean): Connection => (ok ? 'ok' : 'down');
    let tfOk = false;
    try {
      const res = await fetch(new URL('/healthz', this.cfg.TRUEFORGE_URL), { signal: AbortSignal.timeout(3000) });
      tfOk = res.ok;
    } catch {
      tfOk = false;
    }
    let tools: { name: string; upstream: string }[] = [];
    try {
      const res = await fetch(`${this.cfg.chaosProxyUrl.replace(/\/mcp$/, '')}/chaos/tools`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) tools = (await res.json()) as { name: string; upstream: string }[];
    } catch {
      tools = [];
    }
    try {
      const st = await this.api.state();
      this.extra({
        kind: 'status',
        patch: {
          chaosEnabled: st.chaos.enabled,
          profile: st.chaos.profile,
          faultRate: st.chaos.faultRate,
          seed: st.chaos.seed,
          profiles: st.chaos.profiles,
          generation: st.generation,
          api: 'ok',
          trueforge: conn(tfOk),
          connections: {
            github: conn(tools.some((t) => t.upstream === 'github')),
            sandbox: conn(tfOk),
            phone: this.cfg.MONK_PHONE ? conn(tools.some((t) => t.upstream === 'mobile')) : 'unknown',
          },
        },
      });
    } catch {
      this.extra({ kind: 'status', patch: { api: 'down', trueforge: conn(tfOk) } });
    }
    const s = this.getState();
    if (!tfOk && s.status.trueforge !== 'down') this.extra({ kind: 'error', message: `TrueForge isn't answering at ${this.cfg.TRUEFORGE_URL} · monk trueforge` });
    else if (tfOk && s.error?.startsWith("TrueForge isn't")) this.extra({ kind: 'error', message: null });
  }

  private async refreshSkills(): Promise<void> {
    try {
      const rows = await this.api.skills();
      this.extra({ kind: 'skills', skills: rows.map((r) => toSkillInfo(r, this.startedAt)) });
      const first = rows.find((r) => r.status === 'active');
      if (first) void this.loadPreview(first.name);
    } catch {
      // The skills list stays as it was; the status line already says the API is down.
    }
  }

  private async loadPreview(name: string): Promise<void> {
    try {
      const d = await this.api.skill(name);
      const body = d.body.split('\n').filter((l) => /^\s*\d+[.)]/.test(l)).map((l) => l.replace(/^\s*\d+[.)]\s*/, ''));
      this.extra({
        kind: 'skill.preview',
        preview: {
          name,
          whenToUse: [d.description.replace(/^Use when /i, 'use when ')],
          steps: body,
          history: d.history.slice(0, 4).map((h) => ({ sha: h.sha, message: h.message, age: ago(h.date) })),
          winHistory: [],
          learnedFrom: d.faultTypes.length ? `fault ${d.faultTypes.join(', ')}` : `generation ${d.generation}`,
          saves: null,
        },
      });
    } catch {
      // No preview; the browser shows the description instead.
    }
  }

  /** Pulls the emulator screen after phone actions, at most once a second. */
  private async refreshPhone(): Promise<void> {
    if (this.frameInFlight || Date.now() - this.lastFrameAt < 1000) return;
    this.frameInFlight = true;
    try {
      const res = await fetch(`${this.cfg.monkApiUrl}/api/phone/screen`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const { frame, width, height } = decodeScreen(new Uint8Array(await res.arrayBuffer()));
      this.screen = { w: width, h: height };
      const now = new Date();
      this.extra({ kind: 'phone.frame', frame, clock: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` });
      this.lastFrameAt = Date.now();
    } catch {
      // No phone or a bad frame: the view keeps the last one and shows "paused" when stale.
    } finally {
      this.frameInFlight = false;
    }
  }

  /** Only this session's chaos reaches the conversation; learning and config are global. */
  private onMonkEvent(e: StoredEvent): void {
    const d = e.data as Record<string, unknown>;
    const mine = (d.tfSessionId && d.tfSessionId === this.sessionId) || (d.mcpSessionId && d.mcpSessionId === this.mcpSessionId);
    if (e.kind.startsWith('fault.') || e.kind === 'tool.call') {
      if (!mine) return;
    }
    if (e.kind === 'skill.committed' || e.kind === 'skill.retired') void this.refreshSkills();
    if (e.kind === 'session.cost' || e.kind === 'session.linked' || e.kind === 'eval.task.done') return;
    this.dispatch({ type: 'monk', ev: e, at: Date.now() });
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const { data } = await this.client.sessions.create({ agent: { name: this.agent }, metadata: { monk_client: 'terminal' } });
    this.sessionId = data.id;
    rememberSession(data.id);
    this.extra({ kind: 'session', id: data.id });
    return data.id;
  }

  private async onTurnEvent(sessionId: string, ev: TurnEvent): Promise<void> {
    if (ev.type === 'mcp.initialize') {
      const mine = ev.servers.find((s) => s.name === CHAOS_PROXY_SERVER_NAME && s.sessionId);
      if (mine?.sessionId) {
        this.mcpSessionId = mine.sessionId;
        await this.api.linkSession({ tfSessionId: sessionId, mcpSessionId: mine.sessionId }).catch(() => {});
      }
    }
    if (ev.type === 'approval.required') process.stdout.write('\x07');
    if (ev.type === 'tool.call' && /click|tap|press/.test(ev.name) && ev.name.startsWith('mobile_')) {
      try {
        const a = JSON.parse(ev.args) as { x?: number; y?: number };
        if (typeof a.x === 'number' && typeof a.y === 'number') {
          const cell = tapCell(a.x, a.y, this.screen.w, this.screen.h);
          this.extra({ kind: 'phone.tap', col: cell.col, row: cell.row, label: `${a.x},${a.y}` });
        }
      } catch {
        // Unparseable args just mean no ripple.
      }
    }
    if (ev.type === 'tool.result' && (ev.name.startsWith('mobile_') || ev.name === 'install_apk')) void this.refreshPhone();
    if (ev.type === 'turn.done') {
      await this.api.reportCost({ tfSessionId: sessionId, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens }).catch(() => {});
      void this.refreshStatus();
    }
    this.dispatch({ type: 'turn', ev, at: Date.now() });
  }

  /** Runs turns one at a time; a message typed mid-turn waits instead of cancelling the turn. */
  private enqueue(input: TurnInput): void {
    this.queue.push(input);
    if (!this.running) this.running = this.drain().finally(() => (this.running = null));
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const input = this.queue.shift()!;
      try {
        const sid = await this.ensureSession();
        for await (const ev of runTurn(this.client, sid, input)) await this.onTurnEvent(sid, ev);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.dispatch({ type: 'turn', ev: { type: 'turn.done', status: 'error', output: '', error: redact(msg), inputTokens: 0, outputTokens: 0 }, at: Date.now() });
      }
      // While paused for approval or an answer, later messages wait for that decision.
      const s = this.getState();
      if (s.approval || s.question) break;
    }
  }

  async run(effect: Effect): Promise<void> {
    switch (effect.kind) {
      case 'send':
        this.dispatch({ type: 'send', text: effect.text, at: Date.now() });
        this.enqueue({ kind: 'message', content: effect.text });
        return;
      case 'cancel':
        this.queue = [];
        if (this.sessionId) await this.client.sessions.cancel(this.sessionId).catch((err: unknown) => this.note(`couldn't stop: ${(err as Error).message}`, 'fail', '✗'));
        return;
      case 'approve': {
        const a = this.getState().approval;
        if (!a) return;
        this.dispatch({ type: 'extra', ev: { kind: 'approved.remote', platform: 'the terminal', allowed: effect.allow }, at: Date.now() });
        this.queue.unshift({ kind: 'approvals', decisions: a.calls.map((c) => ({ threadId: c.threadId, callId: c.callId, allow: effect.allow, ...(effect.reason ? { reason: effect.reason } : {}) })) });
        if (!this.running) this.running = this.drain().finally(() => (this.running = null));
        return;
      }
      case 'answer': {
        const q = this.getState().question;
        if (!q) return;
        this.queue.unshift({ kind: 'answers', answers: q.calls.map((c) => ({ threadId: c.threadId, callId: c.callId, content: effect.content })) });
        if (!this.running) this.running = this.drain().finally(() => (this.running = null));
        return;
      }
      case 'chaos':
        try {
          if (effect.fault) {
            await this.api.inject({ fault: effect.fault, ...(this.sessionId ? { tfSessionId: this.sessionId } : {}) });
            this.note(`next call gets a ${effect.fault}`, 'muted', '⚡');
          } else {
            const st = await this.api.setChaos({ ...(effect.profile ? { profile: effect.profile } : {}), ...(effect.enabled !== undefined ? { enabled: effect.enabled } : {}) });
            this.extra({ kind: 'status', patch: { chaosEnabled: st.enabled, profile: st.profile, faultRate: st.faultRate } });
          }
        } catch (err) {
          this.note(`chaos: ${(err as Error).message}`, 'fail', '✗');
        }
        return;
      case 'new':
        this.queue = [];
        this.sessionId = null;
        this.mcpSessionId = null;
        this.extra({ kind: 'reset' });
        return;
      case 'resume':
        await this.resume(effect.sessionId);
        return;
      case 'agent':
        this.agent = effect.name;
        this.sessionId = null;
        this.extra({ kind: 'reset' });
        this.extra({ kind: 'status', patch: { agent: effect.name } });
        this.note(`talking to ${effect.name} now`, 'muted');
        return;
      case 'bench':
        try {
          const st = this.getState().status;
          const { benchId } = await this.api.startBench({ suite: 'github', profile: st.profile, seeds: 1, generations: 1 });
          this.note(`benchmark ${benchId} started · watch it on the dashboard`, 'muted', '▣');
        } catch (err) {
          this.note(`bench: ${(err as Error).message}`, 'fail', '✗');
        }
        return;
      case 'sessions':
        await this.loadSessions();
        return;
      case 'skills':
        await this.refreshSkills();
        return;
      case 'verifySkill':
      case 'retireSkill':
        this.note(`${effect.kind === 'verifySkill' ? 'checking' : 'retiring'} a single skill runs from the CLI for now: monk learn`, 'muted');
        return;
      case 'editCalls':
        this.note("editing calls isn't wired yet · press n and say what to change", 'muted');
        return;
      case 'copy':
        process.stdout.write(`\x1b]52;c;${Buffer.from(effect.text).toString('base64')}\x07`);
        this.note('copied', 'ok', '✓');
        return;
      case 'bell':
        process.stdout.write('\x07');
        return;
      case 'notice':
        this.note(effect.text, 'muted');
        return;
      case 'quit':
        return;
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      const out: SessionSummary[] = [];
      const page = await this.client.sessions.list({ limit: 20 });
      for await (const s of page) {
        out.push({ id: s.id, title: s.title ?? s.id, updatedAt: ago(s.updatedAt), platform: s.metadata?.monk_client ?? (s.source ? 'schedule' : 'web') });
        if (out.length >= 20) break;
      }
      this.extra({ kind: 'sessions', sessions: out });
    } catch (err) {
      this.note(`couldn't list sessions: ${(err as Error).message}`, 'fail', '✗');
    }
  }

  /** Rebuilds the conversation from TrueForge's stored events. */
  private async resume(id: string): Promise<void> {
    this.extra({ kind: 'reset' });
    this.sessionId = id;
    rememberSession(id);
    this.extra({ kind: 'session', id });
    try {
      const items: TrueForgeApi.SessionEventItem[] = [];
      for await (const it of await this.client.sessions.listEvents(id, { limit: 500 })) items.push(it);
      items.reverse();
      const byTurn = new Map<string, TrueForgeApi.TurnStreamingEvent[]>();
      for (const it of items) byTurn.set(it.turnId, [...(byTurn.get(it.turnId) ?? []), it.event as TrueForgeApi.TurnStreamingEvent]);
      for (const events of byTurn.values()) {
        const created = events.find((e) => e.type === 'turn.created');
        if (created?.type === 'turn.created') {
          for (const inp of created.input ?? []) {
            if (inp.type === 'user.message') this.dispatch({ type: 'send', text: typeof inp.content === 'string' ? inp.content : '(attachment)', at: Date.parse(created.createdAt) } as Action);
          }
        }
        async function* gen() {
          yield* events;
        }
        for await (const ev of normalizeTurnStream(gen())) {
          if (ev.type === 'mcp.initialize') {
            const mine = ev.servers.find((s) => s.name === CHAOS_PROXY_SERVER_NAME && s.sessionId);
            if (mine?.sessionId) this.mcpSessionId = mine.sessionId;
          }
          this.dispatch({ type: 'turn', ev, at: Date.now() });
        }
      }
      this.note('resumed', 'muted', '↺');
    } catch (err) {
      this.note(`couldn't resume ${id}: ${(err as Error).message}`, 'fail', '✗');
    }
  }
}
