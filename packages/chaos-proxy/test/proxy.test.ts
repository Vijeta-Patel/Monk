import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readEvents, type MonkDb } from '@monk/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startChaosProxy, type UpstreamSpec } from '../src/index.ts';
import { fakeServer, fakeUpstreams, GITHUB_TOOLS, memDb, testCfg } from './helpers.ts';

type Proxy = Awaited<ReturnType<typeof startChaosProxy>>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
});

async function start(env: Record<string, string> = {}, db: MonkDb = memDb(), upstreams: UpstreamSpec[] = fakeUpstreams(), root?: string) {
  const cfg = testCfg(env, root);
  const proxy = await startChaosProxy({ cfg, db, upstreams, port: 0 });
  cleanups.push(() => proxy.close());
  return { proxy, db, cfg };
}

async function connect(proxy: Proxy, sessionId?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(proxy.url), sessionId ? { sessionId } : undefined);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return { client, transport };
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;
const base = (p: Proxy) => p.url.replace(/\/mcp$/, '');

describe('chaos proxy over streamable HTTP', () => {
  it('passes through tools/list with destructiveHint, and issues a session id', async () => {
    const { proxy, db } = await start();
    const { client, transport } = await connect(proxy);
    expect(transport.sessionId).toMatch(/[0-9a-f-]{36}/);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['always_fails', 'delete_branch', 'get_issue', 'list_issues', 'mobile_click_on_screen_at_coordinates', 'mobile_list_elements_on_screen', 'mobile_uninstall_app'].sort(),
    );
    const del = tools.find((t) => t.name === 'delete_branch');
    expect(del?.annotations?.destructiveHint).toBe(true);
    const list = tools.find((t) => t.name === 'list_issues');
    expect(list?.inputSchema).toEqual(GITHUB_TOOLS[0]!.inputSchema);
    expect(list?.annotations).toEqual({ readOnlyHint: true });
    const row = db.raw.prepare('SELECT * FROM mcp_sessions').get() as { mcp_session_id: string };
    expect(row.mcp_session_id).toBe(transport.sessionId);
  });

  it('injects faults per profile and logs every call', async () => {
    const { proxy, db } = await start();
    await proxy.control.set({ faultRate: 1 });
    const { client, transport } = await connect(proxy);
    const r = await call(client, 'list_issues', { owner: 'o', repo: 'r', token: 'ghp_secretsecretsecretsecret1234' });
    expect(r.content?.length).toBeGreaterThan(0);
    const d = await call(client, 'delete_branch');
    expect(d.isError).toBeFalsy();
    const rows = db.raw.prepare('SELECT * FROM tool_calls ORDER BY rowid').all() as Record<string, unknown>[];
    expect(rows.map((x) => x.status)).toEqual(['fault', 'ok']);
    expect(rows[0]?.mcp_session_id).toBe(transport.sessionId);
    expect(JSON.stringify(rows)).not.toContain('ghp_');
    const kinds = (await readEvents(db)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['chaos.config', 'fault.injected', 'tool.call']));
  });

  it('is a pass-through when CHAOS_ENABLED=false', async () => {
    const { proxy, db } = await start({ CHAOS_ENABLED: 'false', CHAOS_PROFILE: 'heavy' });
    await proxy.control.set({ faultRate: 1 });
    const { client } = await connect(proxy);
    for (let i = 0; i < 5; i++) expect(JSON.parse(((await call(client, 'list_issues')).content![0] as { text: string }).text)).toHaveProperty('items');
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE status = 'ok'").get()).toEqual({ n: 5 });
  });

  it('keeps one MCP session across two client connections with the same session id', async () => {
    const { proxy, db } = await start({ CHAOS_PROFILE: 'off' });
    const a = await connect(proxy);
    const sid = a.transport.sessionId!;
    await proxy.control.inject({ fault: 'rate_limit', tool: 'get_issue' });
    expect((await call(a.client, 'get_issue')).isError).toBe(true);

    const b = await connect(proxy, sid);
    expect(b.transport.sessionId).toBe(sid);
    expect((await call(b.client, 'get_issue')).isError).toBeFalsy();
    const f = db.raw.prepare('SELECT mcp_session_id, outcome, recovery_steps FROM faults').get();
    expect(f).toEqual({ mcp_session_id: sid, outcome: 'recovered', recovery_steps: 1 });
    expect((db.raw.prepare('SELECT DISTINCT mcp_session_id AS s FROM tool_calls').all() as { s: string }[]).map((r) => r.s)).toEqual([sid]);
  });

  it('adopts a known session id after a proxy restart and continues its call index', async () => {
    const db = memDb();
    const first = await start({}, db);
    const a = await connect(first.proxy);
    const sid = a.transport.sessionId!;
    for (let i = 0; i < 6; i++) await call(a.client, 'get_issue');
    const beforeRestart = db.raw.prepare('SELECT COUNT(*) AS n FROM tool_calls').get();
    await first.proxy.close();

    const second = await start({}, db, fakeUpstreams(), first.cfg.rootDir);
    const b = await connect(second.proxy, sid);
    await call(b.client, 'get_issue');
    expect(beforeRestart).toEqual({ n: 6 });
    expect(db.raw.prepare('SELECT COUNT(DISTINCT mcp_session_id) AS n FROM tool_calls').get()).toEqual({ n: 1 });

    // a fresh session with the same seed sees the same first 7 decisions
    const c = await connect(second.proxy);
    for (let i = 0; i < 7; i++) await call(c.client, 'get_issue');
    const seq = (s: string) =>
      (db.raw.prepare('SELECT status FROM tool_calls WHERE mcp_session_id = ? ORDER BY rowid').all(s) as { status: string }[]).map((r) => r.status === 'fault');
    expect(seq(c.transport.sessionId!)).toEqual(seq(sid));
  });

  it('serves the HTTP control endpoints', async () => {
    const { proxy } = await start();
    const url = base(proxy);
    const health = (await (await fetch(`${url}/healthz`)).json()) as { ok: boolean; upstreams: { name: string; connected: boolean }[] };
    expect(health.ok).toBe(true);
    expect(health.upstreams.map((u) => u.name)).toEqual(['github', 'mobile']);

    const st = (await (await fetch(`${url}/chaos`)).json()) as { profile: string; profiles: string[] };
    expect(st.profile).toBe('test');
    expect(st.profiles).toEqual(expect.arrayContaining(['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile', 'test']));

    const post = await fetch(`${url}/chaos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'heavy', seed: 99 }) });
    expect(await post.json()).toMatchObject({ profile: 'heavy', faultRate: 0.5, seed: 99, enabled: true });
    const bad = await fetch(`${url}/chaos`, { method: 'POST', body: JSON.stringify({ profile: 'nope' }) });
    expect(bad.status).toBe(400);

    const inj = await fetch(`${url}/chaos/inject`, { method: 'POST', body: JSON.stringify({ fault: 'timeout', tool: 'list_issues' }) });
    expect(((await inj.json()) as { pending: unknown[] }).pending).toEqual([{ fault: 'timeout', tool: 'list_issues', mcpSessionId: null }]);
    const prot = await fetch(`${url}/chaos/inject`, { method: 'POST', body: JSON.stringify({ fault: 'timeout', tool: 'delete_branch' }) });
    expect(prot.status).toBe(400);
    expect(((await prot.json()) as { error: string }).error).toMatch(/protected/);

    const tools = (await (await fetch(`${url}/chaos/tools`)).json()) as { name: string; destructive: boolean }[];
    expect(tools.find((t) => t.name === 'delete_branch')?.destructive).toBe(true);
    expect((await fetch(`${url}/chaos/screen`)).status).toBe(404);
    expect(await proxy.control.screenshot()).toBeNull();
  });

  it('survives an upstream that fails to start and keeps serving the others', async () => {
    const broken: UpstreamSpec = { name: 'broken', transport: 'stdio', command: '/nonexistent/binary-for-monk-test' };
    const { proxy } = await start({}, memDb(), [broken, { name: 'github', transport: 'inproc', server: () => fakeServer(GITHUB_TOOLS) }]);
    await proxy.control.set({ profile: 'off' });
    const { client } = await connect(proxy);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_issues');
    expect((await call(client, 'list_issues')).isError).toBeFalsy();
    const health = (await (await fetch(`${base(proxy)}/healthz`)).json()) as { upstreams: { name: string; connected: boolean; error: string | null }[] };
    expect(health.upstreams.find((u) => u.name === 'broken')).toMatchObject({ connected: false });
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(/Unknown tool/);
  });

  it('first upstream wins on tool name collisions', async () => {
    const { proxy } = await start({ CHAOS_PROFILE: 'off' }, memDb(), [
      { name: 'one', transport: 'inproc', server: () => fakeServer(GITHUB_TOOLS) },
      { name: 'two', transport: 'inproc', server: () => fakeServer(GITHUB_TOOLS) },
    ]);
    const tools = await proxy.control.listTools();
    expect(tools.filter((t) => t.name === 'list_issues')).toEqual([expect.objectContaining({ upstream: 'one' })]);
  });
});
