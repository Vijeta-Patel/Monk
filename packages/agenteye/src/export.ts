// Ships TrueForge sessions to AgentEye. Runs inside `monk up` (live sessions and benchmark tasks
// as they finish) and from `monk agenteye export` (backfill). Posts straight to the local
// instance with Monk's own key, so that instance only ever holds Monk sessions.
import { createHash } from 'node:crypto';
import {
  and, eq, inArray, matchesAny, DESTRUCTIVE_TOOL_GLOBS, mcpSessionsFor, schema, tailEvents,
  type MonkConfig, type MonkDb, type TrueForge, type TrueForgeApi,
} from '@monk/shared';
import { environmentFor, mapSession, toNdjson, type AgentEyeEvent, type EvalRecord, type FaultRecord } from './mapping.ts';

export type ExportResult = { tfSessionId: string; sent: number; skipped: number; environment: string; ended: boolean };

const keyOf = (e: AgentEyeEvent) => createHash('sha1').update(JSON.stringify(e)).digest('hex').slice(0, 16);

async function fetchEvents(client: TrueForge, id: string): Promise<TrueForgeApi.SessionEvent[]> {
  const items: TrueForgeApi.SessionEventItem[] = [];
  for await (const it of await client.sessions.listEvents(id, { limit: 100 })) items.push(it);
  // listEvents pages newest first; keep the server's order within equal timestamps.
  const ordered = items.reverse().map((i, idx) => ({ ev: i.event, idx }));
  ordered.sort((a, b) => (a.ev.createdAt < b.ev.createdAt ? -1 : a.ev.createdAt > b.ev.createdAt ? 1 : a.idx - b.idx));
  return ordered.map((o) => o.ev);
}

async function faultsFor(db: MonkDb, tfSessionId: string): Promise<FaultRecord[]> {
  const ids = await mcpSessionsFor(db, tfSessionId);
  if (!ids.length) return [];
  const rows = await db.select().from(schema.faults).where(inArray(schema.faults.mcpSessionId, ids));
  return rows.map((f) => ({ id: f.id, tool: f.tool, faultType: f.faultType, injectedAt: f.injectedAt, recoveredAt: f.recoveredAt, recoverySteps: f.recoverySteps, outcome: f.outcome, manual: f.manual }));
}

async function evalFor(db: MonkDb, tfSessionId: string): Promise<EvalRecord | null> {
  const [r] = await db.select().from(schema.evalResults).where(eq(schema.evalResults.tfSessionId, tfSessionId));
  if (!r) return null;
  const [run] = await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.id, r.runId));
  if (!run) return null;
  return {
    taskId: r.taskId, split: r.split, passed: r.passed, suite: run.suite, generation: run.generation, seed: run.seed,
    profile: run.profile, variant: run.variant, runId: run.id, benchId: run.benchId, approvalsRequested: r.approvalsRequested,
    approvalsRequired: r.approvalsRequired, destructiveUnapproved: r.destructiveUnapproved, costUsd: r.costUsd, error: r.error,
  };
}

function sessionCost(db: MonkDb, tfSessionId: string): number {
  const row = db.raw
    .prepare(`SELECT COALESCE(SUM(json_extract(data, '$.costUsd')), 0) AS c FROM events WHERE kind = 'session.cost' AND session_id = ?`)
    .get(tfSessionId) as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function postEvents(cfg: MonkConfig, lines: AgentEyeEvent[], f: typeof fetch = fetch): Promise<{ accepted: number; skipped: number }> {
  let accepted = 0;
  let skipped = 0;
  for (let i = 0; i < lines.length; i += 500) {
    const body = toNdjson(lines.slice(i, i + 500));
    const res = await f(`${cfg.AGENTEYE_URL.replace(/\/+$/, '')}/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.AGENTEYE_INGEST_KEY}`, 'content-type': 'application/x-ndjson' },
      body,
    });
    if (!res.ok) throw new Error(`AgentEye ingest ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const out = (await res.json()) as { accepted?: number; skipped?: number };
    accepted += out.accepted ?? 0;
    skipped += out.skipped ?? 0;
  }
  return { accepted, skipped };
}

export async function exportSession(
  deps: { db: MonkDb; client: TrueForge; cfg: MonkConfig; fetch?: typeof fetch },
  tfSessionId: string,
): Promise<ExportResult> {
  const { db, client, cfg } = deps;
  const [events, faults, ev] = await Promise.all([fetchEvents(client, tfSessionId), faultsFor(db, tfSessionId), evalFor(db, tfSessionId)]);
  const environment = environmentFor(ev, cfg.AGENTEYE_ENVIRONMENT);
  const lines = mapSession(events as never, faults, {
    tfSessionId,
    agentId: cfg.AGENTEYE_AGENT_ID,
    environment,
    model: cfg.MODEL,
    costUsd: ev?.costUsd || sessionCost(db, tfSessionId),
    eval: ev,
    destructive: (tool) => matchesAny(tool, DESTRUCTIVE_TOOL_GLOBS),
  });
  const [prev] = await db.select().from(schema.agenteyeExports).where(eq(schema.agenteyeExports.tfSessionId, tfSessionId));
  const sent = new Set(prev?.sentKeys ?? []);
  const fresh = lines.filter((l) => !sent.has(keyOf(l)));
  const ended = lines.some((l) => l.type === 'agent_end');
  if (fresh.length === 0) return { tfSessionId, sent: 0, skipped: 0, environment, ended };
  const res = await postEvents(cfg, fresh, deps.fetch);
  if (res.skipped > 0) console.warn(`[agenteye] ${res.skipped} line(s) of ${tfSessionId} were rejected by AgentEye`);
  const keys = [...sent, ...fresh.map(keyOf)];
  await db
    .insert(schema.agenteyeExports)
    .values({ tfSessionId, sentKeys: keys, environment, ended })
    .onConflictDoUpdate({ target: schema.agenteyeExports.tfSessionId, set: { sentKeys: keys, environment, ended, updatedAt: new Date().toISOString() } });
  return { tfSessionId, sent: res.accepted, skipped: res.skipped, environment, ended };
}

/** Sessions to backfill: everything eval runs touched, optionally one bench, plus linked live sessions. */
export async function sessionsToExport(db: MonkDb, opts: { benchId?: string; includeLive?: boolean } = {}): Promise<string[]> {
  const out = new Set<string>();
  const runs = opts.benchId
    ? await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.benchId, opts.benchId))
    : await db.select().from(schema.evalRuns);
  const runIds = runs.map((r) => r.id);
  if (runIds.length) {
    for (const r of await db.select().from(schema.evalResults).where(inArray(schema.evalResults.runId, runIds))) if (r.tfSessionId) out.add(r.tfSessionId);
  }
  if (opts.includeLive ?? !opts.benchId) {
    const rows = db.raw.prepare(`SELECT DISTINCT session_id AS s FROM events WHERE kind = 'session.cost' AND session_id IS NOT NULL`).all() as { s: string }[];
    for (const r of rows) out.add(r.s);
  }
  return [...out];
}

/**
 * Live exporter for `monk up`: exports a session a few seconds after each finished turn
 * (session.cost) and after each benchmark task (eval.task.done, which carries pass/fail).
 */
export function startAgentEyeExporter(deps: { db: MonkDb; client: TrueForge; cfg: MonkConfig; log?: (s: string) => void }): { close(): Promise<void> } {
  const { db, cfg } = deps;
  const log = deps.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const ctrl = new AbortController();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (id: string, ms: number) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        exportSession(deps, id)
          .then((r) => r.sent && log(`[agenteye] ${id} → ${r.environment}: ${r.sent} events${r.ended ? ' (ended)' : ''}`))
          .catch((err: unknown) => log(`[agenteye] export ${id} failed: ${(err as Error).message}`));
      }, ms),
    );
  };
  void (async () => {
    const start = (db.raw.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get() as { id: number }).id;
    for await (const e of tailEvents(db, { afterId: start, signal: ctrl.signal, intervalMs: 500 })) {
      if (e.kind === 'session.cost') {
        const id = (e.data as { tfSessionId: string }).tfSessionId;
        // Benchmark sessions wait for eval.task.done so their pass/fail rides on agent_end.
        const isEval = (await db.select().from(schema.evalResults).where(eq(schema.evalResults.tfSessionId, id))).length > 0;
        schedule(id, isEval ? 3000 : 8000);
      } else if (e.kind === 'eval.task.done') {
        const d = e.data as { runId: string; taskId: string };
        const [r] = await db.select().from(schema.evalResults).where(and(eq(schema.evalResults.runId, d.runId), eq(schema.evalResults.taskId, d.taskId)));
        if (r?.tfSessionId) schedule(r.tfSessionId, 500);
      }
    }
  })();
  log(`agenteye      exporting to ${cfg.AGENTEYE_URL} as ${cfg.AGENTEYE_AGENT_ID}`);
  return {
    close: async () => {
      ctrl.abort();
      for (const t of timers.values()) clearTimeout(t);
    },
  };
}
