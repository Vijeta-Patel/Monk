import { resolve } from 'node:path';
import { runLearning } from '@monk/learn';
import {
  ABLATION_VARIANTS, githubFromConfig, makeVerifier, runAblations, runBench, writeReport, type AblationVariant, type ChaosSetter,
  type Learner, type Suite,
} from '@monk/evals';
import type { Ctx } from './context.ts';
import { createSkillToggles } from './skills.ts';

export type BenchRequest = {
  suites: Suite[];
  profile: string;
  seeds: number;
  generations: number;
  chaosOffControl?: boolean;
  stress?: boolean;
  keepSkills?: boolean;
  benchId?: string;
};

function wiring(ctx: Ctx, chaos: ChaosSetter) {
  const toggles = createSkillToggles(ctx);
  const gh = ctx.cfg.GITHUB_TOKEN && ctx.cfg.EVAL_REPO ? githubFromConfig(ctx.cfg) : undefined;
  const verifier = toggles.wrapVerifier(makeVerifier({ ...ctx, chaos, withSkills: toggles.withSkills, ...(gh ? { gh } : {}) }));
  // The learner always uses the draft-aware verifier; evals' own Verifier type only sees name + sources.
  const learner: Learner = ({ verifier: _ignored, ...o }) => runLearning({ ...o, verifier });
  return { toggles, gh, learner, verifier };
}

/** The learning loop's verifier: re-runs a draft's source tasks under the same seed, with and without it. */
export function learnVerifier(ctx: Ctx, chaos: ChaosSetter) {
  return wiring(ctx, chaos).verifier;
}

export async function benchRun(ctx: Ctx, chaos: ChaosSetter, req: BenchRequest, onLine = (s: string) => console.log(s)): Promise<string> {
  const { toggles, gh, learner } = wiring(ctx, chaos);
  return runBench({
    ...ctx,
    suites: req.suites,
    profile: req.profile,
    seeds: req.seeds,
    generations: req.generations,
    chaosOffControl: req.chaosOffControl ?? true,
    stress: req.stress ?? false,
    ...(req.benchId ? { benchId: req.benchId } : {}),
    chaos,
    learner,
    ...(req.keepSkills ? {} : { resetSkills: toggles.resetSkills }),
    ...(gh ? { gh } : {}),
    onRun: (s) => onLine(JSON.stringify(s)),
  });
}

export async function benchAblate(ctx: Ctx, chaos: ChaosSetter, req: { suites: Suite[]; variants: AblationVariant[]; seeds: number; generations: number; profile: string }) {
  const { toggles, gh, learner } = wiring(ctx, chaos);
  return runAblations({
    ...ctx,
    suites: req.suites,
    profile: req.profile,
    seeds: req.seeds,
    generations: req.generations,
    variants: req.variants,
    chaos,
    learner,
    resetSkills: toggles.resetSkills,
    ...(gh ? { gh } : {}),
  });
}

export async function benchReport(ctx: Ctx, formats: ('md' | 'json')[]): Promise<string[]> {
  return writeReport({ db: ctx.db, outDir: resolve(ctx.cfg.rootDir, 'benchmarks/results'), formats });
}

export const ALL_VARIANTS = ABLATION_VARIANTS;
