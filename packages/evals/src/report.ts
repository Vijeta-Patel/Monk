import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, inArray, isNotNull } from 'drizzle-orm';
import { mcpSessionsFor, schema, type CurvePoint, type MonkDb } from '@monk/shared';
import { DEFAULT_HELD_BACK_FAULTS, STRESS_SUFFIX } from './bench.ts';
import { lineChartSvg, type ChartSeries } from './svg.ts';
import { chaosTax, curveFrom, gainVerdicts, resultsByRun, selectRuns, type RunRow } from './stats.ts';

export type ReportOpts = {
  db: MonkDb;
  /** Base directory; files go to `<outDir>/<date>/`. */
  outDir: string;
  formats: ('md' | 'json')[];
  /** Main learning-curve bench(es); default: the latest `bench_*`. */
  benchIds?: string[];
  /** Ablation bench; default: the latest `abl_*`. */
  ablationBenchId?: string | null;
  heldBackFaults?: string[];
  date?: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ci = (i: { mean: number; lo: number; hi: number }) => (i.lo === i.hi ? pct(i.mean) : `${pct(i.mean)} (${pct(i.lo)}–${pct(i.hi)})`);
const usd = (v: number | null) => (v == null ? '–' : `$${v.toFixed(v < 1 ? 3 : 2)}`);
const num = (v: number | null, d = 1) => (v == null ? '–' : v.toFixed(d));
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function latestBench(db: MonkDb, prefix: string): Promise<string | null> {
  const rows = await db.select({ b: schema.evalRuns.benchId }).from(schema.evalRuns).where(isNotNull(schema.evalRuns.benchId)).orderBy(desc(schema.evalRuns.startedAt));
  return rows.map((r) => r.b).find((b): b is string => !!b && b.startsWith(prefix)) ?? null;
}

async function faultsFor(db: MonkDb, tfSessionId: string | null) {
  if (!tfSessionId) return [];
  const mcp = await mcpSessionsFor(db, tfSessionId);
  return mcp.length ? db.select().from(schema.faults).where(inArray(schema.faults.mcpSessionId, mcp)) : [];
}

function chart(points: CurvePoint[], pick: (p: CurvePoint) => { y: number; lo?: number; hi?: number } | null, t: string, format: (v: number) => string, yMax?: number): string {
  const series: ChartSeries[] = [];
  for (const suite of [...new Set(points.map((p) => p.suite))]) {
    const pts = points
      .filter((p) => p.suite === suite)
      .map((p) => ({ x: p.generation, ...pick(p) }))
      .filter((p): p is { x: number; y: number; lo?: number; hi?: number } => typeof p.y === 'number');
    if (pts.length) series.push({ name: title(suite), points: pts });
  }
  return lineChartSvg({ title: t, xLabel: 'Generation', series, format, ...(yMax !== undefined ? { yMax } : {}) });
}

/** Writes results.json and/or REPORT.md (+ curve-*.svg) for the latest bench; returns the written paths. */
export async function writeReport(opts: ReportOpts): Promise<string[]> {
  const { db } = opts;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const dir = join(opts.outDir, date);
  await mkdir(dir, { recursive: true });
  const heldBack = opts.heldBackFaults ?? DEFAULT_HELD_BACK_FAULTS;

  const mainIds = opts.benchIds ?? [await latestBench(db, 'bench_')].filter((b): b is string => !!b);
  const ablId = opts.ablationBenchId === undefined ? await latestBench(db, 'abl_') : opts.ablationBenchId;
  // With no benches at all, report whatever ad-hoc runs exist.
  const runs = mainIds.length ? await selectRuns(db, mainIds) : await selectRuns(db, null);
  const ablRuns = ablId ? await selectRuns(db, [ablId]) : [];
  const results = await resultsByRun(db, [...runs, ...ablRuns].map((r) => r.id));
  const curve = curveFrom(runs, results);
  const ablCurve = curveFrom(ablRuns, results);

  const written: string[] = [];
  const faultCache = new Map<string, Awaited<ReturnType<typeof faultsFor>>>();
  const sessionFaults = async (sid: string | null) => {
    if (!sid) return [];
    if (!faultCache.has(sid)) faultCache.set(sid, await faultsFor(db, sid));
    return faultCache.get(sid)!;
  };

  if (opts.formats.includes('json')) {
    const dump = async (rs: RunRow[]) =>
      Promise.all(
        rs.map(async (run) => ({
          ...run,
          results: await Promise.all((results.get(run.id) ?? []).map(async (r) => ({ ...r, faults: await sessionFaults(r.tfSessionId) }))),
        })),
      );
    const json = {
      generatedAt: new Date().toISOString(),
      benchIds: mainIds,
      ablationBenchId: ablId,
      heldBackFaults: heldBack,
      curve,
      ablationCurve: ablCurve,
      verdicts: gainVerdicts(curve).map((v) => ({ suite: v.suite, variant: v.variant, from: v.from.generation, to: v.to.generation, delta: v.delta, significant: v.significant })),
      runs: await dump(runs),
      ablationRuns: await dump(ablRuns),
    };
    const p = join(dir, 'results.json');
    await writeFile(p, `${JSON.stringify(json, null, 2)}\n`);
    written.push(p);
  }

  if (opts.formats.includes('md')) {
    const main = curve.filter((p) => p.variant === 'full' && p.chaos);
    const svgs: [string, string][] = [
      ['curve-success.svg', chart(main, (p) => ({ y: p.successRate.mean, lo: p.successRate.lo, hi: p.successRate.hi }), 'Success rate under chaos', pct, 1)],
      ['curve-recovery.svg', chart(main, (p) => ({ y: p.recoveryRate.mean, lo: p.recoveryRate.lo, hi: p.recoveryRate.hi }), 'Recovery rate (faults recovered / injected)', pct, 1)],
      ['curve-steps.svg', chart(main, (p) => (p.stepsToRecover == null ? null : { y: p.stepsToRecover }), 'Steps to recover (mean tool calls)', (v) => v.toFixed(1))],
      ['curve-cost.svg', chart(main, (p) => (p.costPerSolved == null ? null : { y: p.costPerSolved }), 'Cost per solved task (USD)', (v) => `$${v.toFixed(2)}`)],
    ];
    for (const [name, svg] of svgs) {
      const p = join(dir, name);
      await writeFile(p, `${svg}\n`);
      written.push(p);
    }

    const allResults = runs.flatMap((r) => results.get(r.id) ?? []);
    const required = allResults.reduce((a, r) => a + r.approvalsRequired, 0);
    const unapproved = allResults.reduce((a, r) => a + r.destructiveUnapproved, 0);
    const totalCost = allResults.reduce((a, r) => a + r.costUsd, 0);
    const md: string[] = [];
    md.push(`# Monk-Bench report, ${date}`, '');
    md.push(`Bench ${mainIds.join(', ') || '(ad-hoc runs)'}: ${runs.length} runs, ${allResults.length} task runs, $${totalCost.toFixed(2)} total.`);
    md.push('Every number is a mean over seeds; brackets are 95% bootstrap confidence intervals (2000 resamples, fixed seed). Raw data: `results.json`.', '');
    md.push('## Results', '');
    md.push('| Suite | Gen | Success (chaos on) | Chaos tax | Recovery rate | Steps to recover | $ per solved task | Held-out success |');
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const p of main) {
      const tax = chaosTax(curve, p);
      md.push(`| ${title(p.suite)} | ${p.generation} | ${ci(p.successRate)} | ${tax == null ? '–' : `${Math.round(tax * 100)} pts`} | ${ci(p.recoveryRate)} | ${num(p.stepsToRecover)} | ${usd(p.costPerSolved)} | ${p.heldOutSuccess == null ? '–' : pct(p.heldOutSuccess)} |`);
    }
    md.push('', '## Verdict', '');
    const verdicts = gainVerdicts(curve);
    if (verdicts.length === 0) md.push('Not enough generations to judge a gain.');
    for (const v of verdicts) {
      md.push(
        `- **${title(v.suite)}**: success ${pct(v.from.successRate.mean)} at gen ${v.from.generation} → ${pct(v.to.successRate.mean)} at gen ${v.to.generation} (${v.delta >= 0 ? '+' : ''}${Math.round(v.delta * 100)} pts). ` +
          (v.significant ? 'Significant: the 95% CIs do not overlap.' : 'Not significant: the 95% CIs overlap (or there is no gain).'),
      );
    }
    md.push('', '## Approval safety', '');
    md.push(`${required} destructive actions attempted, ${unapproved} without approval: ${required ? pct((required - unapproved) / required) : '100%'} approved first (target 100%).`);

    const stress = curve.filter((p) => p.variant.endsWith(STRESS_SUFFIX));
    if (stress.length) {
      md.push('', '## Stress test', '', `Profile \`heavy\`, fault types held back from all learning: ${heldBack.map((f) => `\`${f}\``).join(', ')}.`, '');
      md.push('| Suite | Gen | Success | Recovery rate | Unseen-fault recovery |', '| --- | --- | --- | --- | --- |');
      for (const p of stress) {
        const stressRuns = runs.filter((r) => r.suite === p.suite && r.variant === p.variant && r.generation === p.generation);
        let inj = 0;
        let rec = 0;
        for (const run of stressRuns) {
          for (const r of results.get(run.id) ?? []) {
            for (const f of await sessionFaults(r.tfSessionId)) {
              if (!heldBack.includes(f.faultType)) continue;
              inj++;
              if (f.outcome === 'recovered') rec++;
            }
          }
        }
        md.push(`| ${title(p.suite)} | ${p.generation} | ${ci(p.successRate)} | ${ci(p.recoveryRate)} | ${inj ? `${pct(rec / inj)} (${rec}/${inj})` : '–'} |`);
      }
    }

    md.push('', '## Learning curves', '');
    for (const [name] of svgs) md.push(`![${name.replace(/\.svg$/, '')}](${name})`, '');

    md.push('## Ablations', '');
    if (ablCurve.length === 0) md.push('No ablation run found. Run `monk bench ablate`.');
    else {
      md.push(`Bench ${ablId}. Last generation, chaos on.`, '');
      md.push('| Suite | Variant | Gen | Success | Δ vs full | Recovery rate | Steps to recover | $ per solved task |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      const lastOf = (suite: string, variant: string) =>
        ablCurve.filter((p) => p.suite === suite && p.variant === variant && p.chaos).sort((a, b) => b.generation - a.generation)[0];
      for (const suite of [...new Set(ablCurve.map((p) => p.suite))]) {
        const full = lastOf(suite, 'full');
        for (const variant of [...new Set(ablCurve.filter((p) => p.suite === suite).map((p) => p.variant))]) {
          const p = lastOf(suite, variant);
          if (!p) continue;
          const delta = full && variant !== 'full' ? `${Math.round((p.successRate.mean - full.successRate.mean) * 100)} pts` : '–';
          md.push(`| ${title(suite)} | ${variant} | ${p.generation} | ${ci(p.successRate)} | ${delta} | ${ci(p.recoveryRate)} | ${num(p.stepsToRecover)} | ${usd(p.costPerSolved)} |`);
        }
      }
    }
    const p = join(dir, 'REPORT.md');
    await writeFile(p, `${md.join('\n')}\n`);
    written.push(p);
  }
  return written;
}
