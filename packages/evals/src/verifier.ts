import { eq, inArray } from 'drizzle-orm';
import { schema } from '@monk/shared';
import { SUITES, runSuite, type RunSuiteOpts } from './runner.ts';
import type { Suite, Task, VerificationResult, Verifier, WithSkills } from './types.ts';

export type VerifierOpts = Omit<RunSuiteOpts, 'suite' | 'profile' | 'seed' | 'generation' | 'variant' | 'benchId' | 'split' | 'taskIds'> & {
  withSkills: WithSkills;
  /** Runs per arm; more runs smooth out model noise at proportional cost. */
  repeats?: number;
};

type SourceTask = { suite: Suite; taskId: string; profile: string; seed: number; generation: number };

/** Maps a skill's source sessions to the eval tasks (and chaos seed) that produced them. */
async function sourceTasks(opts: VerifierOpts, sessions: string[]): Promise<SourceTask[]> {
  if (sessions.length === 0) return [];
  const results = await opts.db.select().from(schema.evalResults).where(inArray(schema.evalResults.tfSessionId, sessions));
  const out = new Map<string, SourceTask>();
  for (const r of results) {
    const [run] = await opts.db.select().from(schema.evalRuns).where(eq(schema.evalRuns.id, r.runId));
    if (!run) continue;
    const suite = run.suite as Suite;
    const known: Task[] = opts.tasks ?? SUITES[suite] ?? [];
    if (!known.some((t) => t.id === r.taskId)) continue;
    const key = `${suite}|${r.taskId}|${run.profile}|${run.seed}`;
    if (!out.has(key)) out.set(key, { suite, taskId: r.taskId, profile: run.profile, seed: run.seed, generation: run.generation });
  }
  return [...out.values()];
}

/**
 * The learning loop's Verifier: re-runs the skill's source task(s) under the same chaos seed,
 * without and with the skill, and keeps it only if success improves or steps drop without losing success.
 */
export function makeVerifier(opts: VerifierOpts): Verifier {
  return async (skill): Promise<VerificationResult> => {
    const sources = await sourceTasks(opts, skill.sourceSessions);
    const res: VerificationResult = { kept: false, baselinePass: 0, withSkillPass: 0, baselineSteps: 0, withSkillSteps: 0 };
    if (sources.length === 0) return res;
    const { withSkills, repeats: _r, ...runOpts } = opts;
    const repeats = opts.repeats ?? 1;
    const arm = async (names: string[]) =>
      withSkills(names, async () => {
        let pass = 0;
        let steps = 0;
        for (let i = 0; i < repeats; i++) {
          for (const s of sources) {
            const run = await runSuite({ ...runOpts, suite: s.suite, profile: s.profile, seed: s.seed, generation: s.generation, variant: 'verify', benchId: null, split: 'all', taskIds: [s.taskId] });
            pass += run.results.filter((r) => r.passed).length;
            steps += run.results.reduce((a, r) => a + r.steps, 0);
          }
        }
        return { pass, steps };
      });
    const base = await arm([]);
    const withSkill = await arm([skill.name]);
    res.baselinePass = base.pass;
    res.withSkillPass = withSkill.pass;
    res.baselineSteps = base.steps;
    res.withSkillSteps = withSkill.steps;
    res.kept = withSkill.pass > base.pass || (withSkill.pass === base.pass && withSkill.pass > 0 && withSkill.steps < base.steps);
    return res;
  };
}
