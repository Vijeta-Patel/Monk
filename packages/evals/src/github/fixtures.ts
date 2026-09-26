import type { FixtureIds } from '../types.ts';
import type { GhIssue, GitHubApi } from './api.ts';

// Everything Monk creates in the eval repo carries one of these marks; reset touches nothing else.
export const FIXTURE_LABEL = 'monk-fixture';
export const FIXTURE_BRANCH_PREFIX = 'fixture/';
export const FIXTURE_TAG = 'monk-fixture-v1.0.0';
export const README_START = '<!-- monk-fixture:start -->';
export const README_END = '<!-- monk-fixture:end -->';

const marker = (key: string) => `<!-- monk-fixture:${key} -->`;
const MARKER_RE = /<!-- monk-fixture:([a-z0-9-]+) -->/;
export const fixtureKeyOf = (issue: Pick<GhIssue, 'body'>): string | null => MARKER_RE.exec(issue.body)?.[1] ?? null;

export const FIXTURE_LABELS = [
  { name: FIXTURE_LABEL, color: '6e5494', description: 'Created by Monk eval fixtures' },
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'feature', color: 'a2eeef', description: 'New feature or request' },
  { name: 'question', color: 'd876e3', description: 'Further information is requested' },
  { name: 'needs-repro', color: 'fbca04', description: 'Needs steps to reproduce' },
];

export type IssueSpec = { key: string; title: string; body: string; labels: string[]; triage?: 'bug' | 'feature' | 'question' };

export const ISSUE_SPECS: IssueSpec[] = [
  { key: 'bug-login', title: 'Login button unresponsive on Safari 17', body: 'Clicking "Log in" does nothing on Safari 17.2. Console shows no errors.', labels: ['bug'] },
  { key: 'bug-timezone', title: 'Dates shown in UTC instead of local time', body: 'The activity feed shows UTC timestamps; users expect local time.', labels: ['bug'] },
  { key: 'bug-upload', title: 'Upload fails for files over 10 MB', body: 'Uploading an 11 MB PNG returns a generic error after 30 seconds.', labels: ['bug'] },
  { key: 'dup-original', title: 'App crashes when exporting to CSV', body: 'Exporting any report to CSV crashes the app with a null reference error.', labels: ['bug'] },
  { key: 'dup-copy-1', title: 'Crash on CSV export', body: 'When I export to CSV the app crashes (null reference). Started this week.', labels: ['bug'] },
  { key: 'dup-copy-2', title: 'CSV export crashes the app', body: 'Export -> CSV -> crash. Same null reference error every time.', labels: ['bug'] },
  { key: 'triage-1', title: 'Add dark mode to the dashboard', body: 'It would be great to have a dark theme for the dashboard.', labels: [], triage: 'feature' },
  { key: 'triage-2', title: 'How do I rotate my API key?', body: 'I cannot find where to rotate my API key. Is there a docs page?', labels: [], triage: 'question' },
  { key: 'triage-3', title: 'Search returns 500 when the query contains a quote', body: 'Searching for `it\'s` returns HTTP 500. Searching without the quote works.', labels: [], triage: 'bug' },
  { key: 'triage-4', title: 'Support exporting reports as PDF', body: 'Please add PDF as an export format next to CSV.', labels: [], triage: 'feature' },
  { key: 'triage-5', title: 'Is there a rate limit on the public API?', body: 'What is the request limit per minute for the public API?', labels: [], triage: 'question' },
];

export type PullSpec = { key: string; branch: string; title: string; kind: 'merged' | 'stale' | 'active'; file: string };

export const PULL_SPECS: PullSpec[] = [
  { key: 'merged-1', branch: 'fixture/merged-1', title: 'Add CSV export for reports', kind: 'merged', file: 'fixture/changes/csv-export.md' },
  { key: 'merged-2', branch: 'fixture/merged-2', title: 'Fix timezone handling in the date picker', kind: 'merged', file: 'fixture/changes/timezone.md' },
  { key: 'merged-3', branch: 'fixture/merged-3', title: 'Retry failed uploads with backoff', kind: 'merged', file: 'fixture/changes/upload-retry.md' },
  { key: 'stale-1', branch: 'fixture/stale-1', title: 'Experiment: new caching layer', kind: 'stale', file: 'fixture/wip/cache.md' },
  { key: 'stale-2', branch: 'fixture/stale-2', title: 'Draft: migrate build to ESM', kind: 'stale', file: 'fixture/wip/esm.md' },
  { key: 'active-1', branch: 'fixture/active-1', title: 'Refactor the settings page', kind: 'active', file: 'fixture/wip/settings.md' },
];

export const TYPO_FIX_BRANCH = 'fixture/readme-typo-fix';
export const README_BLOCK_TYPO = `${README_START}\n## Monk fixture\n\nContributors will recieve a review within two days.\n${README_END}`;
export const README_FIXED_SENTENCE = 'Contributors will receive a review within two days.';

export const TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/monk-fixture-bug.md';
export const TEMPLATE_LABELS = ['bug', 'needs-repro'];
export const TEMPLATE_HEADINGS = ['## Steps to reproduce', '## Expected behaviour', '## Actual behaviour'];
export const FUNCTION_NAME = 'monkRollingChecksum';
export const FUNCTION_PATH = 'src/fixture/checksum/rolling.ts';

export const FIXTURE_FILES: { path: string; content: string }[] = [
  {
    path: TEMPLATE_PATH,
    content: `---\nname: Monk fixture bug report\nabout: Report a bug (Monk eval fixture)\nlabels: [${TEMPLATE_LABELS.join(', ')}]\n---\n\n${TEMPLATE_HEADINGS.join('\n\n<!-- fill in -->\n\n')}\n\n<!-- fill in -->\n`,
  },
  {
    path: FUNCTION_PATH,
    content: `// Monk eval fixture.\nexport function ${FUNCTION_NAME}(data: Uint8Array, window = 64): number {\n  let a = 1;\n  let b = 0;\n  for (let i = 0; i < data.length; i++) {\n    a = (a + (data[i] ?? 0)) % 65521;\n    b = (b + a) % 65521;\n    if (i >= window) a = (a - (data[i - window] ?? 0) + 65521) % 65521;\n  }\n  return (b << 16) | a;\n}\n`,
  },
  {
    path: 'src/fixture/checksum/index.ts',
    content: `// Monk eval fixture. Re-exports only; the definition lives elsewhere.\nexport { ${FUNCTION_NAME} } from './rolling.ts';\n`,
  },
];

/**
 * Titles of issues the agent creates in tasks 3 and 4 (and a wrongly created duplicate in edge task
 * ghe-06); reset closes the agent's own leftovers. Keyed fixture issues are skipped before this runs.
 */
export const LEFTOVER_TITLE_RE = /empty csv|monkRollingChecksum|^upload fails for files over 10 mb$/i;

const DAY = 86_400_000;

export function upsertReadmeBlock(readme: string | null, block: string): string {
  if (readme === null) return `${block}\n`;
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start >= 0 && end > start) return readme.slice(0, start) + block + readme.slice(end + README_END.length);
  return `${readme.replace(/\n*$/, '')}\n\n${block}\n`;
}

export function readmeBlock(readme: string | null): string | null {
  if (!readme) return null;
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  return start >= 0 && end > start ? readme.slice(start, end + README_END.length) : null;
}

async function headSha(gh: GitHubApi, branch: string): Promise<string> {
  const b = (await gh.listBranches()).find((x) => x.name === branch);
  if (!b) throw new Error(`branch ${branch} not found in ${gh.owner}/${gh.repo}`);
  return b.sha;
}

/** Creates whatever fixture is missing and restores fixture state. Idempotent. */
export async function seedRepo(gh: GitHubApi, opts: { now?: () => Date } = {}): Promise<FixtureIds> {
  const now = opts.now ?? (() => new Date());
  const def = await gh.defaultBranch();

  const labels = new Set(await gh.listLabels());
  for (const l of FIXTURE_LABELS) if (!labels.has(l.name)) await gh.createLabel(l);

  for (const f of FIXTURE_FILES) {
    const cur = await gh.getFile(f.path, def);
    if (cur?.content !== f.content) {
      await gh.putFile({ path: f.path, content: f.content, message: `monk fixture: ${f.path}`, branch: def, ...(cur ? { sha: cur.sha } : {}) });
    }
  }
  const readme = await gh.getFile('README.md', def);
  const nextReadme = upsertReadmeBlock(readme?.content ?? null, README_BLOCK_TYPO);
  if (readme?.content !== nextReadme) {
    await gh.putFile({ path: 'README.md', content: nextReadme, message: 'monk fixture: README block', branch: def, ...(readme ? { sha: readme.sha } : {}) });
  }

  let pulls = await gh.listPulls('all');
  const pullFor = (branch: string) => pulls.filter((p) => p.head === branch).sort((a, b) => b.number - a.number)[0];

  // The tag must precede the fixture merges so "merged since the last tag" is exactly those PRs.
  const tags = await gh.listTags();
  if (!tags.some((t) => t.name === FIXTURE_TAG)) {
    const merged = PULL_SPECS.filter((s) => s.kind === 'merged').map((s) => pullFor(s.branch)).filter((p) => p?.merged);
    const firstBase = merged.sort((a, b) => a!.number - b!.number)[0]?.baseSha;
    await gh.createTag(FIXTURE_TAG, firstBase ?? (await headSha(gh, def)));
  }

  let branches = new Map((await gh.listBranches()).map((b) => [b.name, b.sha]));
  for (const spec of PULL_SPECS) {
    let pr = pullFor(spec.branch);
    if (pr && !branches.has(spec.branch)) await gh.createBranch(spec.branch, pr.headSha);
    if (!pr) {
      const parent = await headSha(gh, def);
      const date = spec.kind === 'stale' ? new Date(now().getTime() - 30 * DAY).toISOString() : now().toISOString();
      const sha = await gh.commit({ parentSha: parent, files: [{ path: spec.file, content: `# ${spec.title}\n\nMonk eval fixture.\n` }], message: spec.title, date });
      await gh.createBranch(spec.branch, sha);
      pr = await gh.createPull({ title: spec.title, body: `${marker(spec.key)}\nMonk eval fixture.`, head: spec.branch, base: def });
    }
    if (spec.kind === 'merged' && !pr.merged) {
      if (pr.state === 'closed') await gh.updatePull(pr.number, { state: 'open' });
      await gh.mergePull(pr.number);
    }
    if (spec.kind !== 'merged' && pr.state === 'closed' && !pr.merged) await gh.updatePull(pr.number, { state: 'open' });
    if (spec.kind === 'active') {
      // Keep its last commit recent so it never looks stale.
      const head = (await gh.listBranches()).find((b) => b.name === spec.branch)?.sha ?? pr.headSha;
      if (now().getTime() - new Date(await gh.commitDate(head)).getTime() > 3 * DAY) {
        const sha = await gh.commit({ parentSha: head, files: [{ path: spec.file, content: `# ${spec.title}\n\nUpdated ${now().toISOString()}\n` }], message: 'Keep working on settings', date: now().toISOString() });
        await gh.updateBranch(spec.branch, sha);
      }
    }
    pulls = await gh.listPulls('all');
    branches = new Map((await gh.listBranches()).map((b) => [b.name, b.sha]));
  }

  const issues = await gh.listIssues('all');
  const byKey = new Map<string, GhIssue[]>();
  for (const i of issues) {
    const key = i.labels.includes(FIXTURE_LABEL) ? fixtureKeyOf(i) : null;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  const ids: FixtureIds = { issues: {}, pulls: {}, branches: {}, tag: FIXTURE_TAG, defaultBranch: def, seededAt: now().toISOString() };
  for (const spec of ISSUE_SPECS) {
    const want = [FIXTURE_LABEL, ...spec.labels].sort();
    const [keep, ...extra] = (byKey.get(spec.key) ?? []).sort((a, b) => a.number - b.number);
    for (const e of extra) if (e.state === 'open') await gh.updateIssue(e.number, { state: 'closed' });
    if (!keep) {
      const created = await gh.createIssue({ title: spec.title, body: `${spec.body}\n\n${marker(spec.key)}`, labels: want });
      ids.issues[spec.key] = created.number;
      continue;
    }
    ids.issues[spec.key] = keep.number;
    const patch: { state?: 'open'; labels?: string[] } = {};
    if (keep.state !== 'open') patch.state = 'open';
    if ([...keep.labels].sort().join(',') !== want.join(',')) patch.labels = want;
    if (patch.state || patch.labels) await gh.updateIssue(keep.number, patch);
  }
  for (const spec of PULL_SPECS) {
    const pr = pullFor(spec.branch);
    if (pr) ids.pulls[spec.key] = pr.number;
    ids.branches[spec.key] = spec.branch;
  }
  return ids;
}

/** Removes what earlier task runs left behind (only Monk-marked things), then re-seeds. */
export async function resetRepo(gh: GitHubApi, opts: { now?: () => Date } = {}): Promise<FixtureIds> {
  const me = await gh.whoami();
  const known = new Set(PULL_SPECS.map((s) => s.branch));

  const pulls = await gh.listPulls('open');
  for (const b of await gh.listBranches()) {
    if (!b.name.startsWith(FIXTURE_BRANCH_PREFIX) || known.has(b.name)) continue;
    for (const p of pulls.filter((p) => p.head === b.name)) await gh.updatePull(p.number, { state: 'closed' });
    await gh.deleteBranch(b.name);
  }

  for (const i of await gh.listIssues('open')) {
    if (fixtureKeyOf(i) && i.labels.includes(FIXTURE_LABEL)) continue;
    const agentLeftover = i.author === me && LEFTOVER_TITLE_RE.test(i.title);
    const markedLeftover = i.labels.includes(FIXTURE_LABEL) && !fixtureKeyOf(i);
    if (agentLeftover || markedLeftover) await gh.updateIssue(i.number, { state: 'closed' });
  }
  return seedRepo(gh, opts);
}
