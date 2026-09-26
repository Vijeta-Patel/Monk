import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient, loadConfig, openDb, publish, schema, setPrice, type ChaosState, type StoredEvent } from '@monk/shared';
import { startApiServer, type ChaosApi } from '../src/index.ts';

function fakeChaos(): ChaosApi & { calls: unknown[] } {
  let state: ChaosState = { enabled: true, profile: 'moderate', faultRate: 0.3, seed: 42, profiles: ['off', 'moderate'], pending: [] };
  const calls: unknown[] = [];
  return {
    calls,
    state: () => state,
    set: async (p) => (calls.push(p), (state = { ...state, ...p })),
    inject: async (r) => (calls.push(r), (state = { ...state, pending: [...state.pending, { fault: r.fault, tool: r.tool ?? null, mcpSessionId: null }] })),
    screenshot: async () => null,
  };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function setup() {
  const db = openDb(':memory:');
  const cfg = loadConfig({ env: { MONK_DB_PATH: ':memory:', MODEL: 'test-model' }, rootDir: '/tmp/monk-test' });
  setPrice('test-model', { input: 1, output: 2 });
  const chaos = fakeChaos();
  const srv = await startApiServer({ db, cfg, chaos, port: 0 });
  closers.push(srv.close);
  return { db, chaos, api: createApiClient(srv.url), url: srv.url };
}

describe('api server', () => {
  it('serves state, faults joined to TF sessions, heatmap, skills', async () => {
    const { db, api } = await setup();
    await db.insert(schema.mcpSessions).values({ mcpSessionId: 'm1', tfSessionId: 't1' });
    await db.insert(schema.faults).values([
      { id: 'f1', mcpSessionId: 'm1', upstream: 'github', tool: 'list_issues', faultType: 'rate_limit', profile: 'moderate', seed: 42, injectedAt: '2026-09-23T10:00:00Z', outcome: 'recovered', recoverySteps: 2 },
      { id: 'f2', mcpSessionId: 'm2', upstream: 'github', tool: 'list_issues', faultType: 'rate_limit', profile: 'moderate', seed: 42, injectedAt: '2026-09-23T10:01:00Z' },
    ]);
    await db.insert(schema.skills).values({ name: 'gh-429', type: 'recovery', description: 'Use when 429', body: '1. wait', status: 'active' });
    await db.insert(schema.skillUses).values([
      { skillName: 'gh-429', tfSessionId: 't1', succeeded: true },
      { skillName: 'gh-429', tfSessionId: 't2', succeeded: false },
    ]);

    const state = await api.state();
    expect(state.chaos.profile).toBe('moderate');
    expect(state.skills.active).toBe(1);

    expect((await api.faults('t1')).map((f) => f.id)).toEqual(['f1']);
    expect((await api.faults()).length).toBe(2);
    expect(await api.heatmap()).toEqual([{ faultType: 'rate_limit', tool: 'list_issues', injected: 2, recovered: 1 }]);

    const skills = await api.skills();
    expect(skills[0]).toMatchObject({ name: 'gh-429', uses: 2, wins: 1, winRate: 0.5 });
    expect((await api.skill('gh-429')).markdown).toBe('1. wait');
  });

  it('validates and forwards chaos control', async () => {
    const { api, chaos, url } = await setup();
    expect((await api.setChaos({ profile: 'off' })).profile).toBe('off');
    expect((await api.inject({ fault: 'timeout', tool: 'list_issues' })).pending).toHaveLength(1);
    expect((await fetch(`${url}/api/chaos/inject`, { method: 'POST', body: JSON.stringify({ fault: 'nope' }) })).status).toBe(400);
    expect((await fetch(`${url}/api/chaos`, { method: 'POST', body: JSON.stringify({ faultRate: 2 }) })).status).toBe(400);
    expect(chaos.calls).toHaveLength(2);
    expect((await fetch(`${url}/api/phone/screen`)).status).toBe(404);
    expect((await fetch(`${url}/api/bench/run`, { method: 'POST', body: '{}' })).status).toBe(501);
  });

  it('links sessions, records cost, and streams events over SSE', async () => {
    const { db, api } = await setup();
    const got: StoredEvent[] = [];
    const stop = api.subscribe((e) => got.push(e));
    await api.linkSession({ tfSessionId: 't9', mcpSessionId: 'm9' });
    await api.reportCost({ tfSessionId: 't9', inputTokens: 1000, outputTokens: 100 });
    await publish(db, { kind: 'chaos.config', data: { enabled: false, profile: 'off', faultRate: 0 } });
    for (let i = 0; i < 40 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(got.map((e) => e.kind)).toEqual(['session.linked', 'session.cost', 'chaos.config']);
    expect((await api.state()).costTodayUsd).toBeGreaterThan(0);
    expect((await api.events(1)).length).toBe(2);
  });
});
