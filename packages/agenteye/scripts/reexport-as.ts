// Re-sends one TrueForge session to AgentEye under a new session id (after an exporter fix).
//   node scripts/reexport-as.ts <tf-session-id> <new-agenteye-session-id>
import { DESTRUCTIVE_TOOL_GLOBS, createTrueForgeClient, loadConfig, matchesAny, openDb } from '@monk/shared';
import { mapSession, postEvents } from '../src/index.ts';

const [tf, as] = process.argv.slice(2);
if (!tf || !as) throw new Error('usage: reexport-as.ts <tf-session-id> <new-id>');
const cfg = loadConfig();
const client = createTrueForgeClient(cfg);
const items = [];
for await (const it of await client.sessions.listEvents(tf, { limit: 100 })) items.push(it);
const events = items.reverse().map((i) => i.event);
openDb(cfg.MONK_DB_PATH);
const lines = mapSession(events as never, [], { tfSessionId: as, agentId: cfg.AGENTEYE_AGENT_ID, environment: cfg.AGENTEYE_ENVIRONMENT, model: cfg.MODEL, costUsd: 0, eval: null, destructive: (n) => matchesAny(n, DESTRUCTIVE_TOOL_GLOBS) });
console.log(await postEvents(cfg, lines), lines.map((l) => l.type).join(' '));
