import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { MONK_AGENT_NAME, ensureGitSkill, isPinnedSkill, schema, type MonkConfig, type MonkDb, type TrueForge, eq } from '@monk/shared';
import { renderSkillMd, syncSkillsToTrueForge, type DraftSkill, type Verifier } from '@monk/learn';
import type { Verifier as EvalVerifier } from '@monk/evals';

const execFileP = promisify(execFile);
const VERIFY_BRANCH = 'monk-verify';

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', dir, ...args], { timeout: 60_000 });
  return stdout.trim();
}

/** Replaces the agent's learned skills[] (keeping pinned skills and the rest of its manifest). */
export async function setAgentSkills(client: TrueForge, names: string[], agentName = MONK_AGENT_NAME): Promise<void> {
  for await (const agent of await client.agents.list({ agentName })) {
    if (agent.name !== agentName) continue;
    const { data } = await client.agents.get(agent.id);
    const pinned = (data.manifest.skills ?? []).filter((s) => isPinnedSkill(s.name));
    const learned = names.filter((n) => !isPinnedSkill(n)).slice(0, 50 - pinned.length);
    const manifest = { ...data.manifest, skills: [...pinned, ...learned.map((name) => ({ name }))] };
    await client.agents.update(agent.id, { manifest });
    return;
  }
  throw new Error(`agent ${agentName} not found; run monk setup`);
}

async function activeSkillNames(db: MonkDb): Promise<string[]> {
  const rows = await db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
  return rows.map((r) => r.name);
}

/**
 * TrueForge only loads skills from git, so a draft under verification is pushed to a scratch
 * branch of the skills repo and registered at that ref while its arm runs.
 */
export function createSkillToggles(deps: { db: MonkDb; client: TrueForge; cfg: MonkConfig }) {
  const drafts = new Map<string, DraftSkill>();
  const verifyDir = join(deps.cfg.rootDir, 'data', 'skills-verify');

  async function publishDraft(d: DraftSkill): Promise<void> {
    const { cfg } = deps;
    if (!cfg.SKILLS_REPO_URL) throw new Error('SKILLS_REPO_URL is required to verify skills (TrueForge loads skills from git)');
    if (!existsSync(join(verifyDir, '.git'))) {
      await mkdir(verifyDir, { recursive: true });
      await execFileP('git', ['clone', '--quiet', cfg.SKILLS_REPO_URL, verifyDir], { timeout: 120_000 });
    }
    await git(verifyDir, ['fetch', '--quiet', 'origin']);
    const remoteBranches = await git(verifyDir, ['branch', '-r']);
    const base = remoteBranches.includes(`origin/${VERIFY_BRANCH}`) ? `origin/${VERIFY_BRANCH}` : `origin/${cfg.SKILLS_REPO_REF}`;
    await git(verifyDir, ['checkout', '--quiet', '-B', VERIFY_BRANCH, base]);
    const md = renderSkillMd(
      { name: d.name, description: d.description, sourceSessions: d.sourceSessions, faultTypes: d.faultTypes, verified: false, winRate: null, version: d.version },
      d.body,
    );
    await mkdir(join(verifyDir, d.name), { recursive: true });
    await writeFile(join(verifyDir, d.name, 'SKILL.md'), md);
    await git(verifyDir, ['add', d.name]);
    const dirty = await git(verifyDir, ['status', '--porcelain']);
    if (dirty) {
      await git(verifyDir, ['-c', 'user.name=monk', '-c', 'user.email=monk@localhost', 'commit', '--quiet', '-m', `verify: ${d.name} v${d.version}`]);
      await git(verifyDir, ['push', '--quiet', 'origin', VERIFY_BRANCH]);
    }
    await ensureGitSkill(deps.client, { name: d.name, description: d.description, url: cfg.SKILLS_REPO_URL, ref: VERIFY_BRANCH, path: d.name });
  }

  const withSkills = async <T>(names: string[], fn: () => Promise<T>): Promise<T> => {
    for (const n of names) {
      const d = drafts.get(n);
      if (d) await publishDraft(d);
    }
    const base = (await activeSkillNames(deps.db)).filter((n) => !names.includes(n));
    await setAgentSkills(deps.client, [...names, ...base]);
    try {
      return await fn();
    } finally {
      await syncSkillsToTrueForge(deps);
    }
  };

  /** Wraps evals' verifier so withSkills can find the draft body by name. */
  const wrapVerifier = (inner: EvalVerifier): Verifier => async (draft) => {
    drafts.set(draft.name, draft);
    try {
      return await inner(draft);
    } finally {
      drafts.delete(draft.name);
    }
  };

  /** Benchmark generation 0 starts with no learned skills (pinned ones stay); learned skills stay in git history. */
  const resetSkills = async (): Promise<void> => {
    await deps.db.update(schema.skills).set({ status: 'retired' }).where(eq(schema.skills.status, 'active'));
    await setAgentSkills(deps.client, []);
  };

  return { withSkills, wrapVerifier, resetSkills };
}
