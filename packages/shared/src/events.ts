import { gt, asc } from 'drizzle-orm';
import { z } from 'zod';
import type { MonkDb } from './db/index.ts';
import { events } from './db/schema.ts';

export const FAULT_TYPES = [
  'timeout', 'rate_limit', 'server_error', 'malformed_json', 'schema_drift',
  'auth_expired', 'permission_denied', 'stale_data', 'partial_result', 'latency_spike',
] as const;
export const MOBILE_FAULT_TYPES = [
  'app_crash', 'permission_dialog', 'popup', 'element_not_found', 'slow_network', 'orientation_flip',
] as const;
export const ALL_FAULT_TYPES = [...FAULT_TYPES, ...MOBILE_FAULT_TYPES] as const;
export const FaultTypeSchema = z.enum(ALL_FAULT_TYPES);
export type FaultType = z.infer<typeof FaultTypeSchema>;

const sess = { mcpSessionId: z.string(), tfSessionId: z.string().nullable() };

export const MonkEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tool.call'), data: z.object({ ...sess, callId: z.string(), upstream: z.string(), tool: z.string(), durationMs: z.number(), status: z.enum(['ok', 'error', 'fault']), faultId: z.string().nullable() }) }),
  z.object({ kind: z.literal('fault.injected'), data: z.object({ ...sess, faultId: z.string(), tool: z.string(), faultType: FaultTypeSchema, profile: z.string(), manual: z.boolean() }) }),
  z.object({ kind: z.literal('fault.recovered'), data: z.object({ ...sess, faultId: z.string(), tool: z.string(), faultType: FaultTypeSchema, steps: z.number(), ms: z.number() }) }),
  z.object({ kind: z.literal('fault.unrecovered'), data: z.object({ ...sess, faultId: z.string(), tool: z.string(), faultType: FaultTypeSchema }) }),
  z.object({ kind: z.literal('chaos.config'), data: z.object({ enabled: z.boolean(), profile: z.string(), faultRate: z.number() }) }),
  z.object({ kind: z.literal('session.linked'), data: z.object({ mcpSessionId: z.string(), tfSessionId: z.string() }) }),
  z.object({ kind: z.literal('session.cost'), data: z.object({ tfSessionId: z.string(), inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() }) }),
  z.object({ kind: z.literal('skill.drafted'), data: z.object({ name: z.string(), type: z.string(), sourceSessions: z.array(z.string()) }) }),
  z.object({ kind: z.literal('skill.verified'), data: z.object({ name: z.string(), kept: z.boolean(), baselinePass: z.number(), withSkillPass: z.number(), baselineSteps: z.number(), withSkillSteps: z.number() }) }),
  z.object({ kind: z.literal('skill.committed'), data: z.object({ name: z.string(), version: z.number(), commitSha: z.string().nullable() }) }),
  z.object({ kind: z.literal('skill.discarded'), data: z.object({ name: z.string(), reason: z.string() }) }),
  z.object({ kind: z.literal('skill.retired'), data: z.object({ name: z.string(), winRate: z.number() }) }),
  z.object({ kind: z.literal('skill.used'), data: z.object({ name: z.string(), tfSessionId: z.string() }) }),
  z.object({ kind: z.literal('eval.run.started'), data: z.object({ runId: z.string(), benchId: z.string().nullable(), suite: z.string(), profile: z.string(), seed: z.number(), generation: z.number(), variant: z.string(), tasks: z.number() }) }),
  z.object({ kind: z.literal('eval.task.done'), data: z.object({ runId: z.string(), taskId: z.string(), passed: z.boolean(), faultsInjected: z.number(), faultsRecovered: z.number(), costUsd: z.number() }) }),
  z.object({ kind: z.literal('eval.run.done'), data: z.object({ runId: z.string(), summary: z.record(z.string(), z.number()) }) }),
  z.object({ kind: z.literal('cron.run'), data: z.object({ jobId: z.string(), name: z.string(), status: z.enum(['started', 'ok', 'error', 'skipped']), detail: z.string().optional() }) }),
]);
export type MonkEvent = z.infer<typeof MonkEventSchema>;
export type MonkEventKind = MonkEvent['kind'];
export type StoredEvent = MonkEvent & { id: number; ts: string; sessionId: string | null };

function sessionOf(e: MonkEvent): string | null {
  const d = e.data as Record<string, unknown>;
  const v = d.tfSessionId ?? d.mcpSessionId;
  return typeof v === 'string' ? v : null;
}

export async function publish(db: MonkDb, event: MonkEvent): Promise<number> {
  const parsed = MonkEventSchema.parse(event);
  const [row] = await db
    .insert(events)
    .values({ kind: parsed.kind, sessionId: sessionOf(parsed), data: parsed.data })
    .returning({ id: events.id });
  return row?.id ?? 0;
}

export async function readEvents(db: MonkDb, afterId = 0, limit = 500): Promise<StoredEvent[]> {
  const rows = await db.select().from(events).where(gt(events.id, afterId)).orderBy(asc(events.id)).limit(limit);
  return rows.map((r) => ({ id: r.id, ts: r.ts, sessionId: r.sessionId, kind: r.kind, data: r.data }) as StoredEvent);
}

/** Polls the events table; cheap on SQLite WAL and works across processes. */
export async function* tailEvents(
  db: MonkDb,
  opts: { afterId?: number; intervalMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<StoredEvent> {
  let cursor = opts.afterId ?? 0;
  const interval = opts.intervalMs ?? 250;
  while (!opts.signal?.aborted) {
    const batch = await readEvents(db, cursor);
    for (const e of batch) {
      cursor = e.id;
      yield e;
    }
    if (batch.length === 0) await new Promise((r) => setTimeout(r, interval));
  }
}

export async function lastEventId(db: MonkDb): Promise<number> {
  const row = db.raw.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get() as { id: number } | undefined;
  return row?.id ?? 0;
}
