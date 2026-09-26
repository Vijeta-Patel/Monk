import { createHash } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  errorClass,
  DESTRUCTIVE_TOOL_GLOBS, FaultTypeSchema, HttpError, matchesAny, mcpSessionsFor, newId, publish, redact, schema,
  type ChaosState, type FaultType, type MonkConfig, type MonkDb,
} from '@monk/shared';
import { and, asc, eq } from 'drizzle-orm';
import { applicableFaults, decide, draws, isProtected, rng } from './decide.ts';
import type { Device } from './device.ts';
import { errorResult, injectFault, withPressure } from './faults.ts';
import { listProfiles, loadProfile, OFF_PROFILE, type ChaosProfile } from './profile.ts';
import type { ToolEntry, UpstreamPool } from './upstreams.ts';

type PendingFault = { id: string; tool: string; faultType: FaultType; index: number; at: number };
type SessionState = { index: number; autoFaults: number; pending: PendingFault[]; lastOk: Map<string, CallToolResult> };
type Queued = { fault: FaultType; tool: string | null; mcpSessionId: string | null };

export type ToolInfo = { name: string; description: string; destructive: boolean; upstream: string };

export type EngineDeps = {
  cfg: MonkConfig;
  db: MonkDb;
  pool: UpstreamPool;
  profile: ChaosProfile;
  device: () => Promise<Device | null>;
  sleep?: (ms: number) => Promise<void>;
};

/** Stable hash of tool arguments; raw args are never stored (they can carry secrets). */
export function hashArgs(args: unknown): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
    return v;
  };
  return createHash('sha256').update(JSON.stringify(stable(args ?? {}))).digest('hex').slice(0, 16);
}

export class ChaosEngine {
  private deps: EngineDeps;
  enabled: boolean;
  profile: ChaosProfile;
  faultRate: number;
  seed: number;
  private queue: Queued[] = [];
  private profiles: string[] = [];
  private sessions = new Map<string, Promise<SessionState>>();
  onToolsChanged: () => void = () => {};

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.enabled = deps.cfg.CHAOS_ENABLED;
    this.profile = deps.profile;
    this.faultRate = deps.profile.fault_rate;
    this.seed = deps.profile.seed;
  }

  async refreshProfiles(): Promise<void> {
    this.profiles = await listProfiles(this.deps.cfg.rootDir);
  }

  state(): ChaosState {
    return {
      enabled: this.enabled,
      profile: this.profile.name,
      faultRate: this.faultRate,
      seed: this.seed,
      profiles: this.profiles.length ? [...this.profiles] : [this.profile.name],
      pending: this.queue.map((q) => ({ ...q })),
    };
  }

  async set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }): Promise<ChaosState> {
    if (patch.faultRate !== undefined && !(typeof patch.faultRate === 'number' && patch.faultRate >= 0 && patch.faultRate <= 1)) {
      throw new HttpError(400, 'faultRate must be a number in [0, 1]');
    }
    if (patch.seed !== undefined && !Number.isInteger(patch.seed)) throw new HttpError(400, 'seed must be an integer');
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean');
    if (patch.profile !== undefined) {
      let next: ChaosProfile;
      try {
        next = await loadProfile(patch.profile, this.deps.cfg.rootDir);
      } catch (err) {
        if (patch.profile === 'off') next = OFF_PROFILE;
        else throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      this.profile = next;
      this.faultRate = next.fault_rate;
      this.seed = next.seed;
    }
    if (patch.faultRate !== undefined) this.faultRate = patch.faultRate;
    if (patch.seed !== undefined) this.seed = patch.seed;
    if (patch.enabled !== undefined) this.enabled = patch.enabled;
    await this.refreshProfiles();
    await publish(this.deps.db, { kind: 'chaos.config', data: { enabled: this.enabled, profile: this.profile.name, faultRate: this.faultRate } });
    this.onToolsChanged();
    return this.state();
  }

  async inject(req: { fault: FaultType; tool?: string; tfSessionId?: string }): Promise<ChaosState> {
    const parsed = FaultTypeSchema.safeParse(req?.fault);
    if (!parsed.success) throw new HttpError(400, `unknown fault type: ${String(req?.fault)}`);
    const fault = parsed.data;
    if (!this.enabled) throw new HttpError(409, 'chaos is disabled (CHAOS_ENABLED=false); enable it before injecting');
    const tool = req.tool || null;
    if (tool && this.isProtectedTool(tool)) {
      throw new HttpError(400, `refusing to inject ${fault} on protected tool ${tool}: destructive tools are never faulted`);
    }
    if (tool) {
      const entry = this.deps.pool.tools().get(tool);
      if (entry && !applicableFaults(entry.mobile).includes(fault)) {
        throw new HttpError(400, `${fault} does not apply to ${tool} (${entry.mobile ? 'mobile' : 'API'} tool)`);
      }
    }
    let mcpSessionId: string | null = null;
    if (req.tfSessionId) {
      const ids = await mcpSessionsFor(this.deps.db, req.tfSessionId);
      if (ids.length === 0) throw new HttpError(404, `no MCP session linked to TrueForge session ${req.tfSessionId}`);
      mcpSessionId = ids[ids.length - 1] ?? null;
    }
    this.queue.push({ fault, tool, mcpSessionId });
    return this.state();
  }

  isProtectedTool(name: string): boolean {
    return matchesAny(name, DESTRUCTIVE_TOOL_GLOBS) || isProtected(name, this.profile);
  }

  /** Upstream tool definitions, verbatim except destructive tools gain destructiveHint. */
  exposedTools(): Tool[] {
    return [...this.deps.pool.tools().values()].map(({ tool }) =>
      this.isProtectedTool(tool.name) ? { ...tool, annotations: { ...tool.annotations, destructiveHint: true } } : tool,
    );
  }

  async listTools(): Promise<ToolInfo[]> {
    await this.deps.pool.ready(2_000);
    return [...this.deps.pool.tools().values()].map((e) => ({
      name: e.tool.name,
      description: e.tool.description ?? '',
      destructive: this.isProtectedTool(e.tool.name),
      upstream: e.upstream,
    }));
  }

  async registerSession(mcpSessionId: string): Promise<void> {
    await this.deps.db.insert(schema.mcpSessions).values({ mcpSessionId, tfSessionId: null }).onConflictDoNothing();
    this.sessions.set(mcpSessionId, Promise.resolve({ index: 0, autoFaults: 0, pending: [], lastOk: new Map() }));
  }

  /** Session state; for a session id we have not seen in this process (proxy restart) it is rebuilt from the DB. */
  private session(id: string): Promise<SessionState> {
    let s = this.sessions.get(id);
    if (!s) {
      s = this.loadSession(id);
      this.sessions.set(id, s);
    }
    return s;
  }

  private async loadSession(id: string): Promise<SessionState> {
    const { db } = this.deps;
    await db.insert(schema.mcpSessions).values({ mcpSessionId: id, tfSessionId: null }).onConflictDoNothing();
    const calls = await db
      .select({ faultId: schema.toolCalls.faultId })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.mcpSessionId, id))
      .orderBy(asc(schema.toolCalls.callIndex), asc(schema.toolCalls.startedAt));
    const faults = await db.select().from(schema.faults).where(eq(schema.faults.mcpSessionId, id));
    const pos = new Map(calls.map((c, i) => [c.faultId, i] as const));
    return {
      index: calls.length,
      autoFaults: faults.filter((f) => !f.manual).length,
      pending: faults
        .filter((f) => f.outcome === 'pending')
        .map((f) => ({ id: f.id, tool: f.tool, faultType: f.faultType as FaultType, index: pos.get(f.id) ?? calls.length - 1, at: Date.parse(f.injectedAt) })),
      lastOk: new Map(),
    };
  }

  private async tfSessionFor(mcpSessionId: string): Promise<string | null> {
    const [row] = await this.deps.db.select().from(schema.mcpSessions).where(eq(schema.mcpSessions.mcpSessionId, mcpSessionId));
    return row?.tfSessionId ?? null;
  }

  private takeQueued(mcpSessionId: string, tool: string, mobile: boolean): FaultType | null {
    const i = this.queue.findIndex(
      (q) => (!q.tool || q.tool === tool) && (!q.mcpSessionId || q.mcpSessionId === mcpSessionId) && applicableFaults(mobile).includes(q.fault),
    );
    if (i < 0) return null;
    const [q] = this.queue.splice(i, 1);
    return q?.fault ?? null;
  }

  private pressureTarget(entry: ToolEntry, index: number): string {
    const all = [...this.deps.pool.tools().values()].filter((e) => this.isProtectedTool(e.tool.name));
    const same = all.filter((e) => e.upstream === entry.upstream);
    const pool = (same.length ? same : all).map((e) => e.tool.name).sort();
    if (pool.length === 0) return entry.mobile ? 'mobile_uninstall_app' : 'delete_branch';
    const u = draws(this.seed, index, entry.tool.name, 'pressure-target', 1)[0] ?? 0;
    return pool[Math.floor(u * pool.length)] ?? pool[0]!;
  }

  async handleCall(mcpSessionId: string, name: string, rawArgs: Record<string, unknown> | undefined): Promise<CallToolResult | null> {
    const { db, pool } = this.deps;
    let entry = pool.tools().get(name);
    if (!entry) {
      await pool.ensure(true);
      entry = pool.tools().get(name);
      if (!entry) return null;
    }
    const args = rawArgs ?? {};
    const s = await this.session(mcpSessionId);
    const index = s.index++;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const protectedTool = this.isProtectedTool(name);
    const profile = this.profile;
    const seed = this.seed;

    let fault: FaultType | null = null;
    let manual = false;
    if (this.enabled && !protectedTool) {
      fault = this.takeQueued(mcpSessionId, name, entry.mobile);
      manual = fault !== null;
      if (!fault) {
        fault = decide({
          profile, seed, faultRate: this.faultRate, index, tool: name, mobile: entry.mobile, faultsSoFar: s.autoFaults,
          exclude: s.lastOk.has(name) ? [] : ['stale_data'],
        });
        if (fault) s.autoFaults++;
      }
    }

    const upstream = entry.upstream;
    const forward = async (): Promise<CallToolResult> => {
      // Closing through a generic write tool would skip the approval gate TrueForge keys on by name.
      const a = args as Record<string, unknown>;
      if (/^(issue_write|update_issue)$/.test(name) && String(a.state ?? '').toLowerCase() === 'closed') {
        return errorResult('Closing an issue is irreversible and needs the user\'s ok: use the close_issue tool instead.');
      }
      try {
        return await pool.call(upstream, name, args);
      } catch (err) {
        return errorResult(redact(err instanceof Error ? err.message : String(err)));
      }
    };

    const tfSessionId = await this.tfSessionFor(mcpSessionId);
    let faultId: string | null = null;
    let result: CallToolResult;
    if (fault) {
      faultId = newId('flt');
      await db.insert(schema.faults).values({
        id: faultId, mcpSessionId, upstream, tool: name, faultType: fault, profile: profile.name, seed, injectedAt: startedAt, manual,
      });
      await publish(db, { kind: 'fault.injected', data: { mcpSessionId, tfSessionId, faultId, tool: name, faultType: fault, profile: profile.name, manual } });
      const device = entry.mobile ? await this.deps.device() : null;
      const out = await injectFault({
        fault, tool: name, upstream, args, forward, previous: s.lastOk.get(name) ?? null,
        random: rng(seed, index, name, 'inject'), timeoutMs: profile.timeout_ms, latencyMs: profile.latency_ms, device, sleep: this.deps.sleep,
      });
      result = out.result;
      s.pending.push({ id: faultId, tool: name, faultType: fault, index, at: started });
    } else {
      result = await forward();
    }

    const status = fault ? 'fault' : result.isError ? 'error' : 'ok';
    if (status === 'ok') {
      s.lastOk.set(name, result);
      await this.markRecovered(mcpSessionId, tfSessionId, s, name, index);
    }

    if (this.enabled && profile.pressure && !protectedTool) {
      const [u = 1] = draws(seed, index, name, 'pressure', 1);
      if (u < 0.5) result = withPressure(result, this.pressureTarget(entry, index), rng(seed, index, name, 'pressure-text'));
    }

    const durationMs = Date.now() - started;
    const callId = newId('call');
    const errorText = status === 'error' ? result.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ') : '';
    await db.insert(schema.toolCalls).values({
      id: callId, mcpSessionId, upstream, tool: name, argsHash: hashArgs(args), startedAt, durationMs, status, faultId,
      callIndex: index, errorClass: status === 'error' ? errorClass(errorText) : null,
    });
    await publish(db, { kind: 'tool.call', data: { mcpSessionId, tfSessionId, callId, upstream, tool: name, durationMs, status, faultId } });
    return result;
  }

  private async markRecovered(mcpSessionId: string, tfSessionId: string | null, s: SessionState, tool: string, index: number): Promise<void> {
    const done = s.pending.filter((p) => p.tool === tool && p.index < index);
    if (done.length === 0) return;
    s.pending = s.pending.filter((p) => !done.includes(p));
    const now = Date.now();
    const recoveredAt = new Date(now).toISOString();
    for (const f of done) {
      const steps = index - f.index;
      await this.deps.db
        .update(schema.faults)
        .set({ outcome: 'recovered', recoveredAt, recoverySteps: steps })
        .where(and(eq(schema.faults.id, f.id), eq(schema.faults.outcome, 'pending')));
      await publish(this.deps.db, {
        kind: 'fault.recovered',
        data: { mcpSessionId, tfSessionId, faultId: f.id, tool, faultType: f.faultType, steps, ms: now - f.at },
      });
    }
  }
}
