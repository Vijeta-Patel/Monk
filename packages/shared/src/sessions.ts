import { eq } from 'drizzle-orm';
import type { MonkConfig } from './config.ts';
import type { MonkDb } from './db/index.ts';
import { mcpSessions } from './db/schema.ts';
import { publish } from './events.ts';
import { costUsd } from './pricing.ts';
import { CHAOS_PROXY_SERVER_NAME } from './tools.ts';
import { runTurn, type TrueForge, type TurnEvent, type TurnInput } from './trueforge.ts';

/** Records which TrueForge session owns a chaos-proxy MCP session. Idempotent. */
export async function linkSession(db: MonkDb, link: { tfSessionId: string; mcpSessionId: string }): Promise<void> {
  const [existing] = await db.select().from(mcpSessions).where(eq(mcpSessions.mcpSessionId, link.mcpSessionId));
  if (existing?.tfSessionId === link.tfSessionId) return;
  await db
    .insert(mcpSessions)
    .values({ mcpSessionId: link.mcpSessionId, tfSessionId: link.tfSessionId })
    .onConflictDoUpdate({ target: mcpSessions.mcpSessionId, set: { tfSessionId: link.tfSessionId } });
  await publish(db, { kind: 'session.linked', data: link });
}

export async function mcpSessionsFor(db: MonkDb, tfSessionId: string): Promise<string[]> {
  const rows = await db.select().from(mcpSessions).where(eq(mcpSessions.tfSessionId, tfSessionId));
  return rows.map((r) => r.mcpSessionId);
}

/**
 * runTurn plus Monk bookkeeping: links the chaos-proxy MCP session and publishes turn cost.
 * Every Node-side client (gateway, cron, evals) should use this instead of runTurn.
 */
export async function* runMonkTurn(
  deps: { db: MonkDb; client: TrueForge; cfg: MonkConfig },
  sessionId: string,
  input: TurnInput,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<TurnEvent> {
  for await (const ev of runTurn(deps.client, sessionId, input, opts)) {
    if (ev.type === 'mcp.initialize') {
      for (const s of ev.servers) {
        if (s.name === CHAOS_PROXY_SERVER_NAME && s.sessionId) await linkSession(deps.db, { tfSessionId: sessionId, mcpSessionId: s.sessionId });
      }
    }
    if (ev.type === 'turn.done') {
      await publish(deps.db, {
        kind: 'session.cost',
        data: {
          tfSessionId: sessionId,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          costUsd: costUsd(deps.cfg.MODEL, ev.inputTokens, ev.outputTokens),
        },
      });
    }
    yield ev;
  }
}
