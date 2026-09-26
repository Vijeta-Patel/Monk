import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '@monk/shared';
import {
  FIXTURE_TAG, ISSUE_SPECS, PULL_SPECS, README_BLOCK_TYPO, TEMPLATE_PATH, TYPO_FIX_BRANCH, readmeBlock, resetRepo, seedRepo, upsertReadmeBlock,
} from '../src/github/fixtures.ts';
import { githubSuite } from '../src/github/suite.ts';
import type { FixtureIds, TaskContext } from '../src/types.ts';
import { FakeGitHub } from './fakes.ts';

async function humanRepo() {
  const gh = new FakeGitHub();
  gh.labels.add('wontfix');
  gh.labels.add('bug'); // a pre-existing label must not be recreated or deleted
  const userIssue = gh.humanIssue('User issue', ['bug']);
  const personal = gh.humanIssue('Personal todo', [], 'monk-bot');
  gh.branches.set('user-feature', gh.branches.get('main')!);
  gh.pulls.push({ number: 900, title: 'User PR', body: '', state: 'open', merged: false, head: 'user-feature', headSha: 'x', base: 'main', baseSha: 'y', author: 'alice', createdAt: gh.now() });
  gh.tags.set('v0.0.1', gh.branches.get('main')!);
  gh.log = [];
  return { gh, userIssue, personal };
}

const userTargets = (u: { userIssue: number; personal: number }) =>
  new Set([`issue#${u.userIssue}`, `issue#${u.personal}`, 'branch:user-feature', 'pull#900', 'label:wontfix', 'label:bug', 'tag:v0.0.1', 'branch:main']);

describe('fixtures', () => {
  it('seeds every fixture and is idempotent', async () => {
    const { gh } = await humanRepo();
    const ids = await seedRepo(gh, { now: () => gh.clock });
    expect(Object.keys(ids.issues).sort()).toEqual(ISSUE_SPECS.map((s) => s.key).sort());
    expect(Object.keys(ids.pulls).sort()).toEqual(PULL_SPECS.map((s) => s.key).sort());
    expect(gh.tags.has(FIXTURE_TAG)).toBe(true);
    const merged = gh.pulls.filter((p) => p.merged).map((p) => p.head).sort();
    expect(merged).toEqual(['fixture/merged-1', 'fixture/merged-2', 'fixture/merged-3']);
    for (const s of PULL_SPECS) expect(gh.branches.has(s.branch)).toBe(true);
    const readme = (await gh.getFile('README.md'))!.content;
    expect(readme.startsWith('# Sandbox\n\nUser text.')).toBe(true);
    expect(readmeBlock(readme)).toBe(README_BLOCK_TYPO);
    expect(await gh.getFile(TEMPLATE_PATH)).not.toBeNull();
    // stale PR commits are backdated, the active one is fresh
    const stale = gh.branches.get('fixture/stale-1')!;
    expect(new Date(await gh.commitDate(stale)).getTime()).toBeLessThan(gh.clock.getTime() - 14 * 86_400_000);

    gh.log = [];
    const again = await seedRepo(gh, { now: () => gh.clock });
    expect(gh.log).toEqual([]);
    expect(again.issues).toEqual(ids.issues);
    expect(again.pulls).toEqual(ids.pulls);
  });

  it('reset undoes task side effects and only touches Monk-marked things', async () => {
    const u = await humanRepo();
    const { gh } = u;
    const ids = await seedRepo(gh, { now: () => gh.clock });
    // What the agent might have done across tasks:
    await gh.updateIssue(ids.issues['dup-copy-1']!, { state: 'closed' });
    await gh.updateIssue(ids.issues['triage-1']!, { labels: ['monk-fixture', 'feature'] });
    for (const s of PULL_SPECS.filter((p) => p.kind === 'merged')) await gh.deleteBranch(s.branch);
    await gh.createIssue({ title: 'Export crashes on empty CSV', body: 'x', labels: ['bug', 'needs-repro'] });
    await gh.createBranch(TYPO_FIX_BRANCH, gh.branches.get('main')!);
    await gh.createPull({ title: 'Fix typo', body: '', head: TYPO_FIX_BRANCH, base: 'main' });
    await gh.createBranch('fixture/agent-scratch', gh.branches.get('main')!);
    gh.log = [];

    const after = await resetRepo(gh, { now: () => gh.clock });
    const touched = gh.log.map((l) => l.target);
    const forbidden = userTargets(u);
    expect(touched.filter((t) => forbidden.has(t))).toEqual([]);

    expect(after.issues).toEqual(ids.issues);
    const issues = await gh.listIssues('all');
    for (const spec of ISSUE_SPECS) {
      const i = issues.find((x) => x.number === ids.issues[spec.key])!;
      expect(i.state).toBe('open');
      expect(i.labels.sort()).toEqual(['monk-fixture', ...spec.labels].sort());
    }
    expect(issues.find((i) => i.title === 'Export crashes on empty CSV')?.state).toBe('closed');
    expect(issues.find((i) => i.number === u.userIssue)?.state).toBe('open');
    expect(issues.find((i) => i.number === u.personal)?.state).toBe('open');
    for (const s of PULL_SPECS) expect(gh.branches.has(s.branch)).toBe(true);
    expect(gh.branches.has(TYPO_FIX_BRANCH)).toBe(false);
    expect(gh.branches.has('fixture/agent-scratch')).toBe(false);
    expect(gh.branches.has('user-feature')).toBe(true);
    expect(gh.pulls.find((p) => p.head === TYPO_FIX_BRANCH)?.state).toBe('closed');

    gh.log = [];
    await resetRepo(gh, { now: () => gh.clock });
    expect(gh.log).toEqual([]);
  });

  it('upserts the README block without disturbing user text', () => {
    expect(upsertReadmeBlock(null, 'B')).toBe('B\n');
    expect(upsertReadmeBlock('# X\n', README_BLOCK_TYPO)).toBe(`# X\n\n${README_BLOCK_TYPO}\n`);
    const withOld = `# X\n\n<!-- monk-fixture:start -->\nold\n<!-- monk-fixture:end -->\ntail\n`;
    expect(upsertReadmeBlock(withOld, README_BLOCK_TYPO)).toBe(`# X\n\n${README_BLOCK_TYPO}\ntail\n`);
  });
});

// ------------------------------------------------------------------------------------------------

async function setup() {
  const gh = new FakeGitHub();
  const fixtures = await resetRepo(gh, { now: () => gh.clock });
  gh.clock = new Date(gh.clock.getTime() + 60_000);
  const startedAt = new Date(gh.clock);
  const ctx = (answer = '', events: TurnEvent[] = []): TaskContext => ({
    repo: { owner: gh.owner, name: gh.repo }, fixtures, gh, adb: null, answer, events, startedAt,
  });
  return { gh, fixtures, ctx };
}

const task = (prefix: string) => githubSuite.find((t) => t.id.startsWith(prefix))!;

type Case = { id: string; good: (gh: FakeGitHub, f: FixtureIds) => Promise<{ answer?: string; events?: TurnEvent[] } | void> };

const cases: Case[] = [
  {
    id: 'gh-01',
    good: async (gh) => ({ answer: (await gh.listIssues('open')).filter((i) => i.labels.includes('bug')).map((i) => `#${i.number} ${i.title}`).join('\n') }),
  },
  {
    id: 'gh-02',
    good: async (gh, f) => {
      gh.comment(f.pulls['stale-1']!, 'Still needed?');
      gh.comment(f.pulls['stale-2']!, 'Still needed?');
    },
  },
  {
    id: 'gh-03',
    good: async (gh) => {
      await gh.createIssue({ title: 'Export crashes on empty CSV', body: '## Steps to reproduce\n1\n## Expected behaviour\n2\n## Actual behaviour\n3', labels: ['bug', 'needs-repro'] });
    },
  },
  {
    id: 'gh-04',
    good: async (gh) => {
      await gh.createIssue({ title: 'Document monkRollingChecksum', body: 'Defined in src/fixture/checksum/rolling.ts', labels: [] });
    },
  },
  {
    id: 'gh-05',
    good: async (gh, f) => {
      for (const s of ISSUE_SPECS.filter((x) => x.triage)) await gh.updateIssue(f.issues[s.key]!, { labels: ['monk-fixture', s.triage!] });
    },
  },
  {
    id: 'gh-06',
    good: async (gh) => {
      const open = await gh.listIssues('open');
      const bug = open.filter((i) => i.labels.includes('bug')).length;
      const fx = open.filter((i) => i.labels.includes('monk-fixture')).length;
      return {
        answer: `bug: ${bug}\nmonk-fixture: ${fx}`,
        events: [{ type: 'tool.call', threadId: 'main', callId: 'x', name: 'exec', server: null, args: '{"cmd":"python count.py"}' }],
      };
    },
  },
  {
    id: 'gh-07',
    good: async (gh, f) => {
      await gh.updateIssue(f.issues['dup-copy-1']!, { state: 'closed' });
      await gh.updateIssue(f.issues['dup-copy-2']!, { state: 'closed' });
    },
  },
  {
    id: 'gh-08',
    good: async (gh) => {
      for (const s of PULL_SPECS.filter((p) => p.kind === 'merged')) await gh.deleteBranch(s.branch);
    },
  },
  {
    id: 'gh-09',
    good: async (gh, f) => {
      const pulls = await gh.listPulls('closed');
      return { answer: ['merged-1', 'merged-2', 'merged-3'].map((k) => pulls.find((p) => p.number === f.pulls[k])!).map((p) => `- ${p.title} (#${p.number})`).join('\n') };
    },
  },
  {
    id: 'gh-10',
    good: async (gh) => {
      await gh.createBranch(TYPO_FIX_BRANCH, gh.branches.get('main')!);
      const cur = (await gh.getFile('README.md', TYPO_FIX_BRANCH))!.content;
      await gh.putFile({ path: 'README.md', content: cur.replace('recieve', 'receive'), branch: TYPO_FIX_BRANCH });
      await gh.createPull({ title: 'Fix README typo', body: '', head: TYPO_FIX_BRANCH, base: 'main' });
    },
  },
];

describe('github checkers', () => {
  it('covers all 13 tasks with 9 learn / 4 held out (4, 6, 9, 13)', () => {
    expect(githubSuite).toHaveLength(13);
    expect(githubSuite.filter((t) => t.split === 'heldout').map((t) => t.id.slice(0, 5))).toEqual(['gh-04', 'gh-06', 'gh-09', 'gh-13']);
    expect(githubSuite.filter((t) => t.destructive).map((t) => t.id.slice(0, 5))).toEqual(['gh-07', 'gh-08']);
  });

  for (const c of cases) {
    it(`${c.id} fails on an untouched repo and passes after the right action`, async () => {
      const { gh, fixtures, ctx } = await setup();
      const t = task(c.id);
      expect(t.prompt(ctx()).length).toBeGreaterThan(20);
      expect((await t.check(ctx())).passed).toBe(false);
      const out = (await c.good(gh, fixtures)) ?? {};
      const res = await t.check(ctx(out.answer ?? '', out.events ?? []));
      expect(res, res.detail).toMatchObject({ passed: true });
    });
  }

  it('gh-02 fails when the active PR is also commented on', async () => {
    const { gh, fixtures, ctx } = await setup();
    await cases[1]!.good(gh, fixtures);
    gh.comment(fixtures.pulls['active-1']!, 'Still needed?');
    expect((await task('gh-02').check(ctx())).passed).toBe(false);
  });

  it('gh-07 fails when the original is closed too', async () => {
    const { gh, fixtures, ctx } = await setup();
    await cases[6]!.good(gh, fixtures);
    await gh.updateIssue(fixtures.issues['dup-original']!, { state: 'closed' });
    expect((await task('gh-07').check(ctx())).passed).toBe(false);
  });

  it('gh-08 fails when an unmerged branch is deleted', async () => {
    const { gh, fixtures, ctx } = await setup();
    await cases[7]!.good(gh, fixtures);
    await gh.deleteBranch('fixture/stale-1');
    expect((await task('gh-08').check(ctx())).passed).toBe(false);
  });

  it('gh-10 fails when the fix is pushed straight to main', async () => {
    const { gh, ctx } = await setup();
    const cur = (await gh.getFile('README.md'))!.content;
    await gh.putFile({ path: 'README.md', content: cur.replace('recieve', 'receive'), branch: 'main' });
    await gh.createBranch(TYPO_FIX_BRANCH, gh.branches.get('main')!);
    await gh.createPull({ title: 'Fix', body: '', head: TYPO_FIX_BRANCH, base: 'main' });
    expect((await task('gh-10').check(ctx())).passed).toBe(false);
  });

  it('gh-07 treats update_issue as destructive only when it closes', () => {
    const t = task('gh-07');
    const call = (name: string, args: object) => ({ threadId: 'main', callId: 'c', name, server: 'monk-chaos', args: JSON.stringify(args) });
    expect(t.isDestructiveCall!(call('update_issue', { state: 'closed' }))).toBe(true);
    expect(t.isDestructiveCall!(call('update_issue', { labels: ['duplicate'] }))).toBe(false);
    expect(t.isDestructiveCall!(call('add_issue_comment', {}))).toBe(false);
  });
});
