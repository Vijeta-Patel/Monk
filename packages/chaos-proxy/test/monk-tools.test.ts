import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from '@monk/shared';
import { monkToolsServer } from '../src/monk-tools.ts';

async function connect(fetchImpl: typeof fetch, sleep = async () => {}) {
  const cfg = loadConfig({ env: { GITHUB_TOKEN: 'ghp_testtesttesttesttesttest0000' }, rootDir: '/tmp' });
  const server = monkToolsServer({ cfg, device: async () => null, fetchImpl, sleep });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(b);
  return client;
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('Monk tools', () => {
  it('lists wait_seconds and the gated GitHub actions, with destructive annotations', async () => {
    const c = await connect((async () => new Response('{}')) as unknown as typeof fetch);
    const { tools } = await c.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(by)).toEqual(expect.arrayContaining(['install_apk', 'wait_seconds', 'delete_branch', 'close_issue']));
    expect(by.delete_branch?.annotations?.destructiveHint).toBe(true);
    expect(by.close_issue?.annotations?.destructiveHint).toBe(true);
  });

  it('wait_seconds sleeps the asked time, capped at 60s', async () => {
    const slept: number[] = [];
    const c = await connect((async () => new Response('{}')) as unknown as typeof fetch, async (ms: number) => void slept.push(ms));
    expect(text((await c.callTool({ name: 'wait_seconds', arguments: { seconds: 12 } })) as CallToolResult)).toBe('waited 12s');
    await c.callTool({ name: 'wait_seconds', arguments: { seconds: 999 } });
    expect(slept).toEqual([12_000, 60_000]);
  });

  it('delete_branch refuses the default branch and deletes others', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`);
      if (url.endsWith('/repos/o/r')) return new Response(JSON.stringify({ default_branch: 'main' }));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = await connect(fetchImpl);
    const refused = (await c.callTool({ name: 'delete_branch', arguments: { owner: 'o', repo: 'r', branch: 'main' } })) as CallToolResult;
    expect(refused.isError).toBe(true);
    const ok = (await c.callTool({ name: 'delete_branch', arguments: { owner: 'o', repo: 'r', branch: 'fixture/merged-1' } })) as CallToolResult;
    expect(text(ok)).toBe('deleted branch fixture/merged-1');
    expect(calls).toContain('DELETE /repos/o/r/git/refs/heads/fixture/merged-1');
  });

  it('close_issue comments, then closes with the reason', async () => {
    const calls: { m: string; u: string; b: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ m: init?.method ?? 'GET', u: url.replace('https://api.github.com', ''), b: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = await connect(fetchImpl);
    const r = (await c.callTool({ name: 'close_issue', arguments: { owner: 'o', repo: 'r', issue_number: 7, reason: 'duplicate', comment: 'Duplicate of #3' } })) as CallToolResult;
    expect(text(r)).toBe('closed #7 (duplicate)');
    expect(calls.map((x) => `${x.m} ${x.u}`)).toEqual(['POST /repos/o/r/issues/7/comments', 'PATCH /repos/o/r/issues/7']);
    expect(calls[1]?.b).toEqual({ state: 'closed', state_reason: 'duplicate' });
  });
});
