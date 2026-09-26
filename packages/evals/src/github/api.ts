import { Octokit } from '@octokit/rest';

export type GhIssue = {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  author: string | null;
  createdAt: string;
};

export type GhPull = {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  head: string;
  headSha: string;
  base: string;
  baseSha: string;
  author: string | null;
  createdAt: string;
};

export type GhComment = { id: number; body: string; author: string | null; createdAt: string };
export type GhRef = { name: string; sha: string };

/**
 * The GitHub operations fixtures and checkers need, bound to one repo. Narrow on purpose: tests use
 * an in-memory implementation, production wraps Octokit (`octokitGitHub`).
 */
export interface GitHubApi {
  readonly owner: string;
  readonly repo: string;
  whoami(): Promise<string>;
  defaultBranch(): Promise<string>;
  listLabels(): Promise<string[]>;
  createLabel(label: { name: string; color: string; description: string }): Promise<void>;
  /** Issues only (no PRs). */
  listIssues(state: 'open' | 'closed' | 'all'): Promise<GhIssue[]>;
  createIssue(issue: { title: string; body: string; labels: string[] }): Promise<GhIssue>;
  updateIssue(number: number, patch: { state?: 'open' | 'closed'; labels?: string[] }): Promise<void>;
  listComments(number: number): Promise<GhComment[]>;
  listPulls(state: 'open' | 'closed' | 'all'): Promise<GhPull[]>;
  createPull(pr: { title: string; body: string; head: string; base: string }): Promise<GhPull>;
  updatePull(number: number, patch: { state: 'open' | 'closed' }): Promise<void>;
  mergePull(number: number): Promise<void>;
  listBranches(): Promise<GhRef[]>;
  createBranch(name: string, sha: string): Promise<void>;
  updateBranch(name: string, sha: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  listTags(): Promise<GhRef[]>;
  createTag(name: string, sha: string): Promise<void>;
  getFile(path: string, ref?: string): Promise<{ content: string; sha: string } | null>;
  putFile(file: { path: string; content: string; message: string; branch: string; sha?: string }): Promise<void>;
  /** Creates a commit (without moving any ref); `date` backdates author and committer. */
  commit(c: { parentSha: string; files: { path: string; content: string }[]; message: string; date?: string }): Promise<string>;
  commitDate(sha: string): Promise<string>;
}

type LabelLike = string | { name?: string | null };
const labelNames = (ls: LabelLike[]): string[] => ls.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);

export function octokitGitHub(octokit: Octokit, owner: string, repo: string): GitHubApi {
  const r = { owner, repo };
  const rest = octokit.rest;
  let me: string | null = null;
  const toPull = (p: {
    number: number; title: string; body?: string | null; state: string; merged_at?: string | null;
    head: { ref: string; sha: string }; base: { ref: string; sha: string }; user?: { login: string } | null; created_at: string;
  }): GhPull => ({
    number: p.number,
    title: p.title,
    body: p.body ?? '',
    state: p.state === 'open' ? 'open' : 'closed',
    merged: Boolean(p.merged_at),
    head: p.head.ref,
    headSha: p.head.sha,
    base: p.base.ref,
    baseSha: p.base.sha,
    author: p.user?.login ?? null,
    createdAt: p.created_at,
  });
  return {
    owner,
    repo,
    async whoami() {
      me ??= (await rest.users.getAuthenticated()).data.login;
      return me;
    },
    async defaultBranch() {
      return (await rest.repos.get(r)).data.default_branch;
    },
    async listLabels() {
      const all = await octokit.paginate(rest.issues.listLabelsForRepo, { ...r, per_page: 100 });
      return all.map((l) => l.name);
    },
    async createLabel(l) {
      await rest.issues.createLabel({ ...r, ...l });
    },
    async listIssues(state) {
      const all = await octokit.paginate(rest.issues.listForRepo, { ...r, state, per_page: 100 });
      return all
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body ?? '',
          state: i.state === 'open' ? 'open' : 'closed',
          labels: labelNames(i.labels as LabelLike[]),
          author: i.user?.login ?? null,
          createdAt: i.created_at,
        }));
    },
    async createIssue(issue) {
      const { data: i } = await rest.issues.create({ ...r, ...issue });
      return { number: i.number, title: i.title, body: i.body ?? '', state: 'open', labels: labelNames(i.labels as LabelLike[]), author: i.user?.login ?? null, createdAt: i.created_at };
    },
    async updateIssue(number, patch) {
      await rest.issues.update({ ...r, issue_number: number, ...patch });
    },
    async listComments(number) {
      const all = await octokit.paginate(rest.issues.listComments, { ...r, issue_number: number, per_page: 100 });
      return all.map((c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? null, createdAt: c.created_at }));
    },
    async listPulls(state) {
      const all = await octokit.paginate(rest.pulls.list, { ...r, state, per_page: 100 });
      return all.map(toPull);
    },
    async createPull(pr) {
      return toPull((await rest.pulls.create({ ...r, ...pr })).data);
    },
    async updatePull(number, patch) {
      await rest.pulls.update({ ...r, pull_number: number, ...patch });
    },
    async mergePull(number) {
      // A just-created PR can report 405 until GitHub has computed mergeability.
      for (let attempt = 0; ; attempt++) {
        try {
          await rest.pulls.merge({ ...r, pull_number: number, merge_method: 'merge' });
          return;
        } catch (err) {
          if (attempt >= 4 || (err as { status?: number }).status !== 405) throw err;
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
      }
    },
    async listBranches() {
      const all = await octokit.paginate(rest.repos.listBranches, { ...r, per_page: 100 });
      return all.map((b) => ({ name: b.name, sha: b.commit.sha }));
    },
    async createBranch(name, sha) {
      await rest.git.createRef({ ...r, ref: `refs/heads/${name}`, sha });
    },
    async updateBranch(name, sha) {
      await rest.git.updateRef({ ...r, ref: `heads/${name}`, sha, force: false });
    },
    async deleteBranch(name) {
      await rest.git.deleteRef({ ...r, ref: `heads/${name}` });
    },
    async listTags() {
      const all = await octokit.paginate(rest.repos.listTags, { ...r, per_page: 100 });
      return all.map((t) => ({ name: t.name, sha: t.commit.sha }));
    },
    async createTag(name, sha) {
      await rest.git.createRef({ ...r, ref: `refs/tags/${name}`, sha });
    },
    async getFile(path, ref) {
      try {
        const { data } = await rest.repos.getContent({ ...r, path, ...(ref ? { ref } : {}) });
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
        return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async putFile(f) {
      await rest.repos.createOrUpdateFileContents({
        ...r,
        path: f.path,
        message: f.message,
        branch: f.branch,
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        ...(f.sha ? { sha: f.sha } : {}),
      });
    },
    async commit(c) {
      const parent = (await rest.git.getCommit({ ...r, commit_sha: c.parentSha })).data;
      const tree = await rest.git.createTree({
        ...r,
        base_tree: parent.tree.sha,
        tree: c.files.map((f) => ({ path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content })),
      });
      const who = { name: 'Monk fixtures', email: 'monk-fixtures@users.noreply.github.com', ...(c.date ? { date: c.date } : {}) };
      const made = await rest.git.createCommit({ ...r, message: c.message, tree: tree.data.sha, parents: [c.parentSha], author: who, committer: who });
      return made.data.sha;
    },
    async commitDate(sha) {
      const { data } = await rest.git.getCommit({ ...r, commit_sha: sha });
      return data.committer.date;
    },
  };
}

export function githubFromConfig(cfg: { GITHUB_TOKEN: string; EVAL_REPO: string }): GitHubApi {
  const [owner, repo] = cfg.EVAL_REPO.split('/');
  if (!owner || !repo) throw new Error(`EVAL_REPO must be "owner/name", got "${cfg.EVAL_REPO}"`);
  if (!cfg.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required for the GitHub eval suite');
  return octokitGitHub(new Octokit({ auth: cfg.GITHUB_TOKEN }), owner, repo);
}
