import { inArray } from 'drizzle-orm';
import { newId, schema, type MonkConfig, type MonkDb, type TrueForge } from '@monk/shared';
import { runSuite, type RunSuiteOpts } from './runner.ts';
import type { EvalRunSummary, Learner, LearnVariant, Suite, Verifier } from './types.ts';

export const DEFAULT_SEEDS = [42, 43, 44];
/** Fault types kept out of every learning round, so the stress test measures unseen-fault recovery. */
export const DEFAULT_HELD_BACK_FAULTS = ['stale_data', 'partial_result'];
export const STRESS_PROFILE = 'heavy';
export const CHAOS_OFF_PROFILE = 'off';
export const STRESS_SUFFIX = '+stress';

export const ABLATION_VARIANTS = ['full', 'no_verify', 'chaos_off_learning', 'random', 'no_retire'] as const;
export type AblationVariant = (typeof ABLATION_VARIANTS)[number];

export type BenchOpts = {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  suites: Suite[];
  profile: string;
  /** Number of seeds (42, 43, ...) or an explicit list. */
  seeds: number | number[];
  generations: number;
  chaosOffControl?: boolean;
  /** @monk/learn's runLearning (wired by the CLI). Without it generations just re-measure. */
  learner?: Learner;
  verifier?: Verifier;
  /** Empties the learned-skill set before generation 0 (and before each ablation variant). */
  resetSkills?: () => Promise<void>;
  heldBackFaults?: string[];
  stress?: boolean;
  benchId?: string;
  onRun?: (s: EvalRunSummary) => void;
} & Pick<RunSuiteOpts, 'chaos' | 'gh' | 'adb' | 'stepCap' | 'taskTimeoutMs' | 'agentName' | 'resetGithub' | 'restoreMobile' | 'faultRate' | 'taskIds'>;

export function seedList(seeds: number | number[]): number[] {
  return Array.isArray(seeds) ? seeds : Array.from({ length: seeds }, (_, i) => 42 + i);
}

const learnVariant = (v: AblationVariant): LearnVariant => (v === 'chaos_off_learning' ? 'full' : v);

async function learnSplitSessions(db: MonkDb, runIds: string[]): Promise<string[]> {
  if (runIds.length === 0) return [];
  const rows = await db.select().from(schema.evalResults).where(inArray(schema.evalResults.runId, runIds));
  return rows.filter((r) => r.split === 'learn' && r.tfSessionId).map((r) => r.tfSessionId!);
}

/** One learning curve for one variant, tagged with benchId/variant/generation. */
async function runCurve(opts: BenchOpts, benchId: string, variant: AblationVariant): Promise<void> {
  const seeds = seedList(opts.seeds);
  const heldBack = opts.heldBackFaults ?? DEFAULT_HELD_BACK_FAULTS;
  const control = opts.chaosOffControl ?? true;
  const common = {
    db: opts.db, client: opts.client, cfg: opts.cfg, benchId, variant, split: 'all' as const,
    ...(opts.chaos ? { chaos: opts.chaos } : {}),
    ...(opts.gh ? { gh: opts.gh } : {}),
    ...(opts.adb ? { adb: opts.adb } : {}),
    ...(opts.stepCap ? { stepCap: opts.stepCap } : {}),
    ...(opts.taskTimeoutMs ? { taskTimeoutMs: opts.taskTimeoutMs } : {}),
    ...(opts.agentName ? { agentName: opts.agentName } : {}),
    ...(opts.resetGithub ? { resetGithub: opts.resetGithub } : {}),
    ...(opts.restoreMobile ? { restoreMobile: opts.restoreMobile } : {}),
    ...(opts.taskIds ? { taskIds: opts.taskIds } : {}),
  };
  const run = async (o: { suite: Suite; profile: string; seed: number; generation: number; variant?: string }) => {
    const s = await runSuite({ ...common, ...(opts.faultRate !== undefined && o.profile !== CHAOS_OFF_PROFILE ? { faultRate: opts.faultRate } : {}), ...o });
    opts.onRun?.(s);
    return s;
  };

  await opts.resetSkills?.();
  for (let gen = 0; gen <= opts.generations; gen++) {
    const chaosRuns: string[] = [];
    const offRuns: string[] = [];
    for (const suite of opts.suites) {
      for (const seed of seeds) chaosRuns.push((await run({ suite, profile: opts.profile, seed, generation: gen })).runId);
      // Learning from normal runs needs chaos-off sessions for every seed; otherwise one control run suffices.
      const offSeeds = variant === 'chaos_off_learning' ? seeds : control ? seeds.slice(0, 1) : [];
      for (const seed of offSeeds) offRuns.push((await run({ suite, profile: CHAOS_OFF_PROFILE, seed, generation: gen })).runId);
    }
    if (gen === opts.generations) break;
    const source = variant === 'chaos_off_learning' ? offRuns : chaosRuns;
    await opts.learner?.({
      db: opts.db,
      client: opts.client,
      cfg: opts.cfg,
      tfSessionIds: await learnSplitSessions(opts.db, source),
      generation: gen + 1,
      variant: learnVariant(variant),
      excludeFaultTypes: heldBack,
      ...(opts.verifier ? { verifier: opts.verifier } : {}),
    });
  }

  if (opts.stress ?? true) {
    for (const suite of opts.suites) {
      for (const seed of seeds) await run({ suite, profile: STRESS_PROFILE, seed, generation: opts.generations, variant: `${variant}${STRESS_SUFFIX}` });
    }
  }
}

/** PRD learning-curve protocol: gen 0 with empty skills, learn, rerun same seeds, to gen G, then stress test. */
export async function runBench(opts: BenchOpts): Promise<string> {
  const benchId = opts.benchId ?? newId('bench');
  await runCurve(opts, benchId, 'full');
  return benchId;
}

/** Runs the learning curve once per ablation variant under one benchId (no stress test). */
export async function runAblations(opts: BenchOpts & { variants?: AblationVariant[] | 'all' }): Promise<string> {
  const benchId = opts.benchId ?? newId('abl');
  const variants = !opts.variants || opts.variants === 'all' ? [...ABLATION_VARIANTS] : opts.variants;
  for (const v of variants) await runCurve({ ...opts, stress: false }, benchId, v);
  return benchId;
}
