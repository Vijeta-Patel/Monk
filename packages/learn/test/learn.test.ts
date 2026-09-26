import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PINNED_SKILLS, readEvents, schema, type MonkDb } from '@monk/shared';
import {
  buildEpisode, detectCandidates, detectSkillsUsed, findDuplicate, loadEpisode, parseSkillMd, recordSkillUses, renderSkillMd,
  retireSkills, runLearning, SkillsRepo, syncSkillsToTrueForge, textSimilarity, type DraftSkill, type Verifier,
} from '../src/index.ts';
import {
  call, done, fakeClient, fakeLlm, freshDb, git, makeCfg, PROCEDURE, QUIRK, RECOVERY, resp, seedS1Chaos, sessionS1, sessionS2, tmp, turnCreated,
} from './helpers.ts';

const improving: Verifier = async () => ({ baselinePass: 0.33, withSkillPass: 1, baselineSteps: 6, withSkillSteps: 3 });
const flat: Verifier = async () => ({ baselinePass: 0.5, withSkillPass: 0.5, baselineSteps: 4, withSkillSteps: 4 });

async function setup(opts: { agent?: boolean; url?: string } = {}) {
  const db = freshDb();
  await seedS1Chaos(db);
  const cfg = makeCfg(opts.url === undefined ? {} : opts.url ? { SKILLS_REPO_URL: opts.url } : {});
  const agent = opts.agent
    ? {
        id: 'agent_1',
        name: 'monk',
        description: 'Monk agent',
        manifest: {
          model: { name: 'litellm/gpt-4o-mini' },
          instructions: 'be calm',
          mcpServers: [{ name: 'monk-chaos', requireApprovalForTools: ['@destructive'] }],
          skills: [{ name: 'hand-made-skill', preload: true }, { name: 'old-monk-skill' }],
          config: { iterationLimit: 80 },
        },
      }
    : undefined;
  const fake = fakeClient({ s1: sessionS1(), s2: sessionS2() }, agent);
  return { db, cfg, ...fake };
}

async function skillRow(db: MonkDb, name: string) {
  const [row] = await db.select().from(schema.skills).where(eq(schema.skills.name, name));
  return row;
}

describe('episodes and candidates', () => {
  it('reads paged events oldest-first, joins chaos faults, redacts', async () => {
    const { db, cfg, client } = await setup();
    const ep = await loadEpisode({ db, client, cfg, tfSessionId: 's1' });
    expect(ep.task).toContain('stale bug issues');
    expect(ep.steps.map((s) => s.tool)).toEqual(['list_issues', 'exec', 'list_issues', 'search_issues', 'add_issue_comment']);
    expect(ep.steps[0]).toMatchObject({ status: 'fault', fault: 'rate_limit' });
    expect(ep.steps[3]).toMatchObject({ status: 'error', errorClass: 'http_422' });
    expect(ep.steps[0]!.args).not.toContain('ghp_');
    expect(ep.faults[0]).toMatchObject({ faultType: 'rate_limit', stepIndex: 0, recoverySteps: 2 });
    expect(ep.succeeded).toBe(true);
    expect(ep.mcpSessionIds).toEqual(['mcp1']);
  });

  it('finds recovery, procedure and tool-quirk candidates', async () => {
    const { db, cfg, client } = await setup();
    const eps = [await loadEpisode({ db, client, cfg, tfSessionId: 's1' }), await loadEpisode({ db, client, cfg, tfSessionId: 's2' })];
    const cands = await detectCandidates(eps, db);
    const keys = cands.map((c) => c.key).sort();
    expect(keys).toEqual(['procedure:s1', 'quirk:search_issues:http_422', 'recovery:rate_limit']);
    const rec = cands.find((c) => c.type === 'recovery')!;
    expect(rec.sources[0]).toMatchObject({ tfSessionId: 's1', seed: 7, profile: 'moderate' });
    expect(rec.evidence[0]).toContain('FAULT rate_limit');
    const quirk = cands.find((c) => c.type === 'tool_quirk')!;
    expect(quirk.sourceSessions.sort()).toEqual(['s1', 's2']);
  });

  it('counts DB history as a second tool-quirk sighting', async () => {
    const { db, cfg, client } = await setup();
    await db.insert(schema.toolCalls).values({ id: 'old', mcpSessionId: 'mcp_old', upstream: 'github', tool: 'search_issues', argsHash: 'h', startedAt: '2026-09-01T00:00:00Z', durationMs: 1, status: 'error' });
    const ep = await loadEpisode({ db, client, cfg, tfSessionId: 's2' });
    const cands = await detectCandidates([ep], db);
    expect(cands.map((c) => c.key)).toContain('quirk:search_issues:http_422');
  });

  it('honours succeeded overrides and skips failed tasks as procedures', async () => {
    const ep = buildEpisode({ tfSessionId: 's1', events: sessionS1(), succeeded: false });
    const cands = await detectCandidates([ep]);
    expect(cands.some((c) => c.type === 'procedure')).toBe(false);
    const errored = buildEpisode({ tfSessionId: 'x', events: [...sessionS1().slice(0, -1), done('', 'error')] });
    expect(errored.succeeded).toBe(false);
  });
});

describe('runLearning', () => {
  it('drafts, verifies, commits to git and records rows + events', async () => {
    const { db, cfg, client } = await setup();
    const llm = fakeLlm();
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1', 's2'], generation: 1, llm, verifier: improving });
    expect(report.counts).toMatchObject({ drafted: 3, merged: 0, verified_kept: 3, discarded: 0, committed: 3 });
    expect(report.precision).toBe(1);
    const md = readFileSync(join(cfg.SKILLS_REPO_PATH, 'github-rate-limit-recovery', 'SKILL.md'), 'utf8');
    const parsed = parseSkillMd(md);
    expect(parsed.meta).toMatchObject({ name: 'github-rate-limit-recovery', faultTypes: ['rate_limit'], sourceSessions: ['s1'], verified: true, version: 1, winRate: 1 });
    expect(parsed.body).toMatch(/^1\. Read retry_after/);
    const log = git(cfg.SKILLS_REPO_PATH, 'log', '--format=%s');
    expect(log).toContain('learn: add github-rate-limit-recovery (recovery; faults: rate_limit; tools: list_issues)');
    expect(log.split('\n')).toHaveLength(3);
    const row = await skillRow(db, 'github-rate-limit-recovery');
    expect(row?.status).toBe('active');
    expect(row?.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const kinds = (await readEvents(db)).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'skill.drafted')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'skill.verified')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'skill.committed')).toHaveLength(3);
    // No SKILLS_REPO_URL: nothing registered.
    expect(report.synced).toEqual([]);
  });

  it('drops invalid LLM output', async () => {
    const { db, cfg, client } = await setup();
    const llm = fakeLlm({
      recovery: { ...RECOVERY, name: 'Bad Name!' },
      procedure: { ...PROCEDURE, description: 'Triage stale issues.' },
      quirk: { name: 'x' },
    });
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1', 's2'], generation: 1, llm, verifier: improving });
    expect(report.counts.invalid).toBe(3);
    expect(report.counts.drafted).toBe(0);
    expect(await db.select().from(schema.skills)).toHaveLength(0);
    expect(existsSync(join(cfg.SKILLS_REPO_PATH, '.git'))).toBe(false);
  });

  it('merges a near-duplicate into the existing skill and bumps its version', async () => {
    const { db, cfg, client } = await setup();
    await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    const llm = fakeLlm({
      recovery: { ...RECOVERY, name: 'rate-limit-backoff', description: 'Use when GitHub says rate limit exceeded (429).', steps: ['Wait for retry_after seconds before retrying.', 'Prefer one search call over many list calls.'] },
    });
    const ep = buildEpisode({ tfSessionId: 's9', events: sessionS1() });
    ep.faults = [{ id: 'f9', tool: 'list_issues', faultType: 'rate_limit', outcome: 'recovered', recoverySteps: 3, seed: 7, profile: 'moderate', stepIndex: 0 }];
    ep.succeeded = false;
    const report = await runLearning({ db, client, cfg, tfSessionIds: [], episodes: [ep], generation: 2, llm, verifier: improving });
    // The quirk (DB history) merges by name into search-issues-needs-repo too.
    expect(report.counts).toMatchObject({ drafted: 2, merged: 2, committed: 2 });
    expect((await skillRow(db, 'search-issues-needs-repo'))?.version).toBe(2);
    expect(existsSync(join(cfg.SKILLS_REPO_PATH, 'rate-limit-backoff'))).toBe(false);
    const row = await skillRow(db, 'github-rate-limit-recovery');
    expect(row?.version).toBe(2);
    expect(row?.sourceSessions).toEqual(['s1', 's9']);
    // Deterministic union fallback (the fake LLM refuses merges).
    expect(row?.body).toContain('Read retry_after');
    expect(row?.body).toContain('Wait for retry_after seconds');
    const md = parseSkillMd(readFileSync(join(cfg.SKILLS_REPO_PATH, 'github-rate-limit-recovery', 'SKILL.md'), 'utf8'));
    expect(md.meta.version).toBe(2);
    expect(git(cfg.SKILLS_REPO_PATH, 'log', '--format=%s')).toContain('learn: update github-rate-limit-recovery to v2');
  });

  it('uses the LLM merge when it returns valid output', async () => {
    const { db, cfg, client } = await setup();
    await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    const llm = fakeLlm({ merge: { description: 'Use when a GitHub tool is rate limited (429).', steps: ['Merged step one here.', 'Merged step two here.'] } });
    const ep = buildEpisode({ tfSessionId: 's9', events: sessionS1(), succeeded: false });
    ep.faults = [{ id: 'f9', tool: 'list_issues', faultType: 'rate_limit', outcome: 'recovered', recoverySteps: 3, seed: 7, profile: 'moderate', stepIndex: 0 }];
    await runLearning({ db, client, cfg, tfSessionIds: [], episodes: [ep], generation: 2, llm, verifier: improving });
    const row = await skillRow(db, 'github-rate-limit-recovery');
    expect(row?.body).toBe('1. Merged step one here.\n2. Merged step two here.');
    expect(row?.description).toBe('Use when a GitHub tool is rate limited (429).');
  });

  it('keeps only drafts the verifier says help; discarded drafts never reach git', async () => {
    const { db, cfg, client } = await setup();
    const verifier: Verifier = async (d: DraftSkill) => (d.type === 'recovery' ? improving(d) : flat(d));
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1', 's2'], generation: 1, llm: fakeLlm(), verifier });
    expect(report.counts).toMatchObject({ drafted: 3, verified_kept: 1, discarded: 2, committed: 1 });
    expect(report.precision).toBeCloseTo(1 / 3);
    expect((await skillRow(db, 'triage-stale-bug-issues'))?.status).toBe('discarded');
    expect(git(cfg.SKILLS_REPO_PATH, 'ls-files')).toBe('github-rate-limit-recovery/SKILL.md');
    const discarded = (await readEvents(db)).filter((e) => e.kind === 'skill.discarded');
    expect(discarded).toHaveLength(2);
  });

  it('steps dropping without losing passes counts as a gain', async () => {
    const { db, cfg, client } = await setup();
    const verifier: Verifier = async () => ({ baselinePass: 1, withSkillPass: 1, baselineSteps: 8, withSkillSteps: 5 });
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier });
    expect(report.counts.verified_kept).toBe(3);
  });

  it('discards everything without a verifier, keeps everything with no_verify', async () => {
    const a = await setup();
    const r1 = await runLearning({ db: a.db, client: a.client, cfg: a.cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm() });
    expect(r1.counts).toMatchObject({ drafted: 3, verified_kept: 0, discarded: 3, committed: 0 });
    expect(r1.skills.every((s) => s.reason.includes('no verifier'))).toBe(true);

    const b = await setup();
    const r2 = await runLearning({ db: b.db, client: b.client, cfg: b.cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), variant: 'no_verify' });
    expect(r2.counts).toMatchObject({ drafted: 3, verified_kept: 3, committed: 3 });
    const md = parseSkillMd(readFileSync(join(b.cfg.SKILLS_REPO_PATH, 'github-rate-limit-recovery', 'SKILL.md'), 'utf8'));
    expect(md.meta.verified).toBe(false);
    expect(md.meta.winRate).toBeNull();
  });

  it('random variant shuffles bodies across fault types', async () => {
    const { db, cfg, client } = await setup();
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1', 's2'], generation: 1, llm: fakeLlm(), variant: 'random', verifier: improving });
    expect(report.counts.committed).toBe(3);
    const rec = await skillRow(db, 'github-rate-limit-recovery');
    expect(rec?.description).toBe(RECOVERY.description);
    expect(rec?.body).not.toContain('retry_after');
    const bodies = [RECOVERY, PROCEDURE, QUIRK].map((s) => s.steps[0]!);
    expect(bodies.some((b) => rec?.body.includes(b))).toBe(true);
  });

  it('no_retire leaves losing skills active; full retires them', async () => {
    for (const variant of ['no_retire', 'full'] as const) {
      const { db, cfg, client } = await setup();
      await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
      for (let i = 0; i < 10; i++) await recordSkillUses({ db, tfSessionId: `u${i}`, skills: ['github-rate-limit-recovery'], succeeded: i < 3 });
      const report = await runLearning({ db, client, cfg, tfSessionIds: [], generation: 2, llm: fakeLlm(), verifier: improving, variant });
      const row = await skillRow(db, 'github-rate-limit-recovery');
      if (variant === 'no_retire') {
        expect(row?.status).toBe('active');
        expect(report.retired).toEqual([]);
      } else {
        expect(row?.status).toBe('retired');
        expect(report.counts.retired).toBe(1);
      }
    }
  });

  it('records usage of skills loaded in the learned sessions', async () => {
    const { db, cfg, client } = await setup();
    await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    const events = [turnCreated('x'), call('k1', 'exec', { cmd: 'cat /opt/tfy/skills/github-rate-limit-recovery/SKILL.md' }, null), resp('k1', '...'), done()];
    const fake = fakeClient({ s5: events });
    await runLearning({ db, client: fake.client, cfg, tfSessionIds: ['s5'], generation: 2, llm: fakeLlm(), verifier: improving });
    await runLearning({ db, client: fake.client, cfg, tfSessionIds: ['s5'], generation: 3, llm: fakeLlm(), verifier: improving });
    const uses = await db.select().from(schema.skillUses);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ skillName: 'github-rate-limit-recovery', tfSessionId: 's5', succeeded: true });
  });

  it('pushes when a remote exists', async () => {
    const { db, cfg, client } = await setup();
    const bare = tmp('monk-learn-bare-');
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    const repo = new SkillsRepo(cfg.SKILLS_REPO_PATH, 'main');
    await repo.ensure();
    git(cfg.SKILLS_REPO_PATH, 'remote', 'add', 'origin', bare);
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    expect(report.pushed).toBe(true);
    expect(git(bare, 'log', '--format=%s', 'main')).toContain('learn: add github-rate-limit-recovery');
  });
});

describe('TrueForge sync', () => {
  it('registers active skills as git skills and replaces Monk skills on the agent, keeping the rest', async () => {
    const { db, cfg, client, createOrUpdate, update } = await setup({ agent: true, url: 'https://github.com/acme/monk-skills' });
    await db.insert(schema.skills).values({ name: 'old-monk-skill', type: 'recovery', description: 'Use when old.', body: '1. x', status: 'retired' });
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    // s1 alone still yields the quirk: s2's earlier 422 is in the DB history.
    expect(report.synced.sort()).toEqual(['github-rate-limit-recovery', 'search-issues-needs-repo', 'triage-stale-bug-issues']);
    expect(createOrUpdate).toHaveBeenCalledWith({
      manifest: { type: 'git', name: 'github-rate-limit-recovery', description: RECOVERY.description, url: 'https://github.com/acme/monk-skills', ref: 'main', path: 'github-rate-limit-recovery' },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, req] = update.mock.calls[0]! as [string, { description: string; manifest: Record<string, unknown> & { skills: { name: string }[] } }];
    expect(id).toBe('agent_1');
    expect(req.description).toBe('Monk agent');
    expect(req.manifest.instructions).toBe('be calm');
    expect(req.manifest.mcpServers).toEqual([{ name: 'monk-chaos', requireApprovalForTools: ['@destructive'] }]);
    expect(req.manifest.config).toEqual({ iterationLimit: 80 });
    const names = req.manifest.skills.map((s) => s.name);
    expect(req.manifest.skills.slice(0, 2)).toEqual([{ name: 'machine-workspace' }, { name: 'hand-made-skill', preload: true }]);
    expect(names).not.toContain('old-monk-skill');
    expect(names).toContain('github-rate-limit-recovery');
  });

  it('caps the agent at 50 skills, best win rate first', async () => {
    const { db, cfg, client, update } = await setup({ agent: true, url: 'https://github.com/acme/monk-skills' });
    for (let i = 0; i < 55; i++) {
      await db.insert(schema.skills).values({ name: `skill-${String(i).padStart(2, '0')}`, type: 'procedure', description: 'Use when x.', body: '1. x', status: 'active', verification: { withSkillPass: i / 100 } });
    }
    const names = await syncSkillsToTrueForge({ db, client, cfg });
    expect(names).toHaveLength(47); // one slot for the pinned skill, two for the skills Monk doesn't manage
    expect(names[0]).toBe('skill-54');
    const req = update.mock.calls[0]![1] as { manifest: { skills: unknown[] } };
    expect(req.manifest.skills).toHaveLength(50);
  });
});

describe('pinned skills', () => {
  const pinned = { name: 'machine-workspace', description: PINNED_SKILLS[0]!.description };

  it('are registered and put first on every sync, even with no learned skills', async () => {
    const { db, cfg, client, createOrUpdate, update } = await setup({ agent: true, url: 'https://github.com/acme/monk-skills' });
    // A stray row with the pinned name must not turn it into a learned skill.
    await db.insert(schema.skills).values({ name: 'machine-workspace', type: 'procedure', description: 'Use when learned.', body: '1. x', status: 'active' });
    expect(await syncSkillsToTrueForge({ db, client, cfg })).toEqual([]);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    expect(createOrUpdate).toHaveBeenCalledWith({
      manifest: { type: 'git', ...pinned, url: 'https://github.com/acme/monk-skills', ref: 'main', path: 'machine-workspace' },
    });
    const req = update.mock.calls[0]![1] as { manifest: { skills: { name: string }[] } };
    expect(req.manifest.skills.map((s) => s.name)).toEqual(['machine-workspace', 'hand-made-skill', 'old-monk-skill']);
  });

  it('never become learned skills: a draft with the name is invalid and git refuses to write or remove it', async () => {
    const { db, cfg, client } = await setup();
    const llm = fakeLlm({ recovery: { ...RECOVERY, name: 'machine-workspace' } });
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm, verifier: improving });
    expect(report.skills.find((s) => s.action === 'invalid')?.reason).toBe('name machine-workspace belongs to a pinned skill');
    expect(await skillRow(db, 'machine-workspace')).toBeUndefined();
    expect(llm.mock.calls[0]![0].user).toContain('machine-workspace');
    const repo = new SkillsRepo(cfg.SKILLS_REPO_PATH, 'main');
    await expect(repo.commitSkill('machine-workspace', '---\nname: machine-workspace\n---\n1. x\n', 'learn: add machine-workspace')).rejects.toThrow(/pinned/);
    await expect(repo.removeSkill('machine-workspace', 'learn: retire machine-workspace')).rejects.toThrow(/pinned/);
    expect(existsSync(join(cfg.SKILLS_REPO_PATH, 'machine-workspace'))).toBe(false);
  });

  it('are never a merge target, even when a stray row carries the name', async () => {
    const { db, cfg, client } = await setup();
    await db.insert(schema.skills).values({
      name: 'machine-workspace', type: 'recovery', description: RECOVERY.description, body: RECOVERY.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      faultTypes: ['rate_limit'], tools: ['list_issues'], status: 'active',
    });
    const report = await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    expect(report.skills.some((s) => s.mergedInto === 'machine-workspace' || s.name === 'machine-workspace')).toBe(false);
    expect((await skillRow(db, 'github-rate-limit-recovery'))?.status).toBe('active');
    expect(existsSync(join(cfg.SKILLS_REPO_PATH, 'machine-workspace'))).toBe(false);
  });

  it('are never retired, whatever their win rate', async () => {
    const db = freshDb();
    const cfg = makeCfg();
    await db.insert(schema.skills).values({ name: 'machine-workspace', type: 'procedure', description: 'Use when x.', body: '1. x', status: 'active' });
    for (let i = 0; i < 10; i++) await recordSkillUses({ db, tfSessionId: `p${i}`, skills: ['machine-workspace'], succeeded: false });
    expect(await retireSkills({ db, cfg })).toEqual([]);
    expect((await skillRow(db, 'machine-workspace'))?.status).toBe('active');
  });
});

describe('usage and retirement', () => {
  it('detects skills loaded via mount path or SKILL.md', () => {
    const events = [
      call('a', 'exec', { cmd: 'cat /opt/tfy/skills/github-rate-limit-recovery/SKILL.md' }, null),
      call('b', 'read_file', { path: 'search-issues-needs-repo/SKILL.md' }, null),
      call('c', 'exec', { cmd: 'ls /opt/tfy/skills/' }, null),
      { event: call('d', 'exec', { cmd: 'cat /opt/tfy/skills/other-skill/SKILL.md' }, null), turnId: 't' },
    ];
    expect(detectSkillsUsed(events).sort()).toEqual(['github-rate-limit-recovery', 'other-skill', 'search-issues-needs-repo']);
    expect(detectSkillsUsed(events, ['other-skill'])).toEqual(['other-skill']);
  });

  it('retires below 50% over the last 10 uses, not before 10 uses', async () => {
    const db = freshDb();
    const cfg = makeCfg();
    const repo = new SkillsRepo(cfg.SKILLS_REPO_PATH, 'main');
    for (const name of ['bad-skill', 'ok-skill', 'young-skill']) {
      const sha = await repo.commitSkill(name, renderSkillMd({ name, description: 'Use when x.', sourceSessions: [], faultTypes: [], verified: true, winRate: null, version: 1 }, '1. x'), `learn: add ${name}`);
      await db.insert(schema.skills).values({ name, type: 'recovery', description: 'Use when x.', body: '1. x', status: 'active', commitSha: sha });
    }
    // Old wins outside the window must not save bad-skill.
    for (let i = 0; i < 5; i++) await recordSkillUses({ db, tfSessionId: `old${i}`, skills: ['bad-skill'], succeeded: true });
    for (let i = 0; i < 10; i++) {
      await recordSkillUses({ db, tfSessionId: `s${i}`, skills: ['bad-skill'], succeeded: i < 4 });
      await recordSkillUses({ db, tfSessionId: `s${i}`, skills: ['ok-skill'], succeeded: i < 5 });
    }
    for (let i = 0; i < 9; i++) await recordSkillUses({ db, tfSessionId: `y${i}`, skills: ['young-skill'], succeeded: false });
    const retired = await retireSkills({ db, cfg });
    expect(retired).toEqual(['bad-skill']);
    expect((await skillRow(db, 'bad-skill'))?.status).toBe('retired');
    expect((await skillRow(db, 'ok-skill'))?.status).toBe('active');
    expect(existsSync(join(cfg.SKILLS_REPO_PATH, 'bad-skill'))).toBe(false);
    expect(git(cfg.SKILLS_REPO_PATH, 'log', '-1', '--format=%s')).toBe('learn: retire bad-skill (win rate 40% over last 10 uses)');
    const ev = (await readEvents(db)).find((e) => e.kind === 'skill.retired');
    expect(ev?.data).toEqual({ name: 'bad-skill', winRate: 0.4 });
  });

  it('re-syncs the agent after retiring when given a client', async () => {
    const { db, cfg, client, update } = await setup({ agent: true, url: 'https://github.com/acme/monk-skills' });
    await runLearning({ db, client, cfg, tfSessionIds: ['s1'], generation: 1, llm: fakeLlm(), verifier: improving });
    for (let i = 0; i < 10; i++) await recordSkillUses({ db, tfSessionId: `u${i}`, skills: ['triage-stale-bug-issues'], succeeded: false });
    update.mockClear();
    expect(await retireSkills({ db, cfg, client })).toEqual(['triage-stale-bug-issues']);
    const req = update.mock.calls[0]![1] as { manifest: { skills: { name: string }[] } };
    expect(req.manifest.skills.map((s) => s.name)).toEqual(['machine-workspace', 'hand-made-skill', 'old-monk-skill', 'github-rate-limit-recovery', 'search-issues-needs-repo']);
  });
});

describe('format and similarity', () => {
  it('renders SKILL.md in the PRD format', () => {
    const md = renderSkillMd(
      { name: 'github-rate-limit-recovery', description: 'Use when a GitHub tool returns 429 or "rate limit exceeded".', sourceSessions: ['s_812', 's_847'], faultTypes: ['rate_limit'], verified: true, winRate: 0.9, version: 2 },
      '1. Read retry_after from the error; if missing, wait 20s.\n2. Do not retry more than 3 times.',
    );
    expect(md).toBe(`---
name: github-rate-limit-recovery
description: Use when a GitHub tool returns 429 or "rate limit exceeded".
monk:
  source_sessions: [s_812, s_847]
  fault_types: [rate_limit]
  verified: true
  win_rate: 0.9
  version: 2
---
1. Read retry_after from the error; if missing, wait 20s.
2. Do not retry more than 3 times.
`);
    expect(parseSkillMd(md).meta.sourceSessions).toEqual(['s_812', 's_847']);
    const tricky = renderSkillMd({ name: 'a-b', description: 'Use when: colons # and quotes', sourceSessions: [], faultTypes: [], verified: false, winRate: null, version: 1 }, '1. x');
    expect(parseSkillMd(tricky).meta.description).toBe('Use when: colons # and quotes');
  });

  it('scores near-duplicates above unrelated skills', () => {
    const base = { type: 'recovery' as const, steps: [], sourceSessions: [], version: 1 };
    const a = { ...base, name: 'github-rate-limit-recovery', description: 'Use when a GitHub tool returns 429 or rate limit exceeded.', faultTypes: ['rate_limit'], tools: ['list_issues'] };
    const b = { ...base, name: 'rate-limit-backoff', description: 'Use when GitHub says rate limit exceeded (429).', faultTypes: ['rate_limit'], tools: ['search_issues'] };
    const c = { ...base, name: 'timeout-retry', description: 'Use when a tool call times out.', faultTypes: ['timeout'], tools: ['list_issues'] };
    expect(textSimilarity(a.description, b.description)).toBeGreaterThan(textSimilarity(a.description, c.description));
    expect(findDuplicate(b, [a, c])?.name).toBe('github-rate-limit-recovery');
    expect(findDuplicate(c, [a, b])).toBeNull();
  });
});

describe('proxyLearnLlm', () => {
  it('posts a strict json_schema request to the LLM proxy and parses the reply', async () => {
    const { proxyLearnLlm, DRAFT_JSON_SCHEMA } = await import('../src/index.ts');
    const cfg = makeCfg({ MODEL: 'gpt-4o-mini', LLM_BASE_URL: 'https://llm.test/v1/', LLM_API_KEY: 'sk-test-key-1234567890' });
    let seen: { url: string; body: Record<string, unknown>; auth: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') ?? '' };
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await proxyLearnLlm(cfg, fetchImpl)({ system: 's', user: 'u', schema: DRAFT_JSON_SCHEMA });
    expect(out).toEqual({ ok: true });
    expect(seen?.url).toBe('https://llm.test/v1/chat/completions');
    expect(seen?.auth).toBe('Bearer sk-test-key-1234567890');
    expect(seen?.body).toMatchObject({ model: 'gpt-4o-mini', response_format: { type: 'json_schema', json_schema: { strict: true, schema: DRAFT_JSON_SCHEMA } } });
  });

  it('falls back to json_object when the model rejects json_schema', async () => {
    const { proxyLearnLlm, DRAFT_JSON_SCHEMA } = await import('../src/index.ts');
    const cfg = makeCfg({ MODEL: 'm', LLM_BASE_URL: 'https://llm.test/v1' });
    const formats: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { response_format: { type: string } };
      formats.push(body.response_format.type);
      if (body.response_format.type === 'json_schema') return new Response('response_format not supported', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await proxyLearnLlm(cfg, fetchImpl)({ system: 's', user: 'u', schema: DRAFT_JSON_SCHEMA })).toEqual({ ok: 1 });
    expect(formats).toEqual(['json_schema', 'json_object']);
  });
});
