import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { loadConfig, openDb, schema, type MonkConfig, type MonkDb, type TrueForge, type TrueForgeApi } from '@monk/shared';
import type { Llm } from '../src/index.ts';

// Hermetic git: no user/global config, so SkillsRepo's fallback identity (-c user.name/email) is used.
const gitHome = mkdtempSync(join(tmpdir(), 'monk-learn-gitcfg-'));
writeFileSync(join(gitHome, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = join(gitHome, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';

export function tmp(prefix = 'monk-learn-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', ...args], { cwd, encoding: 'utf8' }).trim();
}

export function makeCfg(over: Record<string, string> = {}): MonkConfig {
  const root = tmp('monk-learn-root-');
  return loadConfig({
    rootDir: root,
    env: { SKILLS_REPO_PATH: join(root, 'skills'), MONK_DB_PATH: ':memory:', LLM_API_KEY: 'sk-testkeytestkeytestkeytestkey', ...over },
  });
}

let seq = 0;
const ts = () => new Date(Date.UTC(2026, 8, 23, 10, 0, seq++)).toISOString();

type Ev = TrueForgeApi.SessionEvent;

export function turnCreated(task: string): Ev {
  return { type: 'turn.created', id: `e${seq}`, createdAt: ts(), turnId: 't1', previousTurnId: null, threadId: 'main', state: { status: 'running' } as never, input: [{ type: 'user.message', content: task }] };
}

export function call(id: string, tool: string, args: Record<string, unknown>, server: string | null = 'monk-chaos', text = ''): Ev {
  return {
    type: 'model.message',
    id: `m_${id}`,
    createdAt: ts(),
    threadId: 'main',
    content: text || null,
    toolCalls: [
      {
        id,
        type: 'function',
        function: { name: tool, arguments: JSON.stringify(args) },
        toolInfo: server ? { type: 'mcp', name: tool, serverId: 'srv', serverName: server } : { type: 'truefoundry-system', name: tool },
      },
    ],
  };
}

export function resp(id: string, content: unknown): Ev {
  return { type: 'tool.response', id: `r_${id}`, createdAt: ts(), threadId: 'main', toolCallId: id, content: typeof content === 'string' ? content : JSON.stringify(content) };
}

export function done(output = 'Done.', status: 'done' | 'error' = 'done'): Ev {
  const state =
    status === 'done'
      ? { status: 'done', completedAt: ts(), output: { type: 'model.message', id: 'out', createdAt: ts(), threadId: 'main', content: output }, requiredActions: [] }
      : { status: 'error', completedAt: ts(), message: 'boom' };
  return { type: 'turn.done', id: `d${seq}`, createdAt: ts(), threadId: 'main', state: state as never };
}

/** Fake TrueForge: listEvents pages newest first; settings/agents are spies. */
export function fakeClient(sessions: Record<string, Ev[]>, agent?: { id: string; name: string; description: string; manifest: TrueForgeApi.AgentSpec }) {
  const createOrUpdate = vi.fn(async (_req: unknown) => ({ data: {} }));
  const update = vi.fn(async (_id: string, _req: unknown) => ({ data: {} }));
  const client = {
    sessions: {
      listEvents: vi.fn(async (sid: string) => {
        const items = [...(sessions[sid] ?? [])].reverse().map((event) => ({ event, turnId: 't1' }));
        const pages = [items.slice(0, 3), items.slice(3)];
        return {
          async *[Symbol.asyncIterator]() {
            for (const p of pages) for (const i of p) yield i;
          },
        };
      }),
    },
    settings: { skills: { createOrUpdate } },
    agents: {
      list: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          if (agent) yield agent;
        },
      })),
      update,
    },
  };
  return { client: client as unknown as TrueForge, createOrUpdate, update, raw: client };
}

/** Session s1: rate limit on list_issues recovered in 2 steps, a real 422 from search_issues, success. */
export function sessionS1(): Ev[] {
  return [
    turnCreated('Find stale bug issues in acme/app and comment on them'),
    call('c1', 'list_issues', { repo: 'acme/app', labels: 'bug', token: 'ghp_abcdefghijklmnopqrstuvwxyz123456' }),
    resp('c1', { error: 'HTTP 429: API rate limit exceeded, retry_after=20' }),
    call('c2', 'exec', { cmd: 'sleep 20' }, null),
    resp('c2', 'ok'),
    call('c3', 'list_issues', { repo: 'acme/app', labels: 'bug' }),
    resp('c3', '[{"number":1}]'),
    call('c4', 'search_issues', { q: 'is:open label:bug' }),
    resp('c4', { error: 'Validation Failed (422): query must include repo:' }),
    call('c5', 'add_issue_comment', { repo: 'acme/app', issue: 1, body: 'stale?' }),
    resp('c5', '{"id":9}'),
    done('Commented on 1 stale issue.'),
  ];
}

export function sessionS2(): Ev[] {
  return [
    turnCreated('Search for flaky test issues'),
    call('d1', 'search_issues', { q: 'flaky' }),
    resp('d1', { error: 'Validation Failed (422): query must include repo:' }),
    done('Could not search.'),
  ];
}

export async function seedS1Chaos(db: MonkDb): Promise<void> {
  await db.insert(schema.mcpSessions).values([{ mcpSessionId: 'mcp1', tfSessionId: 's1' }, { mcpSessionId: 'mcp2', tfSessionId: 's2' }]);
  await db.insert(schema.faults).values({
    id: 'f1', mcpSessionId: 'mcp1', upstream: 'github', tool: 'list_issues', faultType: 'rate_limit', profile: 'moderate', seed: 7,
    injectedAt: '2026-09-23T10:00:01.000Z', recoveredAt: '2026-09-23T10:00:05.000Z', recoverySteps: 2, outcome: 'recovered',
  });
  const row = (id: string, mcp: string, tool: string, at: string, status: 'ok' | 'error' | 'fault', faultId: string | null = null) => ({
    id, mcpSessionId: mcp, upstream: 'github', tool, argsHash: 'h', startedAt: at, durationMs: 5, status, faultId,
  });
  await db.insert(schema.toolCalls).values([
    row('p1', 'mcp1', 'list_issues', '2026-09-23T10:00:01.000Z', 'fault', 'f1'),
    row('p2', 'mcp1', 'list_issues', '2026-09-23T10:00:03.000Z', 'ok'),
    row('p3', 'mcp1', 'search_issues', '2026-09-23T10:00:04.000Z', 'error'),
    row('p4', 'mcp1', 'add_issue_comment', '2026-09-23T10:00:05.000Z', 'ok'),
    row('q1', 'mcp2', 'search_issues', '2026-09-23T11:00:00.000Z', 'error'),
  ]);
}

export const RECOVERY = {
  applicable: true,
  name: 'github-rate-limit-recovery',
  description: 'Use when a GitHub tool returns 429 or "rate limit exceeded".',
  steps: ['Read retry_after from the error; if missing, wait 20s.', 'Do not retry more than 3 times.', 'Batch remaining reads into one search call when possible.'],
};
export const PROCEDURE = {
  applicable: true,
  name: 'triage-stale-bug-issues',
  description: 'Use when asked to find and comment on stale bug issues in a repo.',
  steps: ['List open issues with the bug label.', 'Filter by last update older than 30 days.', 'Comment on each stale issue asking for status.'],
};
export const QUIRK = {
  applicable: true,
  name: 'search-issues-needs-repo',
  description: 'Use when calling search_issues on GitHub; the query must include repo:.',
  steps: ['Always add repo:owner/name to the search_issues query string.', 'If a 422 mentions repo:, rebuild the query instead of retrying.'],
};

export function fakeLlm(over: Partial<Record<'recovery' | 'procedure' | 'quirk' | 'merge', unknown>> = {}) {
  const fn = vi.fn<Llm>(async ({ user }) => {
    if (user.startsWith('Merge two versions')) {
      if ('merge' in over) {
        if (over.merge instanceof Error) throw over.merge;
        return over.merge;
      }
      throw new Error('no merge');
    }
    if (user.includes('RECOVERY')) return over.recovery ?? RECOVERY;
    if (user.includes('PROCEDURE')) return over.procedure ?? PROCEDURE;
    return over.quirk ?? QUIRK;
  });
  return fn;
}

export function freshDb(): MonkDb {
  return openDb(':memory:');
}
