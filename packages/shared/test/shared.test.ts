import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTableColumns, getTableName } from 'drizzle-orm';
import {
  destructiveToolNames, lastEventId, loadConfig, modelSlug, normalizeTurnStream, openDb, publish, readEvents, redact, schema,
  isErrorResult, costUsd, setPrice, rankForAgent, blendedCost, listProxyModels, tfModelName, type TurnEvent, type TrueForgeApi,
} from '../src/index.ts';

describe('db', () => {
  it('has a DDL column for every drizzle column', () => {
    const db = openDb(':memory:');
    for (const table of Object.values(schema)) {
      if (typeof table !== 'object' || !table || !('getSQL' in table)) continue;
      const name = getTableName(table as never);
      const cols = (db.raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
      for (const col of Object.values(getTableColumns(table as never)) as { name: string }[]) {
        expect(cols, `${name}.${col.name}`).toContain(col.name);
      }
    }
  });

  it('round-trips json and boolean columns', async () => {
    const db = openDb(':memory:');
    await db.insert(schema.skills).values({ name: 's1', type: 'recovery', description: 'd', body: 'b', faultTypes: ['rate_limit'], verified: true });
    const [row] = await db.select().from(schema.skills).where(eq(schema.skills.name, 's1'));
    expect(row?.faultTypes).toEqual(['rate_limit']);
    expect(row?.verified).toBe(true);
    expect(row?.status).toBe('draft');
  });
});

describe('events', () => {
  it('publishes, validates and reads in order', async () => {
    const db = openDb(':memory:');
    await publish(db, { kind: 'chaos.config', data: { enabled: true, profile: 'moderate', faultRate: 0.3 } });
    await publish(db, {
      kind: 'fault.injected',
      data: { mcpSessionId: 'm1', tfSessionId: 't1', faultId: 'f1', tool: 'list_issues', faultType: 'rate_limit', profile: 'moderate', manual: false },
    });
    const all = await readEvents(db);
    expect(all.map((e) => e.kind)).toEqual(['chaos.config', 'fault.injected']);
    expect(all[1]?.sessionId).toBe('t1');
    expect(await lastEventId(db)).toBe(2);
    expect((await readEvents(db, 1)).length).toBe(1);
    await expect(publish(db, { kind: 'fault.injected', data: {} } as never)).rejects.toThrow();
  });
});

function ev<T extends TrueForgeApi.TurnStreamingEvent['type']>(e: { type: T } & Record<string, unknown>) {
  return { createdAt: '2026-09-23T00:00:00Z', threadId: 'main', ...e } as unknown as TrueForgeApi.TurnStreamingEvent;
}

async function collect(events: TrueForgeApi.TurnStreamingEvent[]): Promise<TurnEvent[]> {
  async function* gen() { yield* events; }
  const out: TurnEvent[] = [];
  for await (const e of normalizeTurnStream(gen())) out.push(e);
  return out;
}

describe('normalizeTurnStream', () => {
  it('streams text, seals tool calls, maps results, approvals and done', async () => {
    const out = await collect([
      ev({ type: 'turn.created', id: 'e0', turnId: 'turn1', input: [] }),
      ev({ type: 'mcp.initialize', id: 'e1', mcpServers: [{ id: 'x', name: 'monk-chaos', sessionId: 'mcp-1' }] }),
      ev({ type: 'model.message', id: 'm1', content: '' }),
      ev({ type: 'model.message.delta', id: 'm1', content: 'On ' }),
      ev({ type: 'model.message.delta', id: 'm1', content: 'it.' }),
      ev({ type: 'model.message.delta', id: 'm1', toolCalls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'list_issues', arguments: '{"repo":"a/b"}' }, toolInfo: { type: 'mcp', name: 'list_issues', serverId: 's', serverName: 'monk-chaos' } }] }),
      ev({ type: 'tool.response', id: 'e2', toolCallId: 'c1', content: '{"error":"429 rate limit"}' }),
      ev({ type: 'model.message', id: 'm2', content: 'Merging.', toolCalls: [{ id: 'c2', type: 'function', function: { name: 'merge_pull_request', arguments: '{}' }, toolInfo: { type: 'mcp', name: 'merge_pull_request', serverId: 's', serverName: 'monk-chaos' } }] }),
      ev({ type: 'tool.approval_required', id: 'e3', toolCalls: [{ id: 'c2', sourceEventId: 'm2' }] }),
      ev({ type: 'turn.done', id: 'e4', threadId: null, state: { status: 'done', completedAt: 'x', output: null, requiredActions: [{}], metrics: { totalInputTokens: 100, totalOutputTokens: 20 } } }),
    ]);
    const types = out.map((e) => e.type);
    expect(types).toEqual(['turn.started', 'mcp.initialize', 'text', 'text', 'message', 'tool.call', 'tool.result', 'message', 'tool.call', 'approval.required', 'turn.done']);
    const call = out.find((e) => e.type === 'tool.call');
    expect(call).toMatchObject({ name: 'list_issues', server: 'monk-chaos', args: '{"repo":"a/b"}' });
    expect(out.find((e) => e.type === 'tool.result')).toMatchObject({ isError: true, name: 'list_issues' });
    expect(out.find((e) => e.type === 'approval.required')).toMatchObject({ calls: [{ name: 'merge_pull_request', callId: 'c2' }] });
    expect(out.at(-1)).toMatchObject({ type: 'turn.done', status: 'paused', inputTokens: 100, outputTokens: 20 });
  });
});

describe('helpers', () => {
  it('redacts secrets from env and known token shapes', () => {
    const env = { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123' };
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz0123 ok', env)).toBe('token [GITHUB_TOKEN] ok');
    expect(redact('key sk-or-v1-0123456789abcdef0123456789abcdef', {})).toBe('key [redacted]');
  });
  it('expands destructive globs to exact names', () => {
    expect(destructiveToolNames(['list_issues', 'merge_pull_request', 'delete_branch', 'mobile_uninstall_app', 'get_file_contents', 'list_releases', 'get_latest_release']))
      .toEqual(['merge_pull_request', 'delete_branch', 'mobile_uninstall_app']);
  });
  it('slugs model ids to TrueForge names', () => {
    expect(modelSlug('deepseek/deepseek-v3.2')).toBe('deepseek-deepseek-v3-2');
  });
  it('detects error results and prices tokens', () => {
    expect(isErrorResult('{"error":"x"}')).toBe(true);
    expect(isErrorResult('{"items":[]}')).toBe(false);
    setPrice('gpt-4o-mini', { input: 0.15, output: 0.6 });
    expect(costUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75);
    expect(costUsd('unpriced-model', 1_000_000, 0)).toBe(0);
  });
  it('treats blank env values as unset', () => {
    const cfg = loadConfig({ env: { MODEL: '', CHAOS_ENABLED: 'false', ALLOWED_USERS: 'a, b' }, rootDir: '/tmp' });
    expect(cfg.MODEL).toBe('');
    expect(cfg.LLM_BASE_URL).toBe('');
    expect(cfg.CHAOS_ENABLED).toBe(false);
    expect(cfg.allowedUsers).toEqual(['a', 'b']);
  });
});

describe('llm proxy models', () => {
  it('reads LiteLLM /model/info and ranks cheapest tool-calling models first', async () => {
    const cfg = loadConfig({ env: { LLM_BASE_URL: 'https://llm.test/v1', LLM_API_KEY: 'k' }, rootDir: '/tmp' });
    const fetchImpl = (async (url: string) => {
      expect(url).toBe('https://llm.test/model/info');
      return new Response(JSON.stringify({ data: [
        { model_name: 'big', model_info: { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6, supports_function_calling: true } },
        { model_name: 'cheap-no-tools', model_info: { input_cost_per_token: 1e-8, output_cost_per_token: 1e-8, supports_function_calling: false } },
        { model_name: 'small', model_info: { input_cost_per_token: 1.5e-7, output_cost_per_token: 6e-7, supports_function_calling: true, supports_vision: true } },
        { model_name: 'text-embedding-3-small', model_info: { input_cost_per_token: 2e-8 } },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const models = await listProxyModels(cfg, fetchImpl);
    expect(rankForAgent(models).map((m) => m.id)).toEqual(['small', 'big']);
    expect(blendedCost(models.find((m) => m.id === 'small')!)).toBeCloseTo((10 * 0.15 + 0.6) / 11);
    expect(tfModelName('openai/gpt-4o-mini')).toBe('litellm/openai-gpt-4o-mini');
  });
});

describe('unwrapToolCall', () => {
  it('turns TrueForge call_tool into the real MCP tool', async () => {
    const { unwrapToolCall } = await import('../src/index.ts');
    expect(unwrapToolCall('call_tool', JSON.stringify({ mcp_server: 'monk-chaos', tool_name: 'delete_file', input: { path: 'README.md' } }), null)).toEqual({ name: 'delete_file', args: '{"path":"README.md"}', server: 'monk-chaos' });
    expect(unwrapToolCall('list_issues', '{}', 'monk-chaos')).toEqual({ name: 'list_issues', args: '{}', server: 'monk-chaos' });
    expect(unwrapToolCall('call_tool', 'not json', null).name).toBe('call_tool');
  });
});
