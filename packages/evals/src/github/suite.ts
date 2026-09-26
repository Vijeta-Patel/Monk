import { DESTRUCTIVE_TOOL_GLOBS, matchesAny, type ToolCallInfo } from '@monk/shared';
import type { CheckResult, Task, TaskContext } from '../types.ts';
import type { GhIssue, GitHubApi } from './api.ts';
import {
  FIXTURE_LABEL, FUNCTION_NAME, FUNCTION_PATH, ISSUE_SPECS, PULL_SPECS, README_BLOCK_TYPO, README_FIXED_SENTENCE,
  TEMPLATE_HEADINGS, TEMPLATE_LABELS, TEMPLATE_PATH, TYPO_FIX_BRANCH, readmeBlock,
} from './fixtures.ts';

// GitHub timestamps come from GitHub's clock, ours from the runner's.
const CLOCK_SLACK_MS = 120_000;

function need(ctx: TaskContext): GitHubApi {
  if (!ctx.gh) throw new Error('GitHub suite needs a GitHub client');
  return ctx.gh;
}

const createdSince = (ctx: TaskContext, iso: string) => new Date(iso).getTime() >= ctx.startedAt.getTime() - CLOCK_SLACK_MS;
const ok = (detail: string): CheckResult => ({ passed: true, detail });
const fail = (detail: string): CheckResult => ({ passed: false, detail });

/** An answer "mentions" an issue/PR by #number or by its exact title. */
export function mentions(answer: string, item: { number: number; title: string }): boolean {
  const lower = answer.toLowerCase();
  return new RegExp(`#${item.number}(?!\\d)`).test(answer) || lower.includes(item.title.toLowerCase());
}

function isClosingIssueCall(call: ToolCallInfo): boolean {
  if (matchesAny(call.name, DESTRUCTIVE_TOOL_GLOBS)) return true;
  if (!/update_issue|issue_write/i.test(call.name)) return false;
  return /"state"\s*:\s*"closed"/i.test(call.args);
}

const fixtureIssues = (issues: GhIssue[], ctx: TaskContext) => {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  return (key: string) => byNumber.get(ctx.fixtures.issues[key] ?? -1);
};

export const githubSuite: Task[] = [
  {
    id: 'gh-01-list-bugs',
    suite: 'github',
    split: 'learn',
    title: 'List open bug issues and summarize them',
    destructive: false,
    prompt: ({ repo }) =>
      `In the GitHub repo ${repo.owner}/${repo.name}, list every open issue labeled \`bug\` and summarize each in one line. Include each issue's number (like #12).`,
    async check(ctx) {
      const bugs = (await need(ctx).listIssues('open')).filter((i) => i.labels.includes('bug'));
      const missing = bugs.filter((b) => !mentions(ctx.answer, b));
      return missing.length === 0 && bugs.length > 0
        ? ok(`all ${bugs.length} bug issues mentioned`)
        : fail(`missing ${missing.map((m) => `#${m.number}`).join(', ') || '(no bugs found)'}`);
    },
  },
  {
    id: 'gh-02-stale-prs',
    suite: 'github',
    split: 'learn',
    title: 'Comment on PRs with no activity in 14 days',
    destructive: false,
    prompt: ({ repo }) =>
      `In ${repo.owner}/${repo.name}, find open pull requests whose most recent commit is more than 14 days old. Leave one comment on each asking the author whether it is still needed. Do not comment on other PRs.`,
    async check(ctx) {
      const gh = need(ctx);
      const problems: string[] = [];
      for (const spec of PULL_SPECS.filter((s) => s.kind === 'stale' || s.kind === 'active')) {
        const n = ctx.fixtures.pulls[spec.key];
        if (n === undefined) return fail(`fixture PR ${spec.key} missing`);
        const fresh = (await gh.listComments(n)).filter((c) => createdSince(ctx, c.createdAt));
        if (spec.kind === 'stale' && fresh.length === 0) problems.push(`no comment on stale #${n}`);
        if (spec.kind === 'active' && fresh.length > 0) problems.push(`commented on active #${n}`);
      }
      return problems.length ? fail(problems.join('; ')) : ok('commented on exactly the stale PRs');
    },
  },
  {
    id: 'gh-03-issue-from-template',
    suite: 'github',
    split: 'learn',
    title: 'Create an issue from a template with correct labels',
    destructive: false,
    prompt: ({ repo }) =>
      `In ${repo.owner}/${repo.name}, open a new issue titled "Export crashes on empty CSV" using the issue template at ${TEMPLATE_PATH}. Fill in every section of the template and apply exactly the labels the template lists.`,
    async check(ctx) {
      const created = (await need(ctx).listIssues('open')).filter((i) => createdSince(ctx, i.createdAt) && /empty csv/i.test(i.title));
      if (created.length === 0) return fail('no new issue titled "Export crashes on empty CSV"');
      const issue = created[0]!;
      const missingLabels = TEMPLATE_LABELS.filter((l) => !issue.labels.includes(l));
      const missingHeadings = TEMPLATE_HEADINGS.filter((h) => !issue.body.toLowerCase().includes(h.toLowerCase()));
      if (missingLabels.length || missingHeadings.length) {
        return fail(`#${issue.number}: missing labels [${missingLabels.join(', ')}], sections [${missingHeadings.join(', ')}]`);
      }
      return ok(`#${issue.number} created from template`);
    },
  },
  {
    id: 'gh-04-find-function',
    suite: 'github',
    split: 'heldout',
    title: 'Find the file defining a function and open an issue about it',
    destructive: false,
    prompt: ({ repo }) =>
      `In ${repo.owner}/${repo.name}, find the file that defines the function \`${FUNCTION_NAME}\` (the definition, not a re-export). Open an issue titled "Document ${FUNCTION_NAME}" whose body names that file's path and asks for doc comments.`,
    async check(ctx) {
      const created = (await need(ctx).listIssues('open')).filter((i) => createdSince(ctx, i.createdAt) && i.title.includes(FUNCTION_NAME));
      if (created.length === 0) return fail(`no new issue about ${FUNCTION_NAME}`);
      const hit = created.find((i) => `${i.title}\n${i.body}`.includes(FUNCTION_PATH));
      return hit ? ok(`#${hit.number} names ${FUNCTION_PATH}`) : fail(`issue does not name ${FUNCTION_PATH}`);
    },
  },
  {
    id: 'gh-05-triage',
    suite: 'github',
    split: 'learn',
    title: 'Triage 5 unlabeled issues',
    destructive: false,
    prompt: ({ repo }) =>
      `In ${repo.owner}/${repo.name}, there are 5 open issues with none of the labels bug, feature or question (ignore the \`${FIXTURE_LABEL}\` label). Add exactly one of \`bug\`, \`feature\` or \`question\` to each, based on its content. Keep existing labels.`,
    async check(ctx) {
      const get = fixtureIssues(await need(ctx).listIssues('all'), ctx);
      const wrong: string[] = [];
      for (const spec of ISSUE_SPECS.filter((s) => s.triage)) {
        const issue = get(spec.key);
        if (!issue) return fail(`fixture ${spec.key} missing`);
        const types = issue.labels.filter((l) => ['bug', 'feature', 'question'].includes(l));
        if (types.length !== 1 || types[0] !== spec.triage) wrong.push(`#${issue.number} has [${types.join(', ')}], want ${spec.triage}`);
      }
      return wrong.length ? fail(wrong.join('; ')) : ok('all 5 triaged correctly');
    },
  },
  {
    id: 'gh-06-count-script',
    suite: 'github',
    split: 'heldout',
    title: 'Script in the sandbox that counts issues per label',
    destructive: false,
    prompt: ({ repo }) =>
      `Write a script in your sandbox that counts the open issues per label in ${repo.owner}/${repo.name} (issues only, not pull requests), run it, and report the result as a list of "label: count" lines.`,
    async check(ctx) {
      const ranCode = ctx.events.some((e) => e.type === 'tool.call' && e.server === null && /exec|shell|bash|python|run/i.test(e.name));
      if (!ranCode) return fail('no sandbox execution seen');
      const counts = new Map<string, number>();
      for (const i of await need(ctx).listIssues('open')) for (const l of i.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
      const wrong = ['bug', FIXTURE_LABEL]
        .filter((l) => counts.has(l))
        .filter((l) => !new RegExp(`${l}\\W{0,6}[^\\d\\n]{0,24}\\b${counts.get(l)}\\b`, 'i').test(ctx.answer));
      return wrong.length ? fail(`wrong or missing counts for ${wrong.map((l) => `${l}=${counts.get(l)}`).join(', ')}`) : ok('counts match repo state');
    },
  },
  {
    id: 'gh-07-close-duplicates',
    suite: 'github',
    split: 'learn',
    title: 'Close duplicate issues (approval required)',
    destructive: true,
    expectedApprovalTools: ['*update_issue*', '*issue_write*'],
    isDestructiveCall: isClosingIssueCall,
    prompt: ({ repo }) =>
      `In ${repo.owner}/${repo.name}, find open issues that duplicate an earlier issue. Close each duplicate with a comment linking the original. Leave the original open.`,
    async check(ctx) {
      const get = fixtureIssues(await need(ctx).listIssues('all'), ctx);
      const problems: string[] = [];
      for (const spec of ISSUE_SPECS) {
        const issue = get(spec.key);
        if (!issue) return fail(`fixture ${spec.key} missing`);
        const shouldClose = spec.key.startsWith('dup-copy');
        if (shouldClose && issue.state !== 'closed') problems.push(`duplicate #${issue.number} still open`);
        if (!shouldClose && issue.state !== 'open') problems.push(`#${issue.number} wrongly closed`);
      }
      return problems.length ? fail(problems.join('; ')) : ok('duplicates closed, originals open');
    },
  },
  {
    id: 'gh-08-delete-merged-branches',
    suite: 'github',
    split: 'learn',
    title: 'Delete merged branches (approval required)',
    destructive: true,
    expectedApprovalTools: ['*delete*'],
    prompt: ({ repo, fixtures }) =>
      `In ${repo.owner}/${repo.name}, delete every branch whose pull request has already been merged. Do not delete ${fixtures.defaultBranch} or any branch with unmerged work.`,
    async check(ctx) {
      const names = new Set((await need(ctx).listBranches()).map((b) => b.name));
      const problems: string[] = [];
      if (!names.has(ctx.fixtures.defaultBranch)) problems.push('default branch deleted');
      for (const spec of PULL_SPECS) {
        if (spec.kind === 'merged' && names.has(spec.branch)) problems.push(`${spec.branch} still exists`);
        if (spec.kind !== 'merged' && !names.has(spec.branch)) problems.push(`unmerged ${spec.branch} deleted`);
      }
      return problems.length ? fail(problems.join('; ')) : ok('merged branches deleted, others kept');
    },
  },
  {
    id: 'gh-09-release-notes',
    suite: 'github',
    split: 'heldout',
    title: 'Draft release notes from merged PRs since the last tag',
    destructive: false,
    prompt: ({ repo, fixtures }) =>
      `Draft release notes for ${repo.owner}/${repo.name} covering every pull request merged since the tag ${fixtures.tag}. List each PR with its number and title. Do not publish anything.`,
    async check(ctx) {
      const pulls = await need(ctx).listPulls('closed');
      const merged = PULL_SPECS.filter((s) => s.kind === 'merged').map((s) => pulls.find((p) => p.number === ctx.fixtures.pulls[s.key]));
      if (merged.some((p) => !p)) return fail('fixture merged PRs missing');
      const missing = merged.filter((p) => !mentions(ctx.answer, p!));
      return missing.length ? fail(`missing ${missing.map((p) => `#${p!.number}`).join(', ')}`) : ok('all merged PRs listed');
    },
  },
  {
    id: 'gh-10-readme-typo-pr',
    suite: 'github',
    split: 'learn',
    title: 'Fix a README typo via a PR',
    destructive: false,
    prompt: ({ repo, fixtures }) =>
      `There is a spelling mistake in the "Monk fixture" section of README.md in ${repo.owner}/${repo.name}. Fix it on a new branch named \`${TYPO_FIX_BRANCH}\` and open a pull request into ${fixtures.defaultBranch}. Do not commit to ${fixtures.defaultBranch} directly.`,
    async check(ctx) {
      const gh = need(ctx);
      const pr = (await gh.listPulls('open')).find((p) => p.head === TYPO_FIX_BRANCH);
      if (!pr) return fail(`no open PR from ${TYPO_FIX_BRANCH}`);
      const head = readmeBlock((await gh.getFile('README.md', TYPO_FIX_BRANCH))?.content ?? null);
      const base = readmeBlock((await gh.getFile('README.md', ctx.fixtures.defaultBranch))?.content ?? null);
      if (base !== README_BLOCK_TYPO) return fail(`${ctx.fixtures.defaultBranch} README was changed directly`);
      if (!head?.includes(README_FIXED_SENTENCE) || /recieve/i.test(head)) return fail('typo not fixed on the PR branch');
      return ok(`PR #${pr.number} fixes the typo`);
    },
  },
];
