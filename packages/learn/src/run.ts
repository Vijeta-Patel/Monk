import { and, gte, inArray, isNotNull, max, sql } from 'drizzle-orm';
import { isPinnedSkill, PINNED_SKILLS, publish, schema, type MonkConfig, type MonkDb, type TrueForge } from '@monk/shared';
import { detectCandidates } from './candidates.ts';
import { findDuplicate, mergeSkill, type SkillLike } from './dedupe.ts';
import { loadEpisode } from './episode.ts';
import { SkillsRepo } from './git.ts';
import { extractDraft, proxyLearnLlm, renderBody, stepsFromBody } from './llm.ts';
import { renderSkillMd } from './skillmd.ts';
import { syncSkillsToTrueForge } from './sync.ts';
import type { DraftSkill, Episode, LearningReport, Llm, SkillOutcome, VerificationResult, Verifier, Variant } from './types.ts';
import { recordSkillUses, retireSkills, winStats } from './usage.ts';

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** Keep iff the pass rate improves, or steps drop without losing passes. */
export function shouldKeep(v: VerificationResult): boolean {
  if (v.withSkillPass > v.baselinePass) return true;
  return v.withSkillPass >= v.baselinePass && v.withSkillSteps < v.baselineSteps;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ablation "random skill": every kept draft gets a body taken from a skill for a different fault
 * type (other drafts first, then existing skills), so prompts grow but content no longer matches.
 */
export function shuffleBodies(drafts: DraftSkill[], others: { body: string; faultTypes: string[] }[], seed: number): void {
  const rand = mulberry32(seed);
  const pool = [...drafts.map((d) => ({ body: d.body, faultTypes: d.faultTypes })), ...others];
  if (pool.length < 2) return;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const used = new Set<number>();
  for (const d of drafts) {
    let pick = pool.findIndex((p, idx) => !used.has(idx) && p.body !== d.body && !p.faultTypes.some((f) => d.faultTypes.includes(f)));
    if (pick < 0) pick = pool.findIndex((p, idx) => !used.has(idx) && p.body !== d.body);
    if (pick < 0) pick = pool.findIndex((p) => p.body !== d.body);
    if (pick < 0) continue;
    used.add(pick);
    d.body = pool[pick]!.body;
    d.steps = stepsFromBody(d.body);
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function commitMessage(d: DraftSkill, v: VerificationResult | null, variant: Variant): string {
  const head = d.version > 1 ? `learn: update ${d.name} to v${d.version}` : `learn: add ${d.name}`;
  const what = [d.type.replace('_', '-'), d.faultTypes.length ? `faults: ${d.faultTypes.join(', ')}` : '', d.tools.length ? `tools: ${d.tools.slice(0, 5).join(', ')}` : '']
    .filter(Boolean)
    .join('; ');
  const lines = [`${head} (${what})`, '', d.description, '', `source sessions: ${d.sourceSessions.join(', ')}`];
  if (v) lines.push(`verification: pass ${pct(v.baselinePass)} -> ${pct(v.withSkillPass)}, steps ${v.baselineSteps.toFixed(1)} -> ${v.withSkillSteps.toFixed(1)}`);
  if (variant !== 'full') lines.push(`variant: ${variant}`);
  return lines.join('\n');
}

type Pending = { draft: DraftSkill; existing: boolean; outcome: SkillOutcome };

export type RunLearningOpts = {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  tfSessionIds: string[];
  generation: number;
  variant?: Variant;
  verifier?: Verifier;
  llm?: Llm;
  /** Per-session success from evals; defaults to "last turn finished without error". */
  succeeded?: Record<string, boolean>;
  /** Log skill loads found in these sessions to skill_uses (idempotent). Default true. */
  recordUses?: boolean;
  /** Pre-built episodes (tests, or callers that already fetched the logs). */
  episodes?: Episode[];
  /** Fault types held back from learning (benchmark stress test for unseen faults). */
  excludeFaultTypes?: string[];
};

export async function runLearning(opts: RunLearningOpts): Promise<LearningReport> {
  const { db, cfg } = opts;
  const variant: Variant = opts.variant ?? 'full';
  const llm = opts.llm ?? proxyLearnLlm(cfg);
  const report: LearningReport = {
    generation: opts.generation,
    variant,
    sessions: 0,
    counts: { drafted: 0, merged: 0, verified_kept: 0, discarded: 0, committed: 0, retired: 0, invalid: 0 },
    skills: [],
    precision: null,
    retired: [],
    synced: [],
    pushed: false,
    errors: [],
  };

  // 1. Episodes.
  const episodes: Episode[] = [...(opts.episodes ?? [])];
  for (const sid of opts.tfSessionIds) {
    if (episodes.some((e) => e.tfSessionId === sid)) continue;
    try {
      episodes.push(await loadEpisode({ db, client: opts.client, cfg, tfSessionId: sid, ...(opts.succeeded?.[sid] !== undefined ? { succeeded: opts.succeeded[sid] } : {}) }));
    } catch (err) {
      report.errors.push(`episode ${sid}: ${(err as Error).message}`);
    }
  }
  for (const ep of episodes) if (opts.succeeded?.[ep.tfSessionId] !== undefined) ep.succeeded = opts.succeeded[ep.tfSessionId]!;
  report.sessions = episodes.length;

  const allRows = await db.select().from(schema.skills);
  const known = allRows.map((r) => r.name);

  // 2. Usage from these sessions feeds retirement.
  if (opts.recordUses !== false) {
    for (const ep of episodes) {
      const used = ep.skillsUsed.filter((n) => known.includes(n));
      if (used.length) await recordSkillUses({ db, tfSessionId: ep.tfSessionId, skills: used, succeeded: ep.succeeded });
    }
  }

  // 3-4. Candidates -> drafts -> dedupe/merge.
  const excluded = new Set(opts.excludeFaultTypes ?? []);
  const candidates = (await detectCandidates(episodes, db)).filter((c) => !c.faultTypes.some((f) => excluded.has(f)));
  // Pinned skills are never merge targets, even if a stray row carries the name.
  const active: SkillLike[] = allRows
    .filter((r) => r.status === 'active' && !isPinnedSkill(r.name))
    .map((r) => ({ name: r.name, type: r.type, description: r.description, steps: stepsFromBody(r.body), faultTypes: r.faultTypes, tools: r.tools, sourceSessions: r.sourceSessions, version: r.version }));
  const pending: Pending[] = [];

  for (const c of candidates) {
    const takenNames = [...known, ...PINNED_SKILLS.map((p) => p.name), ...pending.map((p) => p.draft.name)];
    const extracted = await extractDraft({ llm, candidate: c, existingNames: takenNames, generation: opts.generation, cfg });
    // A draft may never take a pinned skill's name: committing it would overwrite the hand-written skill.
    const draft = extracted.draft && !isPinnedSkill(extracted.draft.name) ? extracted.draft : null;
    if (!draft) {
      const reason = extracted.draft ? `name ${extracted.draft.name} belongs to a pinned skill` : extracted.reason;
      report.counts.invalid++;
      report.skills.push({ name: c.key, type: c.type, action: 'invalid', kept: false, reason, version: 0, commitSha: null });
      continue;
    }
    report.counts.drafted++;
    await publish(db, { kind: 'skill.drafted', data: { name: draft.name, type: draft.type, sourceSessions: draft.sourceSessions } });

    const pool: SkillLike[] = [...pending.map((p) => p.draft), ...active.filter((a) => !pending.some((p) => p.draft.name === a.name))];
    const dup = findDuplicate(draft, pool);
    if (dup) {
      report.counts.merged++;
      const inRun = pending.find((p) => p.draft.name === dup.name);
      if (inRun) {
        // Version was already bumped once this run (or it is a new skill); merging again doesn't bump.
        inRun.draft = await mergeSkill(inRun.draft, draft, { llm, bumpVersion: false, cfg });
        if (!inRun.existing) delete inRun.draft.mergedInto;
        inRun.outcome.reason = `${inRun.outcome.reason}; merged ${draft.name}`;
        continue;
      }
      const merged = await mergeSkill(dup, draft, { llm, bumpVersion: true, cfg });
      pending.push({ draft: merged, existing: true, outcome: { name: merged.name, type: merged.type, action: 'merged', kept: false, reason: `merged ${draft.name}`, version: merged.version, commitSha: null, mergedInto: dup.name } });
      continue;
    }
    const prior = allRows.find((r) => r.name === draft.name);
    if (prior) draft.version = prior.version + 1;
    pending.push({ draft, existing: false, outcome: { name: draft.name, type: draft.type, action: 'created', kept: false, reason: 'new', version: draft.version, commitSha: null } });
  }

  // 5. Verify.
  const kept: Pending[] = [];
  for (const p of pending) {
    let v: VerificationResult | null = null;
    let keep: boolean;
    let why: string;
    if (variant === 'no_verify') {
      keep = true;
      why = 'verification skipped (no_verify)';
    } else if (!opts.verifier) {
      keep = false;
      why = 'no verifier';
    } else {
      try {
        v = await opts.verifier(p.draft);
        keep = shouldKeep(v);
        why = keep ? 'verified: improves pass rate or steps' : `no gain: pass ${pct(v.baselinePass)} -> ${pct(v.withSkillPass)}, steps ${v.baselineSteps} -> ${v.withSkillSteps}`;
        await publish(db, {
          kind: 'skill.verified',
          data: { name: p.draft.name, kept: keep, baselinePass: v.baselinePass, withSkillPass: v.withSkillPass, baselineSteps: v.baselineSteps, withSkillSteps: v.withSkillSteps },
        });
      } catch (err) {
        keep = false;
        why = `verifier error: ${(err as Error).message}`;
      }
    }
    p.outcome.verification = v;
    p.outcome.kept = keep;
    p.outcome.reason = `${p.outcome.reason}; ${why}`;
    report.skills.push(p.outcome);
    if (keep) {
      report.counts.verified_kept++;
      kept.push(p);
      continue;
    }
    report.counts.discarded++;
    p.outcome.action = 'discarded';
    await publish(db, { kind: 'skill.discarded', data: { name: p.draft.name, reason: p.existing ? `merge into ${p.draft.name} rejected: ${why}` : why } });
    // A rejected merge leaves the existing skill untouched; a rejected new draft is recorded, never written to git.
    if (!p.existing) {
      const d = p.draft;
      const row = {
        type: d.type, description: d.description, body: d.body, faultTypes: d.faultTypes, tools: d.tools, sourceSessions: d.sourceSessions,
        version: d.version, verified: false, status: 'discarded' as const, generation: d.generation, verification: v, updatedAt: nowSql,
      };
      await db.insert(schema.skills).values({ name: d.name, ...row }).onConflictDoUpdate({ target: schema.skills.name, set: row });
    }
  }

  // 6. Write + commit.
  if (variant === 'random' && kept.length) {
    const others = allRows.filter((r) => r.status === 'active' && !kept.some((k) => k.draft.name === r.name)).map((r) => ({ body: r.body, faultTypes: r.faultTypes }));
    shuffleBodies(kept.map((k) => k.draft), others, opts.generation + 1);
  }
  const repo = new SkillsRepo(cfg.SKILLS_REPO_PATH, cfg.SKILLS_REPO_REF);
  for (const p of kept) {
    const d = p.draft;
    const v = p.outcome.verification ?? null;
    const verified = variant !== 'no_verify' && v !== null;
    const st = await winStats(db, d.name, 10);
    const winRate = st.winRate ?? (v ? v.withSkillPass : null);
    const md = renderSkillMd({ name: d.name, description: d.description, sourceSessions: d.sourceSessions, faultTypes: d.faultTypes, verified, winRate, version: d.version }, d.body || renderBody(d.steps));
    let sha: string | null;
    try {
      sha = await repo.commitSkill(d.name, md, commitMessage(d, v, variant));
    } catch (err) {
      report.errors.push(`commit ${d.name}: ${(err as Error).message}`);
      continue;
    }
    const row = {
      type: d.type, description: d.description, body: d.body, faultTypes: d.faultTypes, tools: d.tools, sourceSessions: d.sourceSessions,
      version: d.version, verified, status: 'active' as const, generation: d.generation, commitSha: sha,
      verification: v ? { ...v, variant } : { variant, skipped: true }, updatedAt: nowSql,
    };
    await db.insert(schema.skills).values({ name: d.name, ...row }).onConflictDoUpdate({ target: schema.skills.name, set: row });
    await publish(db, { kind: 'skill.committed', data: { name: d.name, version: d.version, commitSha: sha } });
    p.outcome.commitSha = sha;
    p.outcome.version = d.version;
    report.counts.committed++;
  }

  // 7. Retire, push, sync.
  if (variant !== 'no_retire') {
    try {
      report.retired = await retireSkills({ db, cfg, push: false });
      report.counts.retired = report.retired.length;
    } catch (err) {
      report.errors.push(`retire: ${(err as Error).message}`);
    }
  }
  let pushOk = true;
  if (report.counts.committed || report.retired.length) {
    try {
      report.pushed = await repo.push();
    } catch (err) {
      pushOk = false;
      report.errors.push(`push: ${(err as Error).message}`);
    }
  }
  if (pushOk && cfg.SKILLS_REPO_URL) {
    try {
      report.synced = await syncSkillsToTrueForge({ db, client: opts.client, cfg });
    } catch (err) {
      report.errors.push(`sync: ${(err as Error).message}`);
    }
  }

  report.precision = report.counts.drafted ? report.counts.verified_kept / report.counts.drafted : null;
  return report;
}

/** CLI entry (`monk learn`): learn from every TrueForge session linked to the chaos proxy since `since`. */
export async function learnFromRecentSessions(opts: {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  since: Date | string;
  generation?: number;
  variant?: Variant;
  verifier?: Verifier;
  llm?: Llm;
}): Promise<LearningReport> {
  const since = typeof opts.since === 'string' ? opts.since : opts.since.toISOString();
  const linked = await opts.db
    .selectDistinct({ sid: schema.mcpSessions.tfSessionId })
    .from(schema.mcpSessions)
    .where(and(isNotNull(schema.mcpSessions.tfSessionId), gte(schema.mcpSessions.createdAt, since)));
  const costed = await opts.db
    .selectDistinct({ sid: schema.events.sessionId })
    .from(schema.events)
    .where(and(inArray(schema.events.kind, ['session.cost', 'session.linked']), isNotNull(schema.events.sessionId), gte(schema.events.ts, since)));
  const ids = [...new Set([...linked, ...costed].map((r) => r.sid).filter((s): s is string => !!s))];
  let generation = opts.generation;
  if (generation === undefined) {
    const [row] = await opts.db.select({ g: max(schema.skills.generation) }).from(schema.skills);
    generation = (row?.g ?? 0) + 1;
  }
  return runLearning({
    db: opts.db, client: opts.client, cfg: opts.cfg, tfSessionIds: ids, generation,
    ...(opts.variant ? { variant: opts.variant } : {}),
    ...(opts.verifier ? { verifier: opts.verifier } : {}),
    ...(opts.llm ? { llm: opts.llm } : {}),
  });
}
