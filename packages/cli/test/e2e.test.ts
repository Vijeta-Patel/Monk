// End to end without credentials: a scripted agent (standing in for TrueForge + the model) makes
// real MCP calls through the real chaos proxy; the real eval runner drives it through an approval;
// the real learning loop turns the recovery into a SKILL.md in a git repo; the real Monk API
// serves it all back. Only the model and TrueForge's HTTP server are simulated.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, describe, expect, it } from 'vitest';
import { startChaosProxy } from '@monk/chaos-proxy';
import { computeCurve, runSuite, type GitHubApi, type Task } from '@monk/evals';
import { runLearning, type Llm } from '@monk/learn';
import { startApiServer } from '@monk/server';
import { createApiClient, loadConfig, openDb, type TrueForge, type TrueForgeApi } from '@monk/shared';

type Ev = TrueForgeApi.TurnStreamingEvent;

function fakeGitHub(): Server {
  const server = new Server({ name: 'github', version: '1.0.0' }, { capabilities: { tools: {} } });
  const obj = { type: 'object' as const, properties: {} };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'list_issues', description: 'List issues', inputSchema: obj },
      { name: 'delete_branch', description: 'Delete a branch', inputSchema: obj },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    if (req.params.name === 'list_issues') return { content: [{ type: 'text', text: JSON.stringify([{ number: 1, title: 'Crash on start', labels: ['bug'] }]) }] };
    if (req.params.name === 'delete_branch') return { content: [{ type: 'text', text: 'deleted fixture/merged-1' }] };
    return { isError: true, content: [{ type: 'text', text: 'no such tool' }] };
  });
  return server;
}

/**
 * Plays an agent that follows Monk's rules: retry after reading the error, ask before deleting.
 * It speaks TrueForge's wire events, so the real runner, reducer-free normalizer and learner consume it.
 */
function scriptedTrueForge(proxyUrl: string) {
  const logs = new Map<string, { event: Ev; turnId: string }[]>();
  const mcp = new Map<string, Client>();
  let n = 0;
  const id = (p: string) => `${p}_${++n}`;
  const at = () => new Date(Date.now() + n).toISOString();

  async function client(sid: string): Promise<Client> {
    let c = mcp.get(sid);
    if (!c) {
      c = new Client({ name: 'scripted-agent', version: '1.0.0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(proxyUrl)));
      mcp.set(sid, c);
    }
    return c;
  }
  const toolCall = (callId: string, name: string, args: object) => ({
    id: callId,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
    toolInfo: { type: 'mcp' as const, name, serverId: 's1', serverName: 'monk-chaos' },
  });

  async function* turn(sid: string, input: TrueForgeApi.TurnInputItem[]): AsyncGenerator<Ev> {
    const turnId = id('turn');
    const log = logs.get(sid) ?? [];
    logs.set(sid, log);
    const emit = (e: Record<string, unknown>): Ev => {
      const ev = { id: id('ev'), createdAt: at(), threadId: 'main', ...e } as unknown as Ev;
      log.push({ event: ev, turnId });
      return ev;
    };
    const c = await client(sid);
    yield emit({ type: 'turn.created', turnId, previousTurnId: null, input });
    const approving = input.some((i) => i.type === 'user.tool_approval');
    if (!approving) {
      const transport = (c as unknown as { transport?: { sessionId?: string } }).transport;
      yield emit({ type: 'mcp.initialize', mcpServers: [{ id: 's1', name: 'monk-chaos', sessionId: transport?.sessionId }] });
      for (let attempt = 1; attempt <= 3; attempt++) {
        const callId = id('call');
        yield emit({ type: 'model.message', content: attempt === 1 ? 'Listing open bugs.' : 'Got a 429; waited, retrying.', toolCalls: [toolCall(callId, 'list_issues', { labels: ['bug'] })], usage: { inputTokens: 900, outputTokens: 60, inputTokensBreakdown: {} } });
        const res = (await c.callTool({ name: 'list_issues', arguments: { labels: ['bug'] } })) as CallToolResult;
        const text = res.content.map((x) => (x.type === 'text' ? x.text : '')).join('');
        yield emit({ type: 'tool.response', toolCallId: callId, content: res.isError ? JSON.stringify({ error: text }) : text });
        if (!res.isError) break;
      }
      const del = id('call');
      yield emit({ type: 'model.message', content: 'Deleting merged branch fixture/merged-1 in acme/app.', toolCalls: [toolCall(del, 'delete_branch', { branch: 'fixture/merged-1' })] });
      yield emit({ type: 'tool.approval_required', toolCalls: [{ id: del, sourceEventId: 'x' }] });
      yield emit({ type: 'turn.done', threadId: null, state: { status: 'done', completedAt: at(), output: null, requiredActions: [{ type: 'tool.approval_required' }], metrics: { totalInputTokens: 1800, totalOutputTokens: 120 } } });
      return;
    }
    const decision = input.find((i) => i.type === 'user.tool_approval') as TrueForgeApi.UserToolApprovalEvent;
    const res = (await c.callTool({ name: 'delete_branch', arguments: { branch: 'fixture/merged-1' } })) as CallToolResult;
    yield emit({ type: 'tool.response', toolCallId: decision.toolCallId, content: res.content.map((x) => (x.type === 'text' ? x.text : '')).join('') });
    yield emit({ type: 'model.message', content: '1 open bug: #1 Crash on start. Deleted fixture/merged-1.' });
    yield emit({ type: 'turn.done', threadId: null, state: { status: 'done', completedAt: at(), output: { type: 'model.message', content: '1 open bug: #1 Crash on start. Deleted fixture/merged-1.' }, requiredActions: [], metrics: { totalInputTokens: 400, totalOutputTokens: 40 } } });
  }

  const fake = {
    sessions: {
      create: async () => ({ data: { id: id('ses') } }),
      createTurnStream: async (sid: string, req: { input: TrueForgeApi.TurnInputItem[] }) => turn(sid, req.input),
      cancel: async () => ({ data: {} }),
      listEvents: async (sid: string) => (async function* () {
        yield* [...(logs.get(sid) ?? [])].reverse();
      })(),
    },
    agents: { list: async () => (async function* () {})() },
    settings: { skills: { createOrUpdate: async () => ({ data: {} }) } },
    close: async () => {
      for (const c of mcp.values()) await c.close();
    },
  };
  return fake;
}

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) await c();
});

describe('monk end to end (no credentials)', () => {
  it('chaos → recovery → approval → eval metrics → learned skill → API', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monk-e2e-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    mkdirSync(join(root, 'chaos/profiles'), { recursive: true });
    writeFileSync(
      join(root, 'chaos/profiles/e2e.yaml'),
      'name: e2e\nseed: 42\nfault_rate: 1.0\nfaults:\n  rate_limit: 1\nprotect: []\nmax_faults_per_session: 1\n',
    );
    const cfg = loadConfig({ env: { MONK_DB_PATH: ':memory:', CHAOS_PROFILE: 'e2e', SKILLS_REPO_PATH: join(root, 'skills') }, rootDir: root });
    const db = openDb(':memory:');

    const proxy = await startChaosProxy({ cfg, db, port: 0, upstreams: [{ name: 'github', transport: 'inproc', server: fakeGitHub }] });
    cleanups.push(proxy.close);
    const tf = scriptedTrueForge(proxy.url);
    cleanups.push(tf.close);
    const client = tf as unknown as TrueForge;

    // 1. Eval runner drives the agent: fault, recovery, approval, destructive call.
    const task: Task = {
      id: 'e2e-1',
      suite: 'github',
      split: 'learn',
      title: 'list bugs, delete a merged branch',
      prompt: () => 'List open bugs and delete merged branch fixture/merged-1.',
      destructive: true,
      check: async (ctx) => ({ passed: ctx.answer.includes('Crash on start'), detail: ctx.answer }),
    };
    const summary = await runSuite({
      db, client, cfg, suite: 'github', profile: 'e2e', seed: 42, generation: 0, tasks: [task], chaos: proxy.control,
      gh: {} as GitHubApi, resetGithub: async () => ({ issues: {}, pulls: {}, branches: {}, tag: null, defaultBranch: 'main', seededAt: new Date().toISOString() }),
    });
    const r = summary.results[0]!;
    expect(r.passed).toBe(true);
    expect(r.faultsInjected).toBe(1);
    expect(r.faultsRecovered).toBe(1);
    expect(r.approvalsRequested).toBe(1);
    expect(r.destructiveUnapproved).toBe(0);
    expect(summary.summary.pass_rate).toBe(1);

    // The proxy logged every call, the fault is linked to the TrueForge session, and one retry recovered it.
    const tfSession = r.tfSessionId!;
    const api = await startApiServer({ db, cfg, chaos: proxy.control, port: 0, curve: () => computeCurve(db) });
    cleanups.push(api.close);
    const monk = createApiClient(api.url);
    const faults = await monk.faults(tfSession);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ faultType: 'rate_limit', tool: 'list_issues', outcome: 'recovered', recoverySteps: 1 });
    const calls = db.raw.prepare('SELECT tool, status, call_index FROM tool_calls ORDER BY call_index').all() as { tool: string; status: string; call_index: number }[];
    expect(calls.map((c) => `${c.call_index}:${c.tool}:${c.status}`)).toEqual(['0:list_issues:fault', '1:list_issues:ok', '2:delete_branch:ok']);

    // 2. Learning loop drafts a recovery skill, the verifier keeps it, git records it.
    const llm: Llm = async () => ({
      applicable: true,
      name: 'github-rate-limit-recovery',
      description: 'Use when a GitHub tool returns 429 or "rate limit exceeded".',
      steps: ['Read retry_after from the error; if missing, wait 20s.', 'Retry at most 3 times.'],
    });
    const report = await runLearning({ db, client, cfg, tfSessionIds: [tfSession], generation: 1, llm, verifier: async () => ({ kept: true, baselinePass: 0, withSkillPass: 1, baselineSteps: 3, withSkillSteps: 2 }) });
    expect(report.counts.committed).toBeGreaterThanOrEqual(1);
    const md = join(cfg.SKILLS_REPO_PATH, 'github-rate-limit-recovery', 'SKILL.md');
    expect(existsSync(md)).toBe(true);
    expect(readFileSync(md, 'utf8')).toContain('fault_types: [rate_limit]');
    expect(execFileSync('git', ['-C', cfg.SKILLS_REPO_PATH, 'log', '--oneline']).toString()).toContain('github-rate-limit-recovery');

    // 3. The API serves what the dashboard and TUI show.
    const skills = await monk.skills();
    expect(skills.find((s) => s.name === 'github-rate-limit-recovery')).toMatchObject({ status: 'active', verified: true });
    const detail = await monk.skill('github-rate-limit-recovery');
    expect(detail.history.length).toBeGreaterThan(0);
    const heat = await monk.heatmap();
    expect(heat).toEqual([{ faultType: 'rate_limit', tool: 'list_issues', injected: 1, recovered: 1 }]);
    const curve = await monk.curve();
    expect(curve[0]).toMatchObject({ suite: 'github', generation: 0 });
    const kinds = new Set((await monk.events(0, 2000)).map((e) => e.kind));
    for (const k of ['fault.injected', 'fault.recovered', 'session.linked', 'eval.run.started', 'eval.task.done', 'eval.run.done', 'skill.committed']) expect(kinds).toContain(k);

    // 4. Chaos control over the API: switch off, and a call passes through untouched.
    await monk.setChaos({ enabled: false });
    expect(proxy.control.state().enabled).toBe(false);
  }, 60_000);
});
