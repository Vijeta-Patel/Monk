import { desc, inArray, isNotNull } from 'drizzle-orm';
import { schema, type CurvePoint, type MonkDb } from '@monk/shared';
import { CHAOS_OFF_PROFILE } from './bench.ts';

export type Interval = { mean: number; lo: number; hi: number };

/** Small, fast, seedable PRNG so bootstrap CIs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean with a 95% percentile-bootstrap CI over the given per-seed values. */
export function bootstrapCI(values: number[], opts: { resamples?: number; seed?: number; alpha?: number } = {}): Interval {
  if (values.length === 0) return { mean: 0, lo: 0, hi: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, lo: mean, hi: mean };
  const rand = mulberry32(opts.seed ?? 42);
  const n = values.length;
  const B = opts.resamples ?? 2000;
  const means = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!;
    means[b] = s / n;
  }
  means.sort();
  const alpha = opts.alpha ?? 0.05;
  const at = (q: number) => means[Math.min(B - 1, Math.max(0, Math.floor(q * B)))]!;
  return { mean, lo: at(alpha / 2), hi: at(1 - alpha / 2) };
}

export function intervalsOverlap(a: Pick<Interval, 'lo' | 'hi'>, b: Pick<Interval, 'lo' | 'hi'>): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

export type GainVerdict = { suite: string; variant: string; from: CurvePoint; to: CurvePoint; delta: number; significant: boolean };

/** PRD rule: a gain counts only if the CIs of generation 0 and the last generation don't overlap. */
export function gainVerdicts(points: CurvePoint[], variant = 'full'): GainVerdict[] {
  const out: GainVerdict[] = [];
  const suites = [...new Set(points.map((p) => p.suite))];
  for (const suite of suites) {
    const on = points.filter((p) => p.suite === suite && p.variant === variant && p.chaos).sort((a, b) => a.generation - b.generation);
    const from = on[0];
    const to = on.at(-1);
    if (!from || !to || from === to) continue;
    const delta = to.successRate.mean - from.successRate.mean;
    out.push({ suite, variant, from, to, delta, significant: delta > 0 && !intervalsOverlap(from.successRate, to.successRate) });
  }
  return out;
}

export type RunRow = typeof schema.evalRuns.$inferSelect;
export type ResultRow = typeof schema.evalResults.$inferSelect;

/** Runs of the given benches; `undefined` = the most recently started bench (or every run if none); `null` = every run. */
export async function selectRuns(db: MonkDb, benchIds?: string[] | null): Promise<RunRow[]> {
  let ids = benchIds ?? undefined;
  if (benchIds === undefined) {
    const [latest] = await db.select().from(schema.evalRuns).where(isNotNull(schema.evalRuns.benchId)).orderBy(desc(schema.evalRuns.startedAt)).limit(1);
    ids = latest?.benchId ? [latest.benchId] : undefined;
  }
  const rows = ids?.length ? await db.select().from(schema.evalRuns).where(inArray(schema.evalRuns.benchId, ids)) : await db.select().from(schema.evalRuns);
  return rows.filter((r) => r.variant !== 'verify' && r.status !== 'running');
}

export async function resultsByRun(db: MonkDb, runIds: string[]): Promise<Map<string, ResultRow[]>> {
  const map = new Map<string, ResultRow[]>(runIds.map((id) => [id, []]));
  if (runIds.length === 0) return map;
  for (const r of await db.select().from(schema.evalResults).where(inArray(schema.evalResults.runId, runIds))) map.get(r.runId)?.push(r);
  return map;
}

export function curveFrom(runs: RunRow[], results: Map<string, ResultRow[]>, opts: { resamples?: number; seed?: number } = {}): CurvePoint[] {
  const groups = new Map<string, RunRow[]>();
  for (const run of runs) {
    const key = JSON.stringify([run.suite, run.variant, run.generation, run.profile !== CHAOS_OFF_PROFILE]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const points: CurvePoint[] = [];
  for (const [key, group] of groups) {
    const [suite, variant, generation, chaos] = JSON.parse(key) as [string, string, number, boolean];
    const success: number[] = [];
    const recovery: number[] = [];
    let recovered = 0, stepSum = 0, stepWeight = 0, cost = 0, passed = 0, heldTotal = 0, heldPassed = 0;
    for (const run of group) {
      const rs = results.get(run.id) ?? [];
      if (rs.length === 0) continue;
      success.push(rs.filter((r) => r.passed).length / rs.length);
      const inj = rs.reduce((a, r) => a + r.faultsInjected, 0);
      const rec = rs.reduce((a, r) => a + r.faultsRecovered, 0);
      if (inj > 0) recovery.push(rec / inj);
      recovered += rec;
      for (const r of rs) {
        if (r.meanRecoverySteps != null && r.faultsRecovered > 0) {
          stepSum += r.meanRecoverySteps * r.faultsRecovered;
          stepWeight += r.faultsRecovered;
        }
        cost += r.costUsd;
        if (r.passed) passed++;
        if (r.split === 'heldout') {
          heldTotal++;
          if (r.passed) heldPassed++;
        }
      }
    }
    if (success.length === 0) continue;
    points.push({
      suite, variant, generation, chaos, seeds: success.length,
      successRate: bootstrapCI(success, opts),
      recoveryRate: bootstrapCI(recovery, opts),
      stepsToRecover: stepWeight && recovered ? stepSum / stepWeight : null,
      costPerSolved: passed ? cost / passed : null,
      heldOutSuccess: heldTotal ? heldPassed / heldTotal : null,
    });
  }
  return points.sort((a, b) => a.suite.localeCompare(b.suite) || a.variant.localeCompare(b.variant) || Number(b.chaos) - Number(a.chaos) || a.generation - b.generation);
}

/** Learning curve: one point per (suite, variant, generation, chaos on/off), mean over seeds with 95% bootstrap CI. */
export async function computeCurve(db: MonkDb, opts: { benchIds?: string[]; resamples?: number; seed?: number } = {}): Promise<CurvePoint[]> {
  const runs = await selectRuns(db, opts.benchIds);
  return curveFrom(runs, await resultsByRun(db, runs.map((r) => r.id)), opts);
}

/** success(chaos off) − success(chaos on) for the same suite/variant/generation. */
export function chaosTax(points: CurvePoint[], p: CurvePoint): number | null {
  const off = points.find((q) => !q.chaos && q.suite === p.suite && q.variant === p.variant && q.generation === p.generation);
  return off ? off.successRate.mean - p.successRate.mean : null;
}
