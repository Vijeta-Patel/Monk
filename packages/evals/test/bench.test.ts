import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, openDb, schema, type CurvePoint } from '@monk/shared';
import { runAblations, runBench } from '../src/bench.ts';
import { writeReport } from '../src/report.ts';
import { runSuite } from '../src/runner.ts';
import { bootstrapCI, computeCurve, gainVerdicts, intervalsOverlap } from '../src/stats.ts';
import type { FixtureIds, Learner, Task } from '../src/types.ts';
import { makeVerifier } from '../src/verifier.ts';
import { FakeGitHub, FakeTrueForge, done, mcpInit, said } from './fakes.ts';

const cfg = loadConfig({ env: { MONK_DB_PATH: ':memory:' }, rootDir: '/tmp' });
const fixtures: FixtureIds = { issues: {}, pulls: {}, branches: {}, tag: null, defaultBranch: 'main', seededAt: '' };
const tasks: Task[] = [
  { id: 't-learn', suite: 'github', split: 'learn', title: 'l', destructive: false, prompt: () => 'x', check: async (c) => ({ passed: c.answer === 'OK', detail: '' }) },
  { id: 't-held', suite: 'github', split: 'heldout', title: 'h', destructive: false, prompt: () => 'x', check: async (c) => ({ passed: c.answer === 'OK', detail: '' }) },
];

describe('stats', () => {
  it('bootstrap CI is deterministic and brackets the mean', () => {
    const v = [0.4, 0.5, 0.6];
    const a = bootstrapCI(v);
    expect(bootstrapCI(v)).toEqual(a);
    expect(a.mean).toBeCloseTo(0.5);
    expect(a.lo).toBeLessThanOrEqual(0.5);
    expect(a.hi).toBeGreaterThanOrEqual(0.5);
    expect(a.lo).toBeGreaterThanOrEqual(0.4);
    expect(a.hi).toBeLessThanOrEqual(0.6);
    expect(bootstrapCI([0.7])).toEqual({ mean: 0.7, lo: 0.7, hi: 0.7 });
    expect(bootstrapCI(v, { seed: 1 })).not.toEqual(bootstrapCI([0.1, 0.9, 0.5], { seed: 1 }));
  });

  it('gain is significant iff gen 0 and gen N intervals do not overlap', () => {
    const pt = (generation: number, lo: number, mean: number, hi: number): CurvePoint => ({
      suite: 'github', variant: 'full', generation, chaos: true, seeds: 3, successRate: { mean, lo, hi }, recoveryRate: { mean: 0, lo: 0, hi: 0 },
      stepsToRecover: null, costPerSolved: null, heldOutSuccess: null,
    });
    expect(intervalsOverlap({ lo: 0.3, hi: 0.5 }, { lo: 0.5, hi: 0.7 })).toBe(true);
    expect(gainVerdicts([pt(0, 0.3, 0.4, 0.5), pt(5, 0.6, 0.7, 0.8)])[0]).toMatchObject({ significant: true });
    expect(gainVerdicts([pt(0, 0.3, 0.4, 0.6), pt(5, 0.55, 0.7, 0.8)])[0]).toMatchObject({ significant: false });
    expect(gainVerdicts([pt(0, 0.6, 0.7, 0.8), pt(5, 0.3, 0.4, 0.5)])[0]).toMatchObject({ significant: false });
  });
});

describe('bench', () => {
  it('runs the learning-curve protocol, calls the learner, and reports', async () => {
    const db = openDb(':memory:');
    const tf = new FakeTrueForge(({ metadata }) => [mcpInit(`mcp-${metadata.monk_eval_run}-${metadata.monk_eval_task}`), said('m', 'OK'), done({ output: 'OK' })]);
    const learnerCalls: Parameters<Learner>[0][] = [];
    const learner: Learner = async (o) => void learnerCalls.push(o);
    const resets: number[] = [];
    const chaosSets: { enabled?: boolean; profile?: string; seed?: number }[] = [];
    const benchId = await runBench({
      db, client: tf.asClient(), cfg, suites: ['github'], profile: 'moderate', seeds: 2, generations: 2, learner,
      resetSkills: async () => void resets.push(1),
      chaos: { set: async (p) => void chaosSets.push(p) },
      gh: new FakeGitHub(), resetGithub: async () => fixtures,
    });
    expect(benchId).toMatch(/^bench_/);
    expect(resets).toHaveLength(1);
    // The real GitHub suite ran against an empty fake repo, so check tagging rather than outcomes.
    const runs = await db.select().from(schema.evalRuns);
    expect(runs.every((r) => r.benchId === benchId)).toBe(true);
    // per gen: 2 seeds chaos-on + 1 chaos-off control; 3 gens; + 2 stress runs
    expect(runs).toHaveLength(3 * 3 + 2);
    expect(runs.filter((r) => r.profile === 'heavy').every((r) => r.variant === 'full+stress' && r.generation === 2)).toBe(true);
    expect([...new Set(runs.filter((r) => r.profile === 'moderate').map((r) => r.seed))].sort()).toEqual([42, 43]);
    expect(learnerCalls.map((c) => c.generation)).toEqual([1, 2]);
    expect(learnerCalls[0]!.excludeFaultTypes).toEqual(['stale_data', 'partial_result']);
    expect(learnerCalls[0]!.variant).toBe('full');
    // only learn-split, chaos-on sessions reach the learner
    const learnIds = new Set((await db.select().from(schema.evalResults)).filter((r) => r.split === 'learn').map((r) => r.tfSessionId));
    expect(learnerCalls[0]!.tfSessionIds.length).toBe(2 * 9); // 2 seeds × 9 learn tasks
    expect(learnerCalls[0]!.tfSessionIds.every((s) => learnIds.has(s))).toBe(true);
    expect(chaosSets.some((c) => c.enabled === false)).toBe(true);
  });

  it('computeCurve + writeReport over a synthetic bench', async () => {
    const db = openDb(':memory:');
    let skilled = false;
    const tf = new FakeTrueForge(({ metadata }) => {
      const ok = skilled || metadata.monk_eval_task === 't-held';
      return [said('m', ok ? 'OK' : 'no'), done({ output: ok ? 'OK' : 'no', tokens: [10_000, 1000] })];
    });
    const common = { db, client: tf.asClient(), cfg, suite: 'github' as const, tasks, gh: new FakeGitHub(), resetGithub: async () => fixtures, benchId: 'bench_syn' };
    for (const seed of [42, 43, 44]) await runSuite({ ...common, profile: 'moderate', seed, generation: 0 });
    await runSuite({ ...common, profile: 'off', seed: 42, generation: 0 });
    skilled = true;
    for (const seed of [42, 43, 44]) await runSuite({ ...common, profile: 'moderate', seed, generation: 1 });
    await runSuite({ ...common, profile: 'off', seed: 42, generation: 1 });

    const curve = await computeCurve(db);
    const on = curve.filter((p) => p.chaos);
    expect(on.map((p) => [p.generation, p.successRate.mean])).toEqual([[0, 0.5], [1, 1]]);
    expect(on[0]!.heldOutSuccess).toBe(1);
    expect(on[0]!.seeds).toBe(3);
    expect(curve.filter((p) => !p.chaos)).toHaveLength(2);
    expect(await computeCurve(db)).toEqual(curve);

    const dir = await mkdtemp(join(tmpdir(), 'monk-report-'));
    const files = await writeReport({ db, outDir: dir, formats: ['md', 'json'], date: '2026-09-23' });
    const names = (await readdir(join(dir, '2026-09-23'))).sort();
    expect(names).toEqual(['REPORT.md', 'curve-cost.svg', 'curve-recovery.svg', 'curve-steps.svg', 'curve-success.svg', 'results.json']);
    expect(files).toHaveLength(6);
    const md = await readFile(join(dir, '2026-09-23', 'REPORT.md'), 'utf8');
    expect(md).toContain('| Suite | Gen | Success (chaos on) | Chaos tax |');
    expect(md).toContain('| Github | 0 | 50% |');
    expect(md).toMatch(/Significant: the 95% CIs do not overlap/);
    expect(md).toContain('![curve-success](curve-success.svg)');
    const svg = await readFile(join(dir, '2026-09-23', 'curve-success.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]+xmlns/);
    expect(svg).toContain('<polyline');
    const json = JSON.parse(await readFile(join(dir, '2026-09-23', 'results.json'), 'utf8'));
    expect(json.runs).toHaveLength(8);
    expect(json.runs[0].results[0]).toHaveProperty('faults');
    expect(json.verdicts[0]).toMatchObject({ suite: 'github', significant: true });
  });

  it('ablations tag variants and learn chaos_off_learning from chaos-off sessions', async () => {
    const db = openDb(':memory:');
    const tf = new FakeTrueForge(() => [said('m', 'OK'), done({ output: 'OK' })]);
    const calls: Parameters<Learner>[0][] = [];
    const benchId = await runAblations({
      db, client: tf.asClient(), cfg, suites: ['github'], profile: 'moderate', seeds: [42], generations: 1,
      learner: async (o) => void calls.push(o), gh: new FakeGitHub(), resetGithub: async () => fixtures,
      variants: ['full', 'chaos_off_learning', 'random'],
    });
    const runs = await db.select().from(schema.evalRuns);
    expect(benchId).toMatch(/^abl_/);
    expect([...new Set(runs.map((r) => r.variant))].sort()).toEqual(['chaos_off_learning', 'full', 'random']);
    expect(runs.some((r) => r.profile === 'heavy')).toBe(false);
    expect(calls.map((c) => c.variant)).toEqual(['full', 'full', 'random']);
    const results = await db.select().from(schema.evalResults);
    const offRunIds = new Set(runs.filter((r) => r.variant === 'chaos_off_learning' && r.profile === 'off').map((r) => r.id));
    const offSessions = new Set(results.filter((r) => offRunIds.has(r.runId)).map((r) => r.tfSessionId));
    expect(calls[1]!.tfSessionIds.length).toBeGreaterThan(0);
    expect(calls[1]!.tfSessionIds.every((s) => offSessions.has(s))).toBe(true);
  });
});

describe('makeVerifier', () => {
  it('re-runs the source task with the same seed with and without the skill', async () => {
    const db = openDb(':memory:');
    let enabled: string[] = [];
    const tf = new FakeTrueForge(() => {
      const ok = enabled.includes('csv-skill');
      return [said('m', ok ? 'OK' : 'no'), done({ output: ok ? 'OK' : 'no' })];
    });
    const base = { db, client: tf.asClient(), cfg, tasks, gh: new FakeGitHub(), resetGithub: async () => fixtures };
    const src = await runSuite({ ...base, suite: 'github', profile: 'moderate', seed: 43, generation: 0, taskIds: ['t-learn'] });
    const chaosSeeds: (number | undefined)[] = [];
    const toggles: string[][] = [];
    const verify = makeVerifier({
      ...base,
      chaos: { set: async (p) => void chaosSeeds.push(p.seed) },
      withSkills: async (names, fn) => {
        toggles.push(names);
        enabled = names;
        try {
          return await fn();
        } finally {
          enabled = [];
        }
      },
    });
    const res = await verify({ name: 'csv-skill', sourceSessions: [src.results[0]!.tfSessionId!] });
    expect(res).toMatchObject({ kept: true, baselinePass: 0, withSkillPass: 1 });
    expect(toggles).toEqual([[], ['csv-skill']]);
    expect(chaosSeeds).toEqual([43, 43]);
    const verifyRuns = (await db.select().from(schema.evalRuns)).filter((r) => r.variant === 'verify');
    expect(verifyRuns).toHaveLength(2);
    expect((await verify({ name: 'x', sourceSessions: ['unknown'] })).kept).toBe(false);
  });
});
