import type { TrueForge, TrueForgeApi } from '@monk/shared';
import type { GhComment, GhIssue, GhPull, GitHubApi } from '../src/github/api.ts';
import type { Adb } from '../src/mobile/adb.ts';

// ------------------------------------------------------------------------------------------------
// In-memory GitHub repo.

type Commit = { sha: string; parent: string | null; files: Map<string, string>; date: string };

export class FakeGitHub implements GitHubApi {
  readonly owner = 'acme';
  readonly repo = 'sandbox';
  me = 'monk-bot';
  clock = new Date('2026-09-23T10:00:00Z');
  labels = new Set<string>();
  issues: (GhIssue & { comments: GhComment[] })[] = [];
  pulls: GhPull[] = [];
  branches = new Map<string, string>();
  tags = new Map<string, string>();
  commits = new Map<string, Commit>();
  log: { op: string; target: string }[] = [];
  private seq = 0;
  private num = 0;
  private commentId = 0;

  constructor() {
    const root = this.mkCommit(null, { 'README.md': '# Sandbox\n\nUser text.\n' }, this.clock.toISOString());
    this.branches.set('main', root);
  }

  now(): string {
    this.clock = new Date(this.clock.getTime() + 1000);
    return this.clock.toISOString();
  }

  private mkCommit(parent: string | null, files: Record<string, string>, date: string): string {
    const sha = `c${(++this.seq).toString(16).padStart(8, '0')}`;
    const base = parent ? new Map(this.commits.get(parent)!.files) : new Map<string, string>();
    for (const [p, c] of Object.entries(files)) base.set(p, c);
    this.commits.set(sha, { sha, parent, files: base, date });
    return sha;
  }

  private rec(op: string, target: string) {
    this.log.push({ op, target });
  }

  /** Setup helpers that bypass the log (things "a human" made). */
  humanIssue(title: string, labels: string[], author = 'alice'): number {
    const n = ++this.num;
    this.issues.push({ number: n, title, body: 'human', state: 'open', labels, author, createdAt: this.now(), comments: [] });
    return n;
  }

  async whoami() { return this.me; }
  async defaultBranch() { return 'main'; }
  async listLabels() { return [...this.labels]; }
  async createLabel(l: { name: string }) {
    this.rec('createLabel', `label:${l.name}`);
    this.labels.add(l.name);
  }
  async listIssues(state: 'open' | 'closed' | 'all') {
    return this.issues.filter((i) => state === 'all' || i.state === state).map(({ comments: _c, ...i }) => ({ ...i, labels: [...i.labels] }));
  }
  async createIssue(i: { title: string; body: string; labels: string[] }) {
    const n = ++this.num;
    this.rec('createIssue', `issue#${n}`);
    const issue = { number: n, title: i.title, body: i.body, state: 'open' as const, labels: [...i.labels], author: this.me, createdAt: this.now(), comments: [] };
    this.issues.push(issue);
    return { ...issue, comments: undefined } as unknown as GhIssue;
  }
  async updateIssue(n: number, patch: { state?: 'open' | 'closed'; labels?: string[] }) {
    this.rec('updateIssue', `issue#${n}`);
    const i = this.issues.find((x) => x.number === n) ?? this.pulls.find((x) => x.number === n);
    if (!i) throw new Error(`no issue ${n}`);
    if (patch.state) i.state = patch.state;
    if (patch.labels && 'labels' in i) i.labels = [...patch.labels];
  }
  comments = new Map<number, GhComment[]>();
  async listComments(n: number) {
    return this.issues.find((x) => x.number === n)?.comments ?? this.comments.get(n) ?? [];
  }
  /** Agent-side action (not a GitHubApi method). */
  comment(n: number, body: string) {
    const c = { id: ++this.commentId, body, author: this.me, createdAt: this.now() };
    const issue = this.issues.find((x) => x.number === n);
    if (issue) issue.comments.push(c);
    else this.comments.set(n, [...(this.comments.get(n) ?? []), c]);
  }
  async listPulls(state: 'open' | 'closed' | 'all') {
    return this.pulls.filter((p) => state === 'all' || p.state === state).map((p) => ({ ...p }));
  }
  async createPull(pr: { title: string; body: string; head: string; base: string }) {
    const n = ++this.num;
    this.rec('createPull', `pull#${n}`);
    const p: GhPull = {
      number: n, title: pr.title, body: pr.body, state: 'open', merged: false, head: pr.head, headSha: this.branches.get(pr.head)!,
      base: pr.base, baseSha: this.branches.get(pr.base)!, author: this.me, createdAt: this.now(),
    };
    this.pulls.push(p);
    return { ...p };
  }
  async updatePull(n: number, patch: { state: 'open' | 'closed' }) {
    this.rec('updatePull', `pull#${n}`);
    const p = this.pulls.find((x) => x.number === n)!;
    if (patch.state === 'open' && !this.branches.has(p.head)) throw new Error('cannot reopen: head branch missing');
    p.state = patch.state;
  }
  async mergePull(n: number) {
    this.rec('mergePull', `pull#${n}`);
    const p = this.pulls.find((x) => x.number === n)!;
    const head = this.commits.get(this.branches.get(p.head)!)!;
    const merge = this.mkCommit(this.branches.get(p.base)!, Object.fromEntries(head.files), this.now());
    this.branches.set(p.base, merge);
    p.merged = true;
    p.state = 'closed';
    p.headSha = head.sha;
  }
  async listBranches() { return [...this.branches].map(([name, sha]) => ({ name, sha })); }
  async createBranch(name: string, sha: string) {
    this.rec('createBranch', `branch:${name}`);
    if (this.branches.has(name)) throw new Error('exists');
    this.branches.set(name, sha);
  }
  async updateBranch(name: string, sha: string) {
    this.rec('updateBranch', `branch:${name}`);
    this.branches.set(name, sha);
  }
  async deleteBranch(name: string) {
    this.rec('deleteBranch', `branch:${name}`);
    this.branches.delete(name);
    for (const p of this.pulls) if (p.head === name && p.state === 'open') p.state = 'closed';
  }
  async listTags() { return [...this.tags].map(([name, sha]) => ({ name, sha })); }
  async createTag(name: string, sha: string) {
    this.rec('createTag', `tag:${name}`);
    this.tags.set(name, sha);
  }
  async getFile(path: string, ref = 'main') {
    const sha = this.branches.get(ref) ?? ref;
    const content = this.commits.get(sha)?.files.get(path);
    return content === undefined ? null : { content, sha: `${sha}:${path}` };
  }
  async putFile(f: { path: string; content: string; branch: string }) {
    this.rec('putFile', `file:${f.path}`);
    this.branches.set(f.branch, this.mkCommit(this.branches.get(f.branch)!, { [f.path]: f.content }, this.now()));
  }
  async commit(c: { parentSha: string; files: { path: string; content: string }[]; date?: string }) {
    return this.mkCommit(c.parentSha, Object.fromEntries(c.files.map((f) => [f.path, f.content])), c.date ?? this.now());
  }
  async commitDate(sha: string) { return this.commits.get(sha)!.date; }
}

// ------------------------------------------------------------------------------------------------
// Scripted TrueForge client.

export function ev(e: { type: string } & Record<string, unknown>): TrueForgeApi.TurnStreamingEvent {
  return { createdAt: '2026-09-23T00:00:00Z', threadId: 'main', id: `e${Math.random().toString(36).slice(2)}`, ...e } as unknown as TrueForgeApi.TurnStreamingEvent;
}

export function toolMsg(id: string, calls: { id: string; name: string; args?: object; server?: string | null }[], content = '') {
  return ev({
    type: 'model.message',
    id,
    content,
    toolCalls: calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      ...(c.server === null ? {} : { toolInfo: { type: 'mcp', name: c.name, serverId: 's', serverName: c.server ?? 'monk-chaos' } }),
    })),
  });
}

export const said = (id: string, content: string) => ev({ type: 'model.message', id, content });
export const result = (callId: string, content = '{"ok":true}') => ev({ type: 'tool.response', toolCallId: callId, content });
export const mcpInit = (sessionId: string) => ev({ type: 'mcp.initialize', mcpServers: [{ id: 'x', name: 'monk-chaos', sessionId }] });
export const done = (opts: { paused?: boolean; output?: string; tokens?: [number, number] } = {}) =>
  ev({
    type: 'turn.done',
    threadId: null,
    state: {
      status: 'done',
      completedAt: 'x',
      output: opts.output ? { content: opts.output } : null,
      requiredActions: opts.paused ? [{}] : [],
      metrics: { totalInputTokens: opts.tokens?.[0] ?? 1000, totalOutputTokens: opts.tokens?.[1] ?? 100 },
    },
  });

export type TurnScript = (ctx: { sessionId: string; turn: number; input: TrueForgeApi.TurnInputItem[]; metadata: Record<string, string> }) => TrueForgeApi.TurnStreamingEvent[];

export class FakeTrueForge {
  sessionsMade: { id: string; agent: unknown; metadata: Record<string, string> }[] = [];
  inputs = new Map<string, TrueForgeApi.TurnInputItem[][]>();
  cancelled = new Set<string>();
  private n = 0;
  script: TurnScript;
  constructor(script: TurnScript) {
    this.script = script;
  }

  sessions = {
    create: async (req: { agent: unknown; metadata?: Record<string, string> }) => {
      const id = `tfs_${++this.n}`;
      this.sessionsMade.push({ id, agent: req.agent, metadata: req.metadata ?? {} });
      return { data: { id } };
    },
    cancel: async (sid: string) => {
      this.cancelled.add(sid);
      return {};
    },
    createTurnStream: async (sid: string, req: { input: TrueForgeApi.TurnInputItem[] }) => {
      const turns = this.inputs.get(sid) ?? [];
      turns.push(req.input);
      this.inputs.set(sid, turns);
      const meta = this.sessionsMade.find((s) => s.id === sid)?.metadata ?? {};
      const events = this.script({ sessionId: sid, turn: turns.length - 1, input: req.input, metadata: meta });
      const self = this;
      return (async function* () {
        for (const e of events) {
          await Promise.resolve();
          if (self.cancelled.has(sid)) {
            yield ev({ type: 'turn.done', threadId: null, state: { status: 'cancelled', reason: 'user', metrics: {} } });
            return;
          }
          yield e;
        }
      })();
    },
  };

  asClient(): TrueForge {
    return this as unknown as TrueForge;
  }
}

// ------------------------------------------------------------------------------------------------
// Fake adb: exact-command table.

export function fakeAdb(table: Record<string, string | Error>): Adb & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (args: string[]) => {
    calls.push(args);
    const out = table[args.join(' ')];
    if (out instanceof Error) throw out;
    if (out === undefined) throw new Error(`unexpected adb ${args.join(' ')}`);
    return out;
  }) as Adb & { calls: string[][] };
  fn.calls = calls;
  return fn;
}
