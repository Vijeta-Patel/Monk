import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { CheckResult, Split, Task, TaskContext } from '../types.ts';
import type { GitHubApi } from './api.ts';
import { CODE_BUGS, CODE_DIR, CODE_FILES, type CodeBug } from './code-fixture.ts';
import { FIXTURE_BRANCH_PREFIX } from './fixtures.ts';

const run = promisify(execFile);
const ok = (detail: string): CheckResult => ({ passed: true, detail });
const fail = (detail: string): CheckResult => ({ passed: false, detail });

/** Branch names under the fixture prefix, so the suite's reset closes the PR and deletes the branch. */
export const fixBranch = (bug: CodeBug) => `${FIXTURE_BRANCH_PREFIX}fix-${bug.key}`;

function need(ctx: TaskContext): GitHubApi {
  if (!ctx.gh) throw new Error('GitHub suite needs a GitHub client');
  return ctx.gh;
}

/** Runs the repo's own tests and the hidden regression check against the given files. */
export async function runPython(files: { path: string; content: string }[], hiddenCheck: string): Promise<CheckResult> {
  const dir = await mkdtemp(join(tmpdir(), 'monk-fix-'));
  try {
    for (const f of files) {
      await mkdir(dirname(join(dir, f.path)), { recursive: true });
      await writeFile(join(dir, f.path), f.content);
    }
    const cwd = join(dir, CODE_DIR);
    const opts = { cwd, timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } };
    try {
      await run('python3', ['-m', 'unittest', '-q'], opts);
    } catch (err) {
      return fail(`repo tests fail on the PR branch: ${String((err as { stderr?: string }).stderr ?? err).trim().split('\n').slice(-3).join(' | ')}`);
    }
    try {
      await run('python3', ['-c', hiddenCheck], opts);
    } catch (err) {
      return fail(`bug not fixed (hidden check): ${String((err as { stderr?: string }).stderr ?? err).trim().split('\n').at(-1)}`);
    }
    return ok('repo tests and hidden check pass');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const TEST_FILE = `${CODE_DIR}/tests/test_textkit.py`;

function fixTask(id: string, bug: CodeBug, split: Split): Task {
  return {
    id,
    suite: 'github',
    split,
    title: `Fix a real bug from its issue, tested in the sandbox, via a PR (${bug.key})`,
    destructive: false,
    prompt: ({ repo, fixtures }) =>
      `Fix issue #${fixtures.issues[bug.key]} in ${repo.owner}/${repo.name} and open a pull request with the fix. Use the branch name \`${fixBranch(bug)}\`.`,
    async check(ctx) {
      const gh = need(ctx);
      const branch = fixBranch(bug);
      const pr = (await gh.listPulls('open')).find((p) => p.head === branch);
      if (!pr) return fail(`no open PR from ${branch}`);
      const issue = ctx.fixtures.issues[bug.key];
      if (issue && !new RegExp(`#${issue}(?!\\d)`).test(`${pr.title}\n${pr.body}`)) return fail(`PR #${pr.number} doesn't reference issue #${issue}`);

      const def = ctx.fixtures.defaultBranch;
      const onMain = await gh.getFile(bug.file, def);
      if (onMain?.content !== CODE_FILES.find((f) => f.path === bug.file)?.content) return fail(`${def} was changed directly`);

      const files = await Promise.all(CODE_FILES.map(async (f) => ({ path: f.path, content: (await gh.getFile(f.path, branch))?.content ?? f.content })));
      const tests = files.find((f) => f.path === TEST_FILE)?.content ?? '';
      if (tests === CODE_FILES.find((f) => f.path === TEST_FILE)?.content) return fail('no regression test added');

      const result = await runPython(files, bug.check);
      return result.passed ? ok(`PR #${pr.number}: ${result.detail}, regression test added`) : result;
    },
  };
}

const bug = (key: string) => CODE_BUGS.find((b) => b.key === key)!;

export const githubFixTasks: Task[] = [
  fixTask('gh-11-fix-slug', bug('code-slug'), 'learn'),
  fixTask('gh-12-fix-duration', bug('code-duration'), 'learn'),
  fixTask('gh-13-fix-paginate', bug('code-page'), 'heldout'),
];
