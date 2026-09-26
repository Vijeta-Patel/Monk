// Posts a synthetic Monk session to AgentEye and reads it back: node scripts/smoke.ts
import { loadConfig } from '@monk/shared';
import { mapSession, postEvents } from '../src/index.ts';
import { EVAL, FAULTS, SESSION } from '../test/fixtures.ts';
const cfg = loadConfig();
const sid = `monk-smoke-${Date.now()}`;
const lines = mapSession(SESSION as never, FAULTS, { tfSessionId: sid, agentId: 'monk', environment: 'gen-2', model: cfg.MODEL || 'unset', costUsd: 0.0123, eval: EVAL, destructive: (n) => n.includes('delete') });
console.log('post', await postEvents(cfg, lines), 'of', lines.length);
const res = await fetch(`${cfg.AGENTEYE_URL}/v1/events?session_id=${sid}&limit=100`, { headers: { authorization: `Bearer ${cfg.AGENTEYE_INGEST_KEY}` } });
const body = (await res.json()) as { events?: { event_type?: string; type?: string }[] };
const items = (body.events ?? []) as { event_type?: string; type?: string }[];
console.log('read back', res.status, items.length, 'events:', [...new Set(items.map((i) => i.event_type ?? i.type))].join(','));
console.log(sid);
