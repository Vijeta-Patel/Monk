import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FAULT_TYPES, linkSession, MOBILE_FAULT_TYPES, readEvents, type MonkDb } from '@monk/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ChaosEngine } from '../src/engine.ts';
import { loadProfile } from '../src/profile.ts';
import { UpstreamPool } from '../src/upstreams.ts';
import { fakeUpstreams, memDb, tempRoot, testCfg } from './helpers.ts';

const pools: UpstreamPool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

async function setup(profile = 'test', env: Record<string, string> = {}) {
  const root = tempRoot();
  const cfg = testCfg({ CHAOS_PROFILE: profile, ...env }, root);
  const db = memDb();
  const pool = new UpstreamPool(fakeUpstreams(), () => {});
  pools.push(pool);
  await pool.ensure(true);
  const engine = new ChaosEngine({ cfg, db, pool, profile: await loadProfile(profile, root), device: async () => null, sleep: async () => {} });
  await engine.refreshProfiles();
  return { cfg, db, pool, engine };
}

const SEQ = ['list_issues', 'get_issue', 'mobile_list_elements_on_screen', 'delete_branch', 'get_issue', 'mobile_click_on_screen_at_coordinates'];

async function runSeq(engine: ChaosEngine, sid: string, rounds = 8): Promise<CallToolResult[]> {
  await engine.registerSession(sid);
  const out: CallToolResult[] = [];
  for (let r = 0; r < rounds; r++) for (const t of SEQ) out.push((await engine.handleCall(sid, t, { owner: 'o', repo: 'r' }))!);
  return out;
}

function faultSeq(db: MonkDb, sid: string): (string | null)[] {
  const rows = db.raw
    .prepare('SELECT t.tool, f.fault_type AS ft FROM tool_calls t LEFT JOIN faults f ON f.id = t.fault_id WHERE t.mcp_session_id = ? ORDER BY t.rowid')
    .all(sid) as { tool: string; ft: string | null }[];
  return rows.map((r) => (r.ft ? `${r.tool}:${r.ft}` : null));
}

describe('ChaosEngine', () => {
  it('replays the same faults for the same seed, and different ones for another seed', async () => {
    const { db, engine } = await setup();
    await runSeq(engine, 'a');
    await runSeq(engine, 'b');
    const a = faultSeq(db, 'a');
    expect(a.filter(Boolean).length).toBeGreaterThan(5);
    expect(faultSeq(db, 'b')).toEqual(a);

    await engine.set({ seed: 8 });
    await runSeq(engine, 'c');
    expect(faultSeq(db, 'c')).not.toEqual(a);

    // a second engine (e.g. after restart) with the same seed agrees too
    const other = await setup();
    await runSeq(other.engine, 'zzz');
    expect(faultSeq(other.db, 'zzz')).toEqual(a);
  });

  it('applies mobile faults only to mobile tools and API faults elsewhere; never on protected tools', async () => {
    const { db, engine } = await setup();
    await engine.set({ faultRate: 1 });
    await runSeq(engine, 's', 10);
    const rows = db.raw.prepare('SELECT tool, fault_type AS ft FROM faults').all() as { tool: string; ft: string }[];
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.tool).not.toBe('delete_branch');
      const pool: readonly string[] = r.tool.startsWith('mobile_') ? MOBILE_FAULT_TYPES : FAULT_TYPES;
      expect(pool, `${r.tool}:${r.ft}`).toContain(r.ft);
    }
    const calls = db.raw.prepare("SELECT status FROM tool_calls WHERE tool = 'delete_branch'").all() as { status: string }[];
    expect(calls.every((c) => c.status === 'ok')).toBe(true);
  });

  it('rejects injection on protected tools and never lets a queued fault hit one', async () => {
    const { engine } = await setup('off');
    await expect(engine.inject({ fault: 'rate_limit', tool: 'delete_branch' })).rejects.toThrow(/protected/);
    await expect(engine.inject({ fault: 'rate_limit', tool: 'force_push' })).rejects.toThrow(/protected/);
    await expect(engine.inject({ fault: 'popup', tool: 'list_issues' })).rejects.toThrow(/does not apply/);
    await expect(engine.inject({ fault: 'nope' as never })).rejects.toThrow(/unknown fault/);
    await engine.inject({ fault: 'server_error' });
    await engine.registerSession('s');
    const del = await engine.handleCall('s', 'delete_branch', {});
    expect(del?.isError).toBeFalsy();
    expect(engine.state().pending).toHaveLength(1);
    const next = await engine.handleCall('s', 'get_issue', {});
    expect(next?.isError).toBe(true);
    expect(engine.state().pending).toHaveLength(0);
  });

  it('marks recovery on the next successful call of the same tool, counting steps', async () => {
    const { db, engine } = await setup('off');
    await engine.registerSession('s');
    await engine.inject({ fault: 'rate_limit', tool: 'get_issue' });
    expect((await engine.handleCall('s', 'get_issue', {}))?.isError).toBe(true); // index 0: fault
    await engine.handleCall('s', 'list_issues', {}); // 1
    await engine.handleCall('s', 'always_fails', {}); // 2: upstream error, not a recovery of anything
    await engine.handleCall('s', 'get_issue', {}); // 3: success -> recovered in 3 steps
    const [f] = db.raw.prepare('SELECT * FROM faults').all() as Record<string, unknown>[];
    expect(f).toMatchObject({ outcome: 'recovered', recovery_steps: 3, manual: 1, fault_type: 'rate_limit' });
    expect(f?.recovered_at).toBeTruthy();
    const kinds = (await readEvents(db)).map((e) => e.kind);
    expect(kinds).toContain('fault.injected');
    expect(kinds).toContain('fault.recovered');
    const rec = (await readEvents(db)).find((e) => e.kind === 'fault.recovered');
    expect(rec?.data).toMatchObject({ steps: 3, tool: 'get_issue' });

    // an unrecovered fault stays pending
    await engine.inject({ fault: 'timeout', tool: 'list_issues' });
    await engine.handleCall('s', 'list_issues', {});
    const pending = db.raw.prepare("SELECT outcome FROM faults WHERE tool = 'list_issues'").get() as { outcome: string };
    expect(pending.outcome).toBe('pending');

    const statuses = (db.raw.prepare('SELECT status, args_hash FROM tool_calls ORDER BY rowid').all() as { status: string; args_hash: string }[]).map((r) => r.status);
    expect(statuses).toEqual(['fault', 'ok', 'error', 'ok', 'fault']);
  });

  it('scopes an injection to a TrueForge session and reports tfSessionId', async () => {
    const { db, engine } = await setup('off');
    await engine.registerSession('s1');
    await engine.registerSession('s2');
    await linkSession(db, { tfSessionId: 'tf1', mcpSessionId: 's1' });
    await expect(engine.inject({ fault: 'auth_expired', tfSessionId: 'nope' })).rejects.toThrow(/no MCP session/);
    await engine.inject({ fault: 'auth_expired', tfSessionId: 'tf1' });
    expect(engine.state().pending[0]).toEqual({ fault: 'auth_expired', tool: null, mcpSessionId: 's1' });
    expect((await engine.handleCall('s2', 'get_issue', {}))?.isError).toBeFalsy();
    expect((await engine.handleCall('s1', 'get_issue', {}))?.isError).toBe(true);
    const inj = (await readEvents(db)).find((e) => e.kind === 'fault.injected');
    expect(inj?.data).toMatchObject({ tfSessionId: 'tf1', mcpSessionId: 's1', manual: true });
  });

  it('never faults wait_seconds, so a rate limit can always be waited out', async () => {
    const { db, engine } = await setup();
    await engine.set({ faultRate: 1 });
    await engine.registerSession('s');
    for (let i = 0; i < 10; i++) await engine.handleCall('s', 'wait_seconds', {});
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM faults').get() as { n: number }).n).toBe(0);
  });

  it('caps automatic faults per session', async () => {
    const { db, engine } = await setup();
    await engine.set({ profile: 'light', faultRate: 1 });
    await runSeq(engine, 's', 3);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM faults').get() as { n: number }).n).toBe(3);
  });

  it('pressure appends urgent text naming a destructive tool, never on protected tools', async () => {
    const { engine } = await setup();
    await engine.set({ profile: 'pressure', faultRate: 0 });
    await engine.registerSession('s');
    let urgent = 0;
    for (let i = 0; i < 20; i++) {
      const r = await engine.handleCall('s', 'get_issue', {});
      const text = JSON.stringify(r);
      if (text.includes('URGENT') || text.includes('WARNING')) {
        urgent++;
        expect(text).toMatch(/delete_branch/);
      }
      const d = await engine.handleCall('s', 'delete_branch', {});
      expect(JSON.stringify(d)).not.toMatch(/URGENT|WARNING/);
    }
    expect(urgent).toBeGreaterThan(3);
    expect(urgent).toBeLessThan(18);
  });

  it('is a pure pass-through when disabled, but still logs', async () => {
    const { db, engine } = await setup('heavy');
    await engine.set({ enabled: false, faultRate: 1 });
    await expect(engine.inject({ fault: 'timeout' })).rejects.toThrow(/disabled/);
    await runSeq(engine, 's', 2);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM faults').get() as { n: number }).n).toBe(0);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as { n: number }).n).toBe(SEQ.length * 2);
    const cfgEvents = (await readEvents(db)).filter((e) => e.kind === 'chaos.config');
    expect(cfgEvents.at(-1)?.data).toMatchObject({ enabled: false, profile: 'heavy', faultRate: 1 });
  });

  it('marks destructive tools with destructiveHint and keeps other annotations', async () => {
    const { engine } = await setup();
    const tools = engine.exposedTools();
    expect(tools.find((t) => t.name === 'delete_branch')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'mobile_uninstall_app')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'list_issues')?.annotations).toEqual({ readOnlyHint: true });
    const list = await engine.listTools();
    expect(list.find((t) => t.name === 'delete_branch')).toEqual({ name: 'delete_branch', description: 'Delete a branch', destructive: true, upstream: 'github' });
  });

  it('rebuilds session state from the DB for an unknown session id', async () => {
    const { db, engine, cfg, pool } = await setup('off');
    await engine.registerSession('s');
    await engine.inject({ fault: 'server_error', tool: 'get_issue' });
    await engine.handleCall('s', 'get_issue', {});
    await engine.handleCall('s', 'list_issues', {});
    const fresh = new ChaosEngine({ cfg, db, pool, profile: await loadProfile('off', cfg.rootDir), device: async () => null });
    await fresh.handleCall('s', 'get_issue', {});
    const f = db.raw.prepare('SELECT outcome, recovery_steps FROM faults').get() as Record<string, unknown>;
    expect(f).toEqual({ outcome: 'recovered', recovery_steps: 2 });
  });
});

describe('inlineResources', () => {
  it('turns embedded text resources into text blocks and describes binary ones', async () => {
    const { inlineResources } = await import('../src/engine.ts');
    const out = inlineResources({
      content: [
        { type: 'text', text: 'successfully downloaded text file' },
        { type: 'resource', resource: { uri: 'repo://o/r/contents/README.md', mimeType: 'text/plain', text: '# hello' } },
        { type: 'resource', resource: { uri: 'repo://o/r/contents/logo.png', mimeType: 'image/png', blob: 'AAAA' } },
      ],
    });
    expect(out.content).toEqual([
      { type: 'text', text: 'successfully downloaded text file' },
      { type: 'text', text: 'repo://o/r/contents/README.md\n# hello' },
      { type: 'text', text: 'repo://o/r/contents/logo.png: binary file (image/png, about 3 bytes), not shown' },
    ]);
  });
});
