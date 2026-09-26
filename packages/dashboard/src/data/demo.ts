// In-memory Monk API for `?demo=1` and for `vite dev` without a server: same ApiClient shape,
// a believable 5-generation curve, and a stream of faults so the page is alive on a projector.
import type {
  ApiClient, ChaosState, CronJobRow, CurvePoint, EvalRunRow, FaultRow, HeatCell, MonkState, SkillDetail, SkillRow,
} from '@monk/shared/api';
import type { FaultType, MonkEvent, StoredEvent } from '@monk/shared/events';
import { API_FAULTS as API_FAULT_TYPES, MOBILE_FAULTS as MOBILE_FAULT_TYPES } from '../lib/faults.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const API_FAULTS: string[] = [...API_FAULT_TYPES];
const MOBILE_FAULTS: string[] = [...MOBILE_FAULT_TYPES];
const GITHUB_TOOLS = ['github.list_issues', 'github.get_pull_request', 'github.search_code', 'github.create_issue', 'github.list_pull_requests', 'github.add_comment'];
const MOBILE_TOOLS = ['mobile.launch_app', 'mobile.tap', 'mobile.list_elements'];

/** How well monk recovers from each fault by now; drives the heatmap and the live stream. */
const RECOVERY: Record<string, number> = {
  timeout: 0.91, rate_limit: 0.96, server_error: 0.84, malformed_json: 0.72, schema_drift: 0.52, auth_expired: 0.8,
  permission_denied: 0.34, stale_data: 0.61, partial_result: 0.74, latency_spike: 0.98,
  app_crash: 0.79, permission_dialog: 0.93, popup: 0.9, element_not_found: 0.57, slow_network: 0.88, orientation_flip: 0.66,
};
const TOOL_EASE: Record<string, number> = {
  'github.create_issue': -0.12, 'github.add_comment': -0.08, 'github.search_code': 0.03, 'mobile.tap': -0.06,
};

const PROFILES = ['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile'];
const SESSIONS = ['tf_sess_8c21e4', 'tf_sess_19ab07', 'tf_sess_d3f5c2', 'tf_sess_7e6a90', 'tf_sess_b41d28'];

type SkillSeed = [name: string, type: SkillRow['type'], desc: string, faults: string[], tools: string[], gen: number, version: number, uses: number, wins: number, status?: SkillRow['status']];

const SKILL_SEEDS: SkillSeed[] = [
  ['github-rate-limit-recovery', 'recovery', 'Back off on 429, batch the remaining reads, resume where it stopped.', ['rate_limit'], ['github.list_issues', 'github.get_pull_request'], 1, 3, 41, 39],
  ['timeout-retry-idempotent', 'recovery', 'Retry timed-out reads with backoff; re-check state before retrying writes.', ['timeout', 'latency_spike'], ['github.search_code', 'github.list_pull_requests'], 1, 2, 36, 33],
  ['malformed-json-reparse', 'recovery', 'When a tool returns broken JSON, re-request with a smaller page instead of guessing.', ['malformed_json'], ['github.list_issues'], 1, 2, 22, 17],
  ['auth-expired-refresh', 'recovery', 'On 401 mid-task, refresh the token once and replay the last call.', ['auth_expired'], ['github.create_issue', 'github.add_comment'], 2, 1, 14, 12],
  ['schema-drift-field-remap', 'recovery', 'Map renamed fields (labels → label_names) before failing the task.', ['schema_drift'], ['github.get_pull_request'], 2, 2, 11, 6],
  ['stale-data-refetch', 'recovery', 'Refetch before writing when data is older than the last write.', ['stale_data'], ['github.list_pull_requests'], 3, 1, 9, 6],
  ['partial-result-paginate', 'recovery', 'Treat short pages as partial: follow the cursor until the count matches.', ['partial_result'], ['github.search_code'], 3, 1, 12, 9],
  ['android-popup-dismiss', 'recovery', 'Dismiss rating and promo popups by their close element, never by tapping blind.', ['popup'], ['mobile.tap'], 2, 2, 18, 17],
  ['android-app-crash-relaunch', 'recovery', 'Relaunch the app, wait for the first screen, replay the last two steps.', ['app_crash'], ['mobile.launch_app'], 2, 1, 10, 8],
  ['permission-dialog-allow', 'recovery', 'Allow only the permission the task needs; deny the rest.', ['permission_dialog'], ['mobile.tap'], 3, 1, 8, 8],
  ['element-not-found-rescroll', 'recovery', 'Scroll and re-list elements before deciding a control is missing.', ['element_not_found'], ['mobile.list_elements'], 4, 1, 6, 4],
  ['github-release-notes-from-prs', 'procedure', 'Draft release notes from merged PRs since the last tag, grouped by label.', [], ['github.list_pull_requests'], 3, 1, 5, 5],
  ['gradle-offline-cache', 'procedure', 'Warm the Gradle cache in the sandbox so rebuilds survive slow networks.', ['slow_network'], [], 4, 1, 4, 4],
  ['github-search-quoted-labels', 'tool_quirk', 'search_code needs label names with spaces quoted, or it silently returns nothing.', [], ['github.search_code'], 4, 1, 7, 6],
  ['latency-spike-hammer-retry', 'recovery', 'Retry immediately on slow responses.', ['latency_spike'], ['github.list_issues'], 1, 2, 13, 4, 'retired'],
  ['server-error-skip-step', 'recovery', 'Skip the failing step on 5xx and continue.', ['server_error'], ['github.create_issue'], 2, 1, 9, 3, 'retired'],
];

const NEW_SKILLS: SkillSeed[] = [
  ['orientation-flip-relock', 'recovery', 'Lock portrait and re-list elements after an orientation change.', ['orientation_flip'], ['mobile.tap'], 5, 1, 0, 0],
  ['permission-denied-ask-owner', 'recovery', 'On 403, stop and ask for access instead of trying other endpoints.', ['permission_denied'], ['github.add_comment'], 5, 1, 0, 0],
  ['server-error-backoff-then-verify', 'recovery', 'Back off on 5xx, then confirm the write did not land before retrying.', ['server_error'], ['github.create_issue'], 5, 1, 0, 0],
];

function sha(r: () => number): string {
  return Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
}

function skillMarkdown(s: SkillRow): string {
  const when = s.faultTypes.length
    ? `a ${s.tools.join(' or ') || 'tool'} call fails with ${s.faultTypes.map((f) => `\`${f}\``).join(' or ')}`
    : `the task matches: ${s.description.toLowerCase()}`;
  return `---
name: ${s.name}
description: ${s.description}
type: ${s.type}
version: ${s.version}
fault_types: [${s.faultTypes.join(', ')}]
tools: [${s.tools.join(', ')}]
learned_in: generation ${s.generation}
---

# ${s.name}

## When to use
Use when ${when}.

## Steps
1. Read the error; confirm it matches ${s.faultTypes[0] ? `\`${s.faultTypes[0]}\`` : 'this task'} and not a real bug.
2. ${s.description}
3. Re-run the original call with the same arguments.
4. Check the result is complete before moving on (counts, cursor, status).
5. If it fails twice, stop and report what happened in plain words.

## Don't
- Don't retry writes blindly; check whether the first attempt landed.
- Don't skip approval for anything destructive, even under chaos.

## Evidence
- Baseline pass without skill: ${Math.max(1, Math.round(s.uses * 0.35))}/${Math.max(3, s.uses)}
- Pass with skill: ${s.wins}/${Math.max(1, s.uses)}
`;
}

export function createDemoClient(opts: { speed?: number } = {}): ApiClient {
  const speed = opts.speed ?? 1;
  const r = rng(42);
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();

  // ── curve ──
  const curve: CurvePoint[] = [];
  const suites: Record<string, { on: number[]; off: number[] | number; held: number[]; steps: number[]; cost: number[]; rec: number[] }> = {
    github: {
      on: [0.4, 0.56, 0.66, 0.71, 0.74, 0.76],
      off: [0.87, 0.86, 0.88, 0.87, 0.89, 0.88],
      held: [0.33, 0.47, 0.57, 0.63, 0.67, 0.7],
      steps: [4.1, 3.3, 2.8, 2.6, 2.4, 2.3],
      cost: [0.21, 0.17, 0.14, 0.13, 0.12, 0.11],
      rec: [0.52, 0.66, 0.75, 0.8, 0.83, 0.85],
    },
    mobile: {
      on: [0.33, 0.44, 0.55, 0.61, 0.66, 0.68],
      off: 0.83,
      held: [0.25, 0.36, 0.47, 0.53, 0.58, 0.6],
      steps: [5.2, 4.4, 3.7, 3.3, 3.1, 3.0],
      cost: [0.34, 0.29, 0.24, 0.22, 0.2, 0.19],
      rec: [0.45, 0.58, 0.68, 0.73, 0.76, 0.78],
    },
  };
  for (const [suite, s] of Object.entries(suites)) {
    s.on.forEach((m, g) => {
      const w = 0.1 - g * 0.009;
      curve.push({
        suite, variant: 'full', generation: g, chaos: true, seeds: 3,
        successRate: { mean: m, lo: Math.max(0, m - w), hi: Math.min(1, m + w * 0.9) },
        recoveryRate: { mean: s.rec[g]!, lo: s.rec[g]! - 0.06, hi: s.rec[g]! + 0.05 },
        stepsToRecover: s.steps[g]!, costPerSolved: s.cost[g]!, heldOutSuccess: s.held[g]!,
      });
      const off = Array.isArray(s.off) ? s.off[g] : g === 0 ? s.off : undefined;
      if (off !== undefined)
        curve.push({
          suite, variant: 'full', generation: g, chaos: false, seeds: 1,
          successRate: { mean: off, lo: off - 0.04, hi: Math.min(1, off + 0.04) },
          recoveryRate: { mean: 0, lo: 0, hi: 0 }, stepsToRecover: null, costPerSolved: s.cost[g]! * 0.8, heldOutSuccess: null,
        });
    });
  }

  // ── runs (bench + ablations), oldest first ──
  const runs: EvalRunRow[] = [];
  let t = now - 26 * 3600_000;
  let runN = 0;
  const addRun = (suite: string, gen: number, seed: number, variant: string, profile: string, success: number, tasks: number, steps: number, costPerTask: number) => {
    const noise = (r() - 0.5) * 0.08;
    const s = Math.min(1, Math.max(0, success + noise));
    const passed = Math.round(s * tasks);
    const inj = profile === 'off' ? 0 : Math.round(tasks * 2.4 + r() * 4);
    const rec = Math.round(inj * Math.min(0.97, 0.45 + s * 0.5));
    const cost = +(tasks * costPerTask * (0.9 + r() * 0.25)).toFixed(3);
    const tokens = Math.round(cost / 0.00000042);
    const start = t;
    t += (9 + r() * 6) * 60_000;
    runs.push({
      id: `run_${(++runN).toString(36).padStart(4, '0')}`, benchId: variant === 'full' ? 'bench_0923a' : 'ablate_0923b',
      suite, profile, seed, generation: gen, variant, status: 'done', startedAt: iso(start), finishedAt: iso(t),
      summary: {
        tasks, passed, successRate: passed / tasks, faultsInjected: inj, faultsRecovered: rec, recoveryRate: inj ? rec / inj : 0,
        stepsToRecover: steps, costUsd: cost, inputTokens: Math.round(tokens * 0.82), outputTokens: Math.round(tokens * 0.18),
      },
    });
  };
  for (let g = 0; g <= 5; g++) {
    for (const suite of ['github', 'mobile'] as const) {
      const s = suites[suite]!;
      const tasks = suite === 'github' ? 10 : 6;
      for (const seed of [42, 7, 1337]) addRun(suite, g, seed, 'full', 'moderate', s.on[g]!, tasks, s.steps[g]!, s.cost[g]! * s.on[g]!);
      if (suite === 'github' || g === 0) addRun(suite, g, 42, 'full', 'off', Array.isArray(s.off) ? s.off[g]! : s.off, tasks, 0, s.cost[g]! * 0.7);
    }
  }
  const ablations: [string, number, number][] = [['no_verify', 0.61, 2.9], ['chaos_off_learning', 0.58, 3.1], ['random', 0.44, 3.8], ['no_retire', 0.7, 2.5]];
  for (const [variant, success, steps] of ablations)
    for (const seed of [42, 7, 1337]) addRun('github', 5, seed, variant, 'moderate', success, 10, steps, 0.12 * success);

  // ── skills ──
  const skills = new Map<string, SkillDetail>();
  const addSkill = (s: SkillSeed, updatedAt: number) => {
    const [name, type, description, faultTypes, tools, generation, version, uses, wins, status] = s;
    const row: SkillRow = {
      name, type, description, version, verified: status !== 'draft', status: status ?? 'active', uses, wins,
      winRate: uses ? wins / uses : null, faultTypes, tools, generation, updatedAt: iso(updatedAt),
    };
    const history = Array.from({ length: version + (status === 'retired' ? 1 : 0) }, (_, i) => {
      const retiring = status === 'retired' && i === version;
      return {
        sha: sha(r),
        date: iso(updatedAt - (version - i) * 5 * 3600_000),
        message: retiring ? `retire ${name}: win rate ${Math.round((wins / uses) * 100)}% over last ${uses} uses`
          : i === 0 ? `learn ${name} from ${1 + Math.floor(r() * 3)} recoveries (gen ${generation})`
          : `update ${name} v${i + 1}: tighter trigger, fewer steps`,
      };
    }).reverse();
    skills.set(name, {
      ...row, body: '', markdown: '', history,
      verification: { baselinePass: Math.round(uses * 0.35), withSkillPass: wins, baselineSteps: 4.2, withSkillSteps: 2.1, sandbox: 'daytona' },
    });
    const d = skills.get(name)!;
    d.markdown = skillMarkdown(row);
    d.body = d.markdown.split('---\n').slice(2).join('---\n');
  };
  SKILL_SEEDS.forEach((s, i) => addSkill(s, now - (SKILL_SEEDS.length - i) * 2.4 * 3600_000));

  // ── faults + heatmap ──
  const faults: FaultRow[] = [];
  const heat = new Map<string, HeatCell>();
  const bumpHeat = (faultType: string, tool: string, recovered: boolean, injected = true) => {
    const k = `${faultType}|${tool}`;
    const c = heat.get(k) ?? { faultType, tool, injected: 0, recovered: 0 };
    if (injected) c.injected++;
    if (recovered) c.recovered++;
    heat.set(k, c);
  };
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const pickFault = (): { faultType: string; tool: string } => {
    if (r() < 0.68) return { faultType: pick(API_FAULTS), tool: pick(GITHUB_TOOLS) };
    return r() < 0.8 ? { faultType: pick(MOBILE_FAULTS), tool: pick(MOBILE_TOOLS) } : { faultType: pick(['timeout', 'latency_spike']), tool: pick(MOBILE_TOOLS) };
  };
  const recoverChance = (faultType: string, tool: string) => Math.min(0.99, (RECOVERY[faultType] ?? 0.7) + (TOOL_EASE[tool] ?? 0));
  // Historic volume for the heatmap.
  for (let i = 0; i < 900; i++) {
    const { faultType, tool } = pickFault();
    bumpHeat(faultType, tool, r() < recoverChance(faultType, tool));
  }
  for (let i = 0; i < 28; i++) {
    const { faultType, tool } = pickFault();
    const at = now - (28 - i) * 47_000 - r() * 20_000;
    const ok = r() < recoverChance(faultType, tool);
    const st = 1 + Math.floor(r() * 4);
    faults.push({
      id: `flt_${i.toString(36)}_${Math.floor(r() * 1e6).toString(36)}`, tfSessionId: pick(SESSIONS), tool, faultType,
      injectedAt: iso(at), recoveredAt: ok ? iso(at + st * 900 + r() * 3000) : null, recoverySteps: ok ? st : null,
      outcome: ok ? 'recovered' : 'unrecovered', manual: false,
    });
  }

  const chaos: ChaosState = { enabled: true, profile: 'moderate', faultRate: 0.2, seed: 42, profiles: PROFILES, pending: [] };
  const state: MonkState = {
    chaos, generation: 5, model: 'deepseek-v3.2', agent: 'monk', costTodayUsd: 3.84,
    skills: { active: [...skills.values()].filter((s) => s.status === 'active').length, newToday: 0 },
  };
  const cron: CronJobRow[] = [
    { id: 'cron_1', name: 'nightly chaos drill', schedule: '0 2 * * *', timezone: 'Asia/Kolkata', prompt: 'run the github suite under pressure', kind: 'chaos_drill', deliverTo: { platform: 'telegram', chatId: '42' }, chaosProfile: 'pressure', enabled: true, lastRun: iso(now - 20 * 3600_000), lastStatus: 'ok', nextRun: iso(now + 4 * 3600_000) },
  ];

  // ── event log + stream ──
  const log: StoredEvent[] = [];
  const subs = new Set<(e: StoredEvent) => void>();
  let eventId = 5000;
  const emit = (ev: MonkEvent) => {
    const d = ev.data as Record<string, unknown>;
    const sessionId = (typeof d.tfSessionId === 'string' ? d.tfSessionId : typeof d.mcpSessionId === 'string' ? d.mcpSessionId : null);
    const stored = { ...ev, id: ++eventId, ts: new Date().toISOString(), sessionId } as StoredEvent;
    log.push(stored);
    if (log.length > 2000) log.shift();
    for (const s of subs) s(stored);
  };
  const clone = <T,>(x: T): T => structuredClone(x);
  const later = (ms: number, fn: () => void) => setTimeout(fn, ms / speed);

  let faultN = 0;
  const injectFault = (faultType: string, tool: string, manual: boolean, tf?: string) => {
    const faultId = `flt_live_${(++faultN).toString(36)}`;
    const tfSessionId = tf ?? pick(SESSIONS);
    const mcpSessionId = `mcp_${tfSessionId.slice(-6)}`;
    const at = new Date().toISOString();
    faults.unshift({ id: faultId, tfSessionId, tool, faultType, injectedAt: at, recoveredAt: null, recoverySteps: null, outcome: 'pending', manual });
    bumpHeat(faultType, tool, false);
    emit({ kind: 'fault.injected', data: { mcpSessionId, tfSessionId, faultId, tool, faultType: faultType as FaultType, profile: chaos.profile, manual } });
    const ok = r() < recoverChance(faultType, tool);
    const st = 1 + Math.floor(r() * 3);
    const ms = 700 + st * 900 + r() * 1800;
    later(ms, () => {
      const f = faults.find((x) => x.id === faultId);
      if (f) Object.assign(f, ok ? { outcome: 'recovered', recoveredAt: new Date().toISOString(), recoverySteps: st } : { outcome: 'unrecovered' });
      if (ok) {
        bumpHeat(faultType, tool, true, false);
        const skill = [...skills.values()].find((s) => s.status === 'active' && s.faultTypes.includes(faultType));
        if (skill) {
          skill.uses++;
          skill.wins++;
          skill.winRate = skill.wins / skill.uses;
          emit({ kind: 'skill.used', data: { name: skill.name, tfSessionId } });
        }
        emit({ kind: 'fault.recovered', data: { mcpSessionId, tfSessionId, faultId, tool, faultType: faultType as FaultType, steps: st, ms: Math.round(ms) } });
      } else {
        emit({ kind: 'fault.unrecovered', data: { mcpSessionId, tfSessionId, faultId, tool, faultType: faultType as FaultType } });
      }
      const inTok = 1800 + Math.floor(r() * 5000);
      const outTok = 200 + Math.floor(r() * 700);
      const costUsd = +(inTok * 0.00000027 + outTok * 0.0000011).toFixed(5);
      state.costTodayUsd += costUsd;
      emit({ kind: 'session.cost', data: { tfSessionId, inputTokens: inTok, outputTokens: outTok, costUsd } });
    });
  };

  let started = false;
  let newSkillIdx = 0;
  const startStream = () => {
    if (started) return;
    started = true;
    const tick = () => {
      if (chaos.enabled && chaos.profile !== 'off') {
        const { faultType, tool } = pickFault();
        injectFault(faultType, tool, false);
      }
      later(2600 + r() * 2600 * (0.2 / Math.max(0.05, chaos.faultRate)), tick);
    };
    later(1200, tick);
    const learn = () => {
      const s = NEW_SKILLS[newSkillIdx++];
      if (!s) return;
      emit({ kind: 'skill.drafted', data: { name: s[0], type: s[1], sourceSessions: [pick(SESSIONS)] } });
      later(3500, () => {
        emit({ kind: 'skill.verified', data: { name: s[0], kept: true, baselinePass: 1, withSkillPass: 3, baselineSteps: 5, withSkillSteps: 2 } });
        addSkill(s, Date.now());
        state.skills.active++;
        state.skills.newToday++;
        emit({ kind: 'skill.committed', data: { name: s[0], version: 1, commitSha: sha(r) } });
      });
      later(40_000, learn);
    };
    later(9000, learn);
  };

  const delay = <T,>(v: T): Promise<T> => new Promise((res) => setTimeout(() => res(clone(v)), 60 + r() * 120));

  const client: ApiClient = {
    state: () => delay(state),
    events: (after = 0, limit = 200) => delay(log.filter((e) => e.id > after).slice(0, limit)),
    skills: () => delay([...skills.values()].map(({ body: _b, markdown: _m, history: _h, verification: _v, ...row }) => row)),
    skill: (name) => {
      const s = skills.get(name);
      return s ? delay(s) : Promise.reject(new Error(`GET /api/skills/${name} -> 404: not found`));
    },
    faults: (tfSessionId, limit = 100) => delay(faults.filter((f) => !tfSessionId || f.tfSessionId === tfSessionId).slice(0, limit)),
    heatmap: () => delay([...heat.values()]),
    runs: () => delay(runs),
    curve: () => delay(curve),
    cron: () => delay(cron),
    setChaos: (patch) => {
      Object.assign(chaos, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      if (patch.profile === 'off') chaos.enabled = false;
      else if (patch.profile) chaos.enabled = true;
      emit({ kind: 'chaos.config', data: { enabled: chaos.enabled, profile: chaos.profile, faultRate: chaos.faultRate } });
      return delay(chaos);
    },
    inject: (req) => {
      const tool = req.tool ?? (MOBILE_FAULTS.includes(req.fault) ? pick(MOBILE_TOOLS) : pick(GITHUB_TOOLS));
      chaos.pending.push({ fault: req.fault, tool: req.tool ?? null, mcpSessionId: null });
      later(900, () => {
        chaos.pending.shift();
        injectFault(req.fault, tool, true, req.tfSessionId);
      });
      return delay(chaos);
    },
    startBench: (req) => {
      const benchId = `bench_${Date.now().toString(36)}`;
      const suite = req.suite.split(',')[0] ?? 'github';
      const id = `run_live_${Date.now().toString(36)}`;
      const run: EvalRunRow = {
        id, benchId, suite, profile: req.profile, seed: 42, generation: state.generation, variant: 'full', status: 'running',
        startedAt: new Date().toISOString(), finishedAt: null, summary: null,
      };
      runs.push(run);
      emit({ kind: 'eval.run.started', data: { runId: id, benchId, suite, profile: req.profile, seed: 42, generation: state.generation, variant: 'full', tasks: 10 } });
      later(14_000, () => {
        const summary = { tasks: 10, passed: 8, successRate: 0.8, faultsInjected: 24, faultsRecovered: 21, recoveryRate: 0.875, stepsToRecover: 2.2, costUsd: 1.08, inputTokens: 2_100_000, outputTokens: 460_000 };
        Object.assign(run, { status: 'done', finishedAt: new Date().toISOString(), summary });
        state.costTodayUsd += 1.08;
        emit({ kind: 'eval.run.done', data: { runId: id, summary } });
      });
      return delay({ benchId });
    },
    linkSession: () => delay({ ok: true as const }),
    reportCost: () => delay({ ok: true as const }),
    subscribe(onEvent, o = {}) {
      startStream();
      const after = o.after ?? 0;
      for (const e of log) if (e.id > after) onEvent(e);
      subs.add(onEvent);
      return () => {
        subs.delete(onEvent);
      };
    },
  };
  return client;
}
