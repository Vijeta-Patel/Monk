import { describe, expect, it } from 'vitest';
import type { CurvePoint, EvalRunRow, FaultRow, HeatCell } from '@monk/shared/api';
import type { StoredEvent } from '@monk/shared/events';
import {
  buildAblations, buildCurveSeries, buildHeatMatrix, curveSuites, feedCounts, feedReducer, gainIsSignificant, initialFeed,
  splitTool, spreadLabels, staleBy,
} from '../src/lib/transforms.ts';

const pt = (suite: string, generation: number, chaos: boolean, mean: number, extra: Partial<CurvePoint> = {}): CurvePoint => ({
  suite, variant: 'full', generation, chaos, seeds: 3,
  successRate: { mean, lo: mean - 0.05, hi: mean + 0.05 },
  recoveryRate: { mean: 0.5, lo: 0.4, hi: 0.6 },
  stepsToRecover: 3, costPerSolved: 0.2, heldOutSuccess: mean - 0.05, ...extra,
});

describe('buildCurveSeries', () => {
  it('pairs chaos-on with the per-generation control and computes the chaos tax', () => {
    const s = buildCurveSeries([pt('github', 1, true, 0.55), pt('github', 0, true, 0.4), pt('github', 0, false, 0.88), pt('github', 1, false, 0.86)], 'github');
    expect(s.rows.map((r) => r.generation)).toEqual([0, 1]);
    expect(s.offIsReference).toBe(false);
    expect(s.rows[0]!.tax).toBeCloseTo(0.48);
    expect(s.rows[1]!.taxBand![0]).toBeCloseTo(0.6);
    expect(s.rows[1]!.taxBand![1]).toBe(0.86);
    expect(s.rows[0]!.ci![0]).toBeCloseTo(0.35);
    expect(s.rows[0]!.ci![1]).toBeCloseTo(0.45);
    expect(s.first?.generation).toBe(0);
    expect(s.last?.generation).toBe(1);
  });

  it('carries a lone gen-0 control across as a reference line', () => {
    const s = buildCurveSeries([pt('mobile', 0, true, 0.3), pt('mobile', 1, true, 0.5), pt('mobile', 2, true, 0.6), pt('mobile', 0, false, 0.8)], 'mobile');
    expect(s.offIsReference).toBe(true);
    expect(s.offReferenceGen).toBe(0);
    expect(s.rows.map((r) => r.off)).toEqual([0.8, 0.8, 0.8]);
    expect(s.rows[2]!.tax).toBeCloseTo(0.2);
  });

  it('ignores other suites and ablation variants, and has no "last" with one generation', () => {
    const s = buildCurveSeries([pt('github', 0, true, 0.4), pt('mobile', 0, true, 0.1), { ...pt('github', 0, true, 0.9), variant: 'random' }], 'github');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.on).toBe(0.4);
    expect(s.rows[0]!.off).toBeNull();
    expect(s.rows[0]!.tax).toBeNull();
    expect(s.last).toBeNull();
  });

  it('calls a gain significant only when the CIs do not overlap', () => {
    const sig = buildCurveSeries([pt('g', 0, true, 0.4), pt('g', 5, true, 0.75)], 'g');
    expect(gainIsSignificant(sig)).toBe(true);
    const close = buildCurveSeries([pt('g', 0, true, 0.4), pt('g', 5, true, 0.48)], 'g');
    expect(gainIsSignificant(close)).toBe(false);
  });

  it('orders suites github, mobile, then the rest', () => {
    expect(curveSuites([pt('zeta', 0, true, 1), pt('mobile', 0, true, 1), pt('github', 0, true, 1)])).toEqual(['github', 'mobile', 'zeta']);
  });
});

describe('buildHeatMatrix', () => {
  const cells: HeatCell[] = [
    { faultType: 'timeout', tool: 'github.list_issues', injected: 10, recovered: 9 },
    { faultType: 'rate_limit', tool: 'github.list_issues', injected: 20, recovered: 19 },
    { faultType: 'timeout', tool: 'mobile.tap', injected: 4, recovered: 1 },
    { faultType: 'timeout', tool: 'github.list_issues', injected: 2, recovered: 1 },
  ];
  const m = buildHeatMatrix(cells);

  it('merges duplicate cells and computes rates', () => {
    expect(m.get('timeout', 'github.list_issues')).toEqual({ injected: 12, recovered: 10, rate: 10 / 12 });
    expect(m.get('rate_limit', 'mobile.tap')).toEqual({ injected: 0, recovered: 0, rate: null });
  });

  it('orders fault rows by volume and tool columns by upstream', () => {
    expect(m.faultTypes).toEqual(['rate_limit', 'timeout']);
    expect(m.tools).toEqual(['github.list_issues', 'mobile.tap']);
  });

  it('totals rows, columns and everything', () => {
    expect(m.rowTotals.get('timeout')).toEqual({ injected: 16, recovered: 11, rate: 11 / 16 });
    expect(m.colTotals.get('mobile.tap')?.rate).toBe(0.25);
    expect(m.total.injected).toBe(36);
    expect(m.total.recovered).toBe(30);
  });

  it('handles an empty heatmap', () => {
    const e = buildHeatMatrix([]);
    expect(e.faultTypes).toEqual([]);
    expect(e.total.rate).toBeNull();
  });

  it('splits tool names on the usual separators', () => {
    expect(splitTool('github.list_issues')).toEqual({ upstream: 'github', name: 'list_issues' });
    expect(splitTool('github__get_pr')).toEqual({ upstream: 'github', name: 'get_pr' });
    expect(splitTool('mobile_take_screenshot')).toEqual({ upstream: '', name: 'mobile_take_screenshot' });
  });
});

describe('feedReducer', () => {
  let id = 0;
  const ev = (e: Omit<StoredEvent, 'id' | 'ts' | 'sessionId'>, ts = '2026-09-23T10:00:00.000Z'): StoredEvent =>
    ({ ...e, id: ++id, ts, sessionId: 'tf1' }) as StoredEvent;
  const injected = (faultId: string, faultType = 'rate_limit') =>
    ev({ kind: 'fault.injected', data: { mcpSessionId: 'm1', tfSessionId: 'tf1', faultId, tool: 'github.list_issues', faultType: faultType as 'rate_limit', profile: 'moderate', manual: false } });

  it('puts new faults on top and resolves them in place', () => {
    let s = feedReducer(initialFeed, { type: 'event', event: injected('a') });
    s = feedReducer(s, { type: 'event', event: injected('b', 'timeout') });
    expect(s.items.map((i) => i.faultId)).toEqual(['b', 'a']);
    expect(s.items[1]!.outcome).toBe('pending');
    s = feedReducer(s, {
      type: 'event',
      event: ev({ kind: 'fault.recovered', data: { mcpSessionId: 'm1', tfSessionId: 'tf1', faultId: 'a', tool: 'github.list_issues', faultType: 'rate_limit', steps: 2, ms: 1500 } }),
    });
    s = feedReducer(s, {
      type: 'event',
      event: ev({ kind: 'fault.unrecovered', data: { mcpSessionId: 'm1', tfSessionId: 'tf1', faultId: 'b', tool: 'github.list_issues', faultType: 'timeout' } }),
    });
    expect(s.items.map((i) => i.faultId)).toEqual(['b', 'a']);
    expect(s.items[1]).toMatchObject({ outcome: 'recovered', steps: 2, ms: 1500, live: true });
    expect(s.items[0]!.outcome).toBe('unrecovered');
    expect(feedCounts(s.items)).toEqual({ injected: 2, recovered: 1, unrecovered: 1, pending: 0 });
  });

  it('ignores replayed events and unrelated kinds', () => {
    const e = injected('x');
    const s1 = feedReducer(initialFeed, { type: 'event', event: e });
    const s2 = feedReducer(s1, { type: 'event', event: e });
    expect(s2).toBe(s1);
    const s3 = feedReducer(s1, { type: 'event', event: ev({ kind: 'chaos.config', data: { enabled: true, profile: 'heavy', faultRate: 0.5 } }) });
    expect(s3.items).toBe(s1.items);
  });

  it('seeds from /api/faults newest first without duplicating streamed items', () => {
    const row = (id: string, at: string, outcome: FaultRow['outcome'] = 'recovered'): FaultRow => ({
      id, tfSessionId: 'tf1', tool: 't', faultType: 'timeout', injectedAt: at,
      recoveredAt: outcome === 'recovered' ? new Date(Date.parse(at) + 2000).toISOString() : null,
      recoverySteps: outcome === 'recovered' ? 1 : null, outcome, manual: false,
    });
    let s = feedReducer(initialFeed, { type: 'event', event: injected('live1') });
    s = feedReducer(s, { type: 'seed', faults: [row('old', '2026-09-23T09:00:00Z'), row('live1', '2026-09-23T08:00:00Z', 'pending'), row('older', '2026-09-23T08:30:00Z', 'unrecovered')] });
    expect(s.items.map((i) => i.faultId)).toEqual(['live1', 'old', 'older']);
    expect(s.items[0]!.live).toBe(true);
    expect(s.items[1]!.ms).toBe(2000);
  });

  it('shows an outcome for a fault that was injected before the page loaded', () => {
    const s = feedReducer(initialFeed, {
      type: 'event',
      event: ev({ kind: 'fault.recovered', data: { mcpSessionId: 'm1', tfSessionId: null, faultId: 'ghost', tool: 't', faultType: 'popup', steps: 1, ms: 900 } }),
    });
    expect(s.items[0]).toMatchObject({ faultId: 'ghost', outcome: 'recovered', session: 'm1' });
  });
});

describe('runs', () => {
  const run = (variant: string, generation: number, seed: number, passed: number, extra: Partial<EvalRunRow> = {}): EvalRunRow => ({
    id: `${variant}-${generation}-${seed}`, benchId: null, suite: 'github', profile: 'moderate', seed, generation, variant, status: 'done',
    startedAt: '2026-09-23T00:00:00Z', finishedAt: '2026-09-23T00:10:00Z',
    summary: { tasks: 10, passed, costUsd: 1, faultsInjected: 20, faultsRecovered: 15 }, ...extra,
  });

  it('groups ablations by variant at their latest generation, relative to full monk', () => {
    const rows = buildAblations([
      run('full', 0, 1, 4), run('full', 5, 1, 8), run('full', 5, 2, 7),
      run('random', 5, 1, 5), run('random', 5, 2, 4),
      run('no_verify', 5, 1, 6, { status: 'running', summary: null }),
      run('full', 5, 3, 9, { profile: 'off' }),
    ]);
    expect(rows.map((r) => r.variant)).toEqual(['full', 'random']);
    expect(rows[0]).toMatchObject({ generation: 5, runs: 2, delta: null });
    expect(rows[0]!.success).toBeCloseTo(0.75);
    expect(rows[1]!.delta).toBeCloseTo(-30);
    expect(rows[1]!.recovery).toBeCloseTo(0.75);
    expect(rows[1]!.costPerSolved).toBeCloseTo(2 / 9);
  });

  it('needs at least two variants to call it an ablation', () => {
    expect(buildAblations([run('full', 5, 1, 8)])).toEqual([]);
  });

  it('routes events to the aggregates they make stale', () => {
    expect(staleBy('skill.committed')).toEqual(['skills', 'state']);
    expect(staleBy('fault.recovered')).toEqual(['heatmap']);
    expect(staleBy('eval.run.done')).toEqual(['runs', 'curve', 'state']);
    expect(staleBy('tool.call')).toEqual([]);
  });
});

describe('spreadLabels', () => {
  it('keeps far-apart labels on their points', () => {
    expect(spreadLabels([10, 100, 200], 20, 0, 300)).toEqual([10, 100, 200]);
  });
  it('pushes colliding labels apart and back inside the bounds', () => {
    const out = spreadLabels([295, 290, 50], 20, 0, 300);
    expect(out[2]).toBe(50);
    expect(Math.abs(out[0]! - out[1]!)).toBeGreaterThanOrEqual(20);
    expect(Math.max(out[0]!, out[1]!)).toBeLessThanOrEqual(300);
  });
});
