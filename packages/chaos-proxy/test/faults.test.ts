import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ALL_FAULT_TYPES, FAULT_TYPES, MOBILE_FAULT_TYPES, type FaultType } from '@monk/shared';
import { describe, expect, it, vi } from 'vitest';
import { decide, draws, rng } from '../src/decide.ts';
import type { Device } from '../src/device.ts';
import { injectFault, schemaDrift, truncateList, type FaultContext } from '../src/faults.ts';
import { parseProfile } from '../src/profile.ts';
import { ELEMENTS, ISSUES } from './helpers.ts';

const textOf = (r: CallToolResult) => (r.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
const issuesResult = (): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(ISSUES) }] });
const elementsResult = (): CallToolResult => ({ content: [{ type: 'text', text: `Found these elements on screen: ${JSON.stringify(ELEMENTS)}` }] });

function ctx(fault: FaultType, over: Partial<FaultContext> = {}): FaultContext & { forward: ReturnType<typeof vi.fn> } {
  const mobile = (MOBILE_FAULT_TYPES as readonly string[]).includes(fault);
  const forward = vi.fn(async () => (mobile ? elementsResult() : issuesResult()));
  return {
    fault,
    tool: mobile ? 'mobile_list_elements_on_screen' : 'list_issues',
    upstream: mobile ? 'mobile' : 'github',
    args: { owner: 'o', repo: 'r' },
    forward,
    previous: null,
    random: rng(1, 0, 'x', 'inject'),
    timeoutMs: 5,
    latencyMs: 5,
    device: null,
    ...over,
  } as FaultContext & { forward: ReturnType<typeof vi.fn> };
}

describe('API fault injectors', () => {
  it.each([
    ['timeout', /timed out/],
    ['rate_limit', /429.*retry_after/],
    ['server_error', /5\d\d/],
    ['auth_expired', /401.*token expired/],
    ['permission_denied', /403.*repos\/o\/r/],
  ] as const)('%s returns an error result without calling upstream', async (fault, re) => {
    const c = ctx(fault);
    const out = await injectFault(c);
    expect(out.result.isError).toBe(true);
    expect(textOf(out.result)).toMatch(re);
    expect(out.forwarded).toBe(false);
    expect(c.forward).not.toHaveBeenCalled();
  });

  it('timeout hangs for timeoutMs', async () => {
    const sleep = vi.fn(async () => {});
    await injectFault(ctx('timeout', { timeoutMs: 1234, sleep }));
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it('latency_spike delays then returns the real result', async () => {
    const sleep = vi.fn(async () => {});
    const out = await injectFault(ctx('latency_spike', { latencyMs: 999, sleep }));
    expect(sleep).toHaveBeenCalledWith(999);
    expect(JSON.parse(textOf(out.result))).toEqual(ISSUES);
    expect(out.forwarded).toBe(true);
  });

  it('malformed_json forwards then returns invalid JSON', async () => {
    const c = ctx('malformed_json');
    const out = await injectFault(c);
    expect(c.forward).toHaveBeenCalledOnce();
    expect(() => JSON.parse(textOf(out.result))).toThrow();
    expect(JSON.stringify(ISSUES).startsWith(textOf(out.result).replace(/,"$/, ''))).toBe(true);
  });

  it('schema_drift renames or removes a field but stays valid JSON', async () => {
    const out = await injectFault(ctx('schema_drift'));
    const body = JSON.parse(textOf(out.result)) as typeof ISSUES;
    const keys = Object.keys(body.items[0]!).sort();
    expect(keys).not.toEqual(Object.keys(ISSUES.items[0]!).sort());
    expect(out.effect).toMatch(/->|removed/);
  });

  it('schemaDrift helper is deterministic for the same draw', () => {
    const a = schemaDrift(ISSUES, rng(3, 1, 't', 's'));
    const b = schemaDrift(ISSUES, rng(3, 1, 't', 's'));
    expect(a).toEqual(b);
  });

  it('stale_data replays the previous response', async () => {
    const previous: CallToolResult = { content: [{ type: 'text', text: '{"old":true}' }] };
    const c = ctx('stale_data', { previous });
    const out = await injectFault(c);
    expect(textOf(out.result)).toBe('{"old":true}');
    expect(c.forward).not.toHaveBeenCalled();
  });

  it('partial_result cuts the list and drops the cursor', async () => {
    const out = await injectFault(ctx('partial_result'));
    const body = JSON.parse(textOf(out.result)) as Record<string, unknown>;
    expect((body.items as unknown[]).length).toBe(2);
    expect(body).not.toHaveProperty('next_cursor');
    expect(truncateList({ data: { nodes: [1, 2, 3], pageInfo: { hasNextPage: true, endCursor: 'x' } } })?.value).toEqual({
      data: { nodes: [1, 2], pageInfo: { hasNextPage: false } },
    });
  });
});

describe('mobile fault injectors', () => {
  const els = (r: CallToolResult) => {
    const first = r.content?.[0];
    const t = first?.type === 'text' ? first.text : '';
    return JSON.parse(t.slice(t.indexOf('['))) as Record<string, unknown>[];
  };

  it('app_crash (simulated) returns an error mentioning the home screen', async () => {
    const out = await injectFault(ctx('app_crash'));
    expect(out.result.isError).toBe(true);
    expect(textOf(out.result)).toMatch(/home screen/);
    expect(out.effect).toBe('simulated crash');
  });

  it('app_crash force-stops the foreground app on a real device', async () => {
    const device: Device = {
      foregroundApp: vi.fn(async () => 'com.android.settings'),
      forceStop: vi.fn(async () => {}),
      home: vi.fn(async () => {}),
      setRotation: vi.fn(async () => {}),
      getRotation: vi.fn(async () => 0),
      screenshot: vi.fn(async () => Buffer.from('')),
      install: vi.fn(async () => 'Success'),
    };
    const out = await injectFault(ctx('app_crash', { device }));
    expect(device.forceStop).toHaveBeenCalledWith('com.android.settings');
    expect(device.home).toHaveBeenCalled();
    expect(textOf(out.result)).toMatch(/com.android.settings has stopped/);

    await injectFault(ctx('orientation_flip', { device }));
    expect(device.setRotation).toHaveBeenCalledWith(1);
  });

  it.each(['permission_dialog', 'popup'] as const)('%s inserts a dialog into the element tree', async (fault) => {
    const out = await injectFault(ctx(fault));
    const list = els(out.result);
    expect(list.length).toBeGreaterThan(ELEMENTS.length);
    expect(list.some((e) => e.type === 'android.widget.Button')).toBe(true);
    expect(textOf(out.result).startsWith('Found these elements on screen: ')).toBe(true);
  });

  it('element_not_found drops one element from a list, or rejects an action', async () => {
    const out = await injectFault(ctx('element_not_found'));
    expect(els(out.result)).toHaveLength(ELEMENTS.length - 1);
    const click = ctx('element_not_found', { tool: 'mobile_click_on_screen_at_coordinates' });
    const out2 = await injectFault(click);
    expect(out2.result.isError).toBe(true);
    expect(click.forward).not.toHaveBeenCalled();
  });

  it('slow_network shows only a spinner', async () => {
    const out = await injectFault(ctx('slow_network'));
    expect(els(out.result)).toEqual([expect.objectContaining({ type: 'android.widget.ProgressBar' })]);
  });

  it('orientation_flip (simulated) swaps coordinates and says so', async () => {
    const out = await injectFault(ctx('orientation_flip'));
    const first = els(out.result)[0]!.coordinates as Record<string, number>;
    expect(first).toEqual({ x: 20, y: 10, width: 60, height: 300 });
    expect(textOf(out.result)).toMatch(/landscape/);
  });

  it('every fault type has an injector', async () => {
    for (const f of ALL_FAULT_TYPES) {
      const out = await injectFault(ctx(f, { previous: issuesResult() }));
      expect(out.result.content?.length, f).toBeGreaterThan(0);
    }
  });
});

describe('decide', () => {
  const profile = parseProfile(
    `name: t\nseed: 1\nfault_rate: 0.5\nfaults: {${FAULT_TYPES.map((f) => `${f}: 1`).join(', ')}, popup: 1}\nmax_faults_per_session: 100\n`,
  );
  const run = (seed: number) =>
    Array.from({ length: 60 }, (_, index) => decide({ profile, seed, faultRate: 0.5, index, tool: index % 2 ? 'list_issues' : 'get_issue', mobile: false, faultsSoFar: 0 }));

  it('depends only on seed, index and tool', () => {
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
    expect(draws(1, 3, 'a')).toEqual(draws(1, 3, 'a'));
    expect(draws(1, 3, 'a')).not.toEqual(draws(1, 3, 'b'));
  });

  it('roughly honours the fault rate and never picks mobile faults for API tools', () => {
    const faults = run(5).filter(Boolean);
    expect(faults.length).toBeGreaterThan(15);
    expect(faults.length).toBeLessThan(45);
    expect(faults).not.toContain('popup');
  });

  it('respects protect, max faults and exclusions', () => {
    const base = { profile, seed: 1, faultRate: 1, index: 0, mobile: false, faultsSoFar: 0 };
    expect(decide({ ...base, tool: 'delete_branch' })).toBeNull();
    expect(decide({ ...base, tool: 'list_issues', faultsSoFar: 100 })).toBeNull();
    for (let i = 0; i < 30; i++) expect(decide({ ...base, index: i, tool: 'x', exclude: ['stale_data'] })).not.toBe('stale_data');
    expect(decide({ ...base, tool: 'mobile_click', mobile: true })).toBe('popup');
  });
});
