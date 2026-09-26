// Pure data shaping for the panels. No React, no fetch: unit-tested in test/transforms.test.ts.
import type { CurvePoint, EvalRunRow, FaultRow, HeatCell } from '@monk/shared/api';
import type { StoredEvent } from '@monk/shared/events';

// ─── learning curve ────────────────────────────────────────────────────────────

export type CurveRow = {
  generation: number;
  on: number | null;
  /** [lo, hi] of the chaos-on 95% CI, for the band. */
  ci: [number, number] | null;
  off: number | null;
  /** [top of chaos-on CI, off] for the chaos-tax wash; `tax` itself is off − on. */
  taxBand: [number, number] | null;
  tax: number | null;
  heldOut: number | null;
  seeds: number;
  stepsToRecover: number | null;
  costPerSolved: number | null;
  recovery: number | null;
};

export type CurveSeries = {
  suite: string;
  variant: string;
  rows: CurveRow[];
  /** True when the chaos-off control is a single measurement drawn as a flat reference. */
  offIsReference: boolean;
  offReferenceGen: number | null;
  first: CurveRow | null;
  last: CurveRow | null;
};

export const MAIN_VARIANT = 'full';

export function curveSuites(points: CurvePoint[]): string[] {
  return [...new Set(points.map((p) => p.suite))].sort((a, b) => suiteOrder(a) - suiteOrder(b) || a.localeCompare(b));
}

function suiteOrder(s: string): number {
  return s === 'github' ? 0 : s === 'mobile' ? 1 : 2;
}

/**
 * One row per generation for the chosen suite: chaos-on success (with CI), the chaos-off
 * control and the chaos tax between them. The protocol only runs one chaos-off control at
 * gen 0, so a lone control point is carried across as a labelled reference line.
 */
export function buildCurveSeries(points: CurvePoint[], suite: string, variant = MAIN_VARIANT): CurveSeries {
  const mine = points.filter((p) => p.suite === suite && (p.variant === variant || (variant === MAIN_VARIANT && !p.variant)));
  const on = new Map<number, CurvePoint>();
  const off = new Map<number, CurvePoint>();
  for (const p of mine) (p.chaos ? on : off).set(p.generation, p);
  // A control run may be recorded under another variant name; fall back to any chaos-off point of the suite.
  if (off.size === 0) for (const p of points) if (p.suite === suite && !p.chaos) off.set(p.generation, p);

  const gens = [...new Set([...on.keys()])].sort((a, b) => a - b);
  const offGens = [...off.keys()].sort((a, b) => a - b);
  const offIsReference = offGens.length === 1 && gens.length > 1;
  const refGen = offIsReference ? offGens[0]! : null;
  const refVal = refGen === null ? null : off.get(refGen)!.successRate.mean;

  const rows: CurveRow[] = gens.map((g) => {
    const p = on.get(g)!;
    const o = off.get(g);
    const offVal = o ? o.successRate.mean : refVal;
    const onVal = p.successRate.mean;
    return {
      generation: g,
      on: onVal,
      ci: [p.successRate.lo, p.successRate.hi],
      off: offVal,
      // The wash starts above the CI so the two bands never overlap into mud.
      taxBand: offVal === null ? null : [Math.min(offVal, Math.max(onVal, p.successRate.hi)), offVal],
      tax: offVal === null ? null : offVal - onVal,
      heldOut: p.heldOutSuccess,
      seeds: p.seeds,
      stepsToRecover: p.stepsToRecover,
      costPerSolved: p.costPerSolved,
      recovery: p.recoveryRate.mean,
    };
  });
  return {
    suite,
    variant,
    rows,
    offIsReference,
    offReferenceGen: refGen,
    first: rows[0] ?? null,
    last: rows.length > 1 ? rows[rows.length - 1]! : null,
  };
}

/** Gain counts only when gen-first and gen-last CIs don't overlap (PRD statistics rule). */
export function gainIsSignificant(s: CurveSeries): boolean {
  if (!s.first?.ci || !s.last?.ci) return false;
  return s.last.ci[0] > s.first.ci[1];
}

// ─── recovery heatmap ──────────────────────────────────────────────────────────

export type HeatEntry = { injected: number; recovered: number; rate: number | null };
export type HeatMatrix = {
  faultTypes: string[];
  tools: string[];
  get(faultType: string, tool: string): HeatEntry;
  rowTotals: Map<string, HeatEntry>;
  colTotals: Map<string, HeatEntry>;
  total: HeatEntry;
};

const EMPTY: HeatEntry = { injected: 0, recovered: 0, rate: null };

function entry(injected: number, recovered: number): HeatEntry {
  return { injected, recovered, rate: injected > 0 ? recovered / injected : null };
}

/** Rows: fault types by volume. Columns: tools grouped by upstream, then by volume. */
export function buildHeatMatrix(cells: HeatCell[]): HeatMatrix {
  const map = new Map<string, HeatEntry>();
  const rowAcc = new Map<string, [number, number]>();
  const colAcc = new Map<string, [number, number]>();
  let ti = 0;
  let tr = 0;
  for (const c of cells) {
    const k = `${c.faultType}\u0000${c.tool}`;
    const prev = map.get(k);
    const inj = (prev?.injected ?? 0) + c.injected;
    const rec = (prev?.recovered ?? 0) + c.recovered;
    map.set(k, entry(inj, rec));
    const r = rowAcc.get(c.faultType) ?? [0, 0];
    rowAcc.set(c.faultType, [r[0] + c.injected, r[1] + c.recovered]);
    const col = colAcc.get(c.tool) ?? [0, 0];
    colAcc.set(c.tool, [col[0] + c.injected, col[1] + c.recovered]);
    ti += c.injected;
    tr += c.recovered;
  }
  const faultTypes = [...rowAcc.entries()].sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0])).map(([k]) => k);
  const tools = [...colAcc.entries()]
    .sort((a, b) => splitTool(a[0]).upstream.localeCompare(splitTool(b[0]).upstream) || b[1][0] - a[1][0] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  const toTotals = (acc: Map<string, [number, number]>) => new Map([...acc].map(([k, [i, r]]) => [k, entry(i, r)]));
  return {
    faultTypes,
    tools,
    get: (f, t) => map.get(`${f}\u0000${t}`) ?? EMPTY,
    rowTotals: toTotals(rowAcc),
    colTotals: toTotals(colAcc),
    total: entry(ti, tr),
  };
}

/** `github.list_issues`, `github__list_issues`, `github/list_issues` → upstream + short name. */
export function splitTool(tool: string): { upstream: string; name: string } {
  const m = /^([^./:]+?)(?:__|\.|\/|:)(.+)$/.exec(tool);
  return m ? { upstream: m[1]!, name: m[2]! } : { upstream: '', name: tool };
}

// ─── live fault feed ───────────────────────────────────────────────────────────

export type FeedItem = {
  faultId: string;
  at: string;
  session: string | null;
  tool: string;
  faultType: string;
  manual: boolean;
  outcome: 'pending' | 'recovered' | 'unrecovered';
  steps: number | null;
  ms: number | null;
  /** Set on items that arrived live, so the row can flash once. */
  live: boolean;
};

export type FeedState = { items: FeedItem[]; lastEventId: number };
export type FeedAction = { type: 'seed'; faults: FaultRow[] } | { type: 'event'; event: StoredEvent };

export const FEED_LIMIT = 120;
export const initialFeed: FeedState = { items: [], lastEventId: 0 };

function fromRow(f: FaultRow): FeedItem {
  const ms = f.recoveredAt ? Date.parse(f.recoveredAt) - Date.parse(f.injectedAt) : null;
  return {
    faultId: f.id,
    at: f.injectedAt,
    session: f.tfSessionId,
    tool: f.tool,
    faultType: f.faultType,
    manual: f.manual,
    outcome: f.outcome,
    steps: f.recoverySteps,
    ms: ms !== null && Number.isFinite(ms) ? ms : null,
    live: false,
  };
}

/** Newest first. Seeding merges with anything that already streamed in. */
export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  if (action.type === 'seed') {
    const byId = new Map(state.items.map((i) => [i.faultId, i]));
    for (const f of action.faults) if (!byId.has(f.id)) byId.set(f.id, fromRow(f));
    const items = [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, FEED_LIMIT);
    return { ...state, items };
  }
  const e = action.event;
  if (e.id <= state.lastEventId && state.lastEventId !== 0) return state;
  const lastEventId = Math.max(state.lastEventId, e.id);
  switch (e.kind) {
    case 'fault.injected': {
      const d = e.data;
      if (state.items.some((i) => i.faultId === d.faultId)) return { ...state, lastEventId };
      const item: FeedItem = {
        faultId: d.faultId,
        at: e.ts,
        session: d.tfSessionId ?? d.mcpSessionId,
        tool: d.tool,
        faultType: d.faultType,
        manual: d.manual,
        outcome: 'pending',
        steps: null,
        ms: null,
        live: true,
      };
      return { items: [item, ...state.items].slice(0, FEED_LIMIT), lastEventId };
    }
    case 'fault.recovered':
    case 'fault.unrecovered': {
      const d = e.data;
      const recovered = e.kind === 'fault.recovered';
      let found = false;
      const items = state.items.map((i) => {
        if (i.faultId !== d.faultId) return i;
        found = true;
        return {
          ...i,
          outcome: recovered ? ('recovered' as const) : ('unrecovered' as const),
          steps: recovered ? e.data.steps : i.steps,
          ms: recovered ? e.data.ms : i.ms,
        };
      });
      if (!found) {
        // Outcome for a fault we never saw injected (older than the seed window): show it anyway.
        items.unshift({
          faultId: d.faultId,
          at: e.ts,
          session: d.tfSessionId ?? d.mcpSessionId,
          tool: d.tool,
          faultType: d.faultType,
          manual: false,
          outcome: recovered ? 'recovered' : 'unrecovered',
          steps: recovered ? e.data.steps : null,
          ms: recovered ? e.data.ms : null,
          live: true,
        });
      }
      return { items: items.slice(0, FEED_LIMIT), lastEventId };
    }
    default:
      return { ...state, lastEventId };
  }
}

export function feedCounts(items: FeedItem[]): { injected: number; recovered: number; unrecovered: number; pending: number } {
  let recovered = 0;
  let unrecovered = 0;
  let pending = 0;
  for (const i of items) {
    if (i.outcome === 'recovered') recovered++;
    else if (i.outcome === 'unrecovered') unrecovered++;
    else pending++;
  }
  return { injected: items.length, recovered, unrecovered, pending };
}

// ─── runs: summaries, ablations, cost ──────────────────────────────────────────

/** Eval summaries are free-form `Record<string, number>`; read the common spellings. */
export function summaryNum(s: Record<string, number> | null, ...keys: string[]): number | null {
  if (!s) return null;
  for (const k of keys) {
    const v = s[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function runSuccess(r: EvalRunRow): number | null {
  const rate = summaryNum(r.summary, 'successRate', 'passRate', 'success');
  if (rate !== null) return rate > 1 ? rate / 100 : rate;
  const passed = summaryNum(r.summary, 'passed', 'tasksPassed');
  const tasks = summaryNum(r.summary, 'tasks', 'tasksRun', 'total');
  return passed !== null && tasks ? passed / tasks : null;
}

export function runRecovery(r: EvalRunRow): number | null {
  const rate = summaryNum(r.summary, 'recoveryRate');
  if (rate !== null) return rate;
  const inj = summaryNum(r.summary, 'faultsInjected');
  const rec = summaryNum(r.summary, 'faultsRecovered');
  return inj ? (rec ?? 0) / inj : null;
}

export function runCost(r: EvalRunRow): number | null {
  return summaryNum(r.summary, 'costUsd', 'cost', 'dollars');
}

export function runTokens(r: EvalRunRow): number | null {
  const total = summaryNum(r.summary, 'tokens', 'totalTokens');
  if (total !== null) return total;
  const i = summaryNum(r.summary, 'inputTokens');
  const o = summaryNum(r.summary, 'outputTokens');
  return i === null && o === null ? null : (i ?? 0) + (o ?? 0);
}

export const CHAOS_OFF_PROFILE = 'off';

export type AblationRow = {
  variant: string;
  generation: number;
  runs: number;
  success: number | null;
  successLo: number | null;
  successHi: number | null;
  recovery: number | null;
  steps: number | null;
  costPerSolved: number | null;
  /** Success minus the full-Monk reference at the same generation, in points. */
  delta: number | null;
};

const VARIANT_ORDER = ['full', 'no_verify', 'chaos_off_learning', 'learned_chaos_off', 'random', 'no_retire'];

/**
 * Finished chaos-on runs of one suite, grouped by variant, compared at each variant's
 * latest generation (ablations are run after the last learning round).
 */
export function buildAblations(runs: EvalRunRow[], suite?: string): AblationRow[] {
  const done = runs.filter((r) => r.status === 'done' && r.summary && r.profile !== CHAOS_OFF_PROFILE && (!suite || r.suite === suite));
  const byVariant = new Map<string, EvalRunRow[]>();
  for (const r of done) {
    const v = r.variant || 'full';
    const list = byVariant.get(v) ?? [];
    list.push(r);
    byVariant.set(v, list);
  }
  if (byVariant.size < 2) return [];
  const rows: AblationRow[] = [];
  for (const [variant, list] of byVariant) {
    const gen = Math.max(...list.map((r) => r.generation));
    const at = list.filter((r) => r.generation === gen);
    rows.push(aggregate(variant, gen, at));
  }
  const full = rows.find((r) => r.variant === 'full');
  for (const r of rows) {
    let ref = full?.success ?? null;
    if (full && full.generation !== r.generation) {
      const same = done.filter((x) => (x.variant || 'full') === 'full' && x.generation === r.generation);
      ref = same.length ? aggregate('full', r.generation, same).success : ref;
    }
    r.delta = r.variant === 'full' || ref === null || r.success === null ? null : (r.success - ref) * 100;
  }
  return rows.sort((a, b) => variantRank(a.variant) - variantRank(b.variant) || a.variant.localeCompare(b.variant));
}

function variantRank(v: string): number {
  const i = VARIANT_ORDER.indexOf(v);
  return i < 0 ? VARIANT_ORDER.length : i;
}

function aggregate(variant: string, generation: number, runs: EvalRunRow[]): AblationRow {
  const succ = runs.map(runSuccess).filter((x): x is number => x !== null);
  const rec = runs.map(runRecovery).filter((x): x is number => x !== null);
  const steps = runs.map((r) => summaryNum(r.summary, 'stepsToRecover', 'meanRecoverySteps')).filter((x): x is number => x !== null);
  const cost = runs.reduce((a, r) => a + (runCost(r) ?? 0), 0);
  const solved = runs.reduce((a, r) => {
    const passed = summaryNum(r.summary, 'passed', 'tasksPassed');
    if (passed !== null) return a + passed;
    const s = runSuccess(r);
    const tasks = summaryNum(r.summary, 'tasks', 'tasksRun', 'total');
    return a + (s !== null && tasks ? s * tasks : 0);
  }, 0);
  return {
    variant,
    generation,
    runs: runs.length,
    success: mean(succ),
    successLo: succ.length ? Math.min(...succ) : null,
    successHi: succ.length ? Math.max(...succ) : null,
    recovery: mean(rec),
    steps: mean(steps),
    costPerSolved: solved > 0 && cost > 0 ? cost / solved : null,
    delta: null,
  };
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export type CostBar = { id: string; label: string; costUsd: number; tokens: number | null; running: boolean; suite: string; generation: number };

/** Most recent runs, oldest → newest, for the per-run cost columns. */
export function buildCostBars(runs: EvalRunRow[], limit = 18): CostBar[] {
  return [...runs]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .slice(-limit)
    .map((r) => ({
      id: r.id,
      label: `${r.suite} g${r.generation} s${r.seed}${r.variant && r.variant !== 'full' ? ` ${r.variant}` : ''}`,
      costUsd: runCost(r) ?? 0,
      tokens: runTokens(r),
      running: r.status === 'running',
      suite: r.suite,
      generation: r.generation,
    }));
}

// ─── live refresh routing ──────────────────────────────────────────────────────

export type Resource = 'state' | 'skills' | 'heatmap' | 'runs' | 'curve';

/** Which aggregates an event makes stale. */
export function staleBy(kind: StoredEvent['kind']): Resource[] {
  if (kind.startsWith('skill.')) return kind === 'skill.used' ? ['skills'] : ['skills', 'state'];
  if (kind === 'fault.injected') return ['heatmap'];
  if (kind === 'fault.recovered' || kind === 'fault.unrecovered') return ['heatmap'];
  if (kind === 'eval.task.done') return ['runs'];
  if (kind.startsWith('eval.')) return ['runs', 'curve', 'state'];
  if (kind === 'chaos.config' || kind === 'session.cost') return ['state'];
  return [];
}

// ─── label placement ───────────────────────────────────────────────────────────

/**
 * Spread end-labels so they don't overlap: keep each as close to its point as possible,
 * at least `gap` px apart, inside [lo, hi]. Returns positions in the input order.
 */
export function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => Math.min(hi, Math.max(lo, o.y)));
  for (let k = 1; k < out.length; k++) if (out[k]! - out[k - 1]! < gap) out[k] = out[k - 1]! + gap;
  const overflow = out.length ? out[out.length - 1]! - hi : 0;
  if (overflow > 0) {
    out[out.length - 1] = hi;
    for (let k = out.length - 2; k >= 0; k--) if (out[k + 1]! - out[k]! < gap) out[k] = out[k + 1]! - gap;
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]!));
  return res;
}
