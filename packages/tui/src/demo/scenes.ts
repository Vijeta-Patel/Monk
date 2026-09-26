// Demo data for every screen, built by replaying events through the real reducer. The snapshot
// harness renders these at 120×36 and 80×24 and diffs them against the design mockups; demo mode
// plays them as one story.
import type { StoredEvent } from '@monk/shared/events';
import type { TurnEvent } from '@monk/shared/trueforge';
import type { Action, Extra } from '../state/actions.ts';
import { initialState, reduce } from '../state/reducer.ts';
import type { AppState, PlanStep, SkillInfo, SkillPreview } from '../state/types.ts';
import { demoPhoneFrame } from './phone.ts';

export const T0 = 1_750_000_000_000;
export const sec = (s: number) => T0 + Math.round(s * 1000);

let evSeq = 0;
function stored(kind: StoredEvent['kind'], data: Record<string, unknown>): StoredEvent {
  evSeq += 1;
  return { id: evSeq, ts: '', sessionId: null, kind, data } as StoredEvent;
}

/** Tiny DSL: every helper returns an Action stamped at `at` seconds. */
export const E = {
  send: (at: number, text: string): Action => ({ type: 'send', text, at: sec(at) }),
  turn: (at: number, ev: TurnEvent): Action => ({ type: 'turn', ev, at: sec(at) }),
  extra: (at: number, ev: Extra): Action => ({ type: 'extra', ev, at: sec(at) }),
  monk: (at: number, kind: StoredEvent['kind'], data: Record<string, unknown>): Action => ({ type: 'monk', ev: stored(kind, data), at: sec(at) }),
  started: (at: number): Action => E.turn(at, { type: 'turn.started', turnId: 'turn_1' }),
  say: (at: number, content: string): Action => E.turn(at, { type: 'message', threadId: 'main', content }),
  stream: (at: number, delta: string): Action => E.turn(at, { type: 'text', threadId: 'main', delta }),
  helper: (at: number, threadId: string, name: string): Action => E.turn(at, { type: 'subagent.started', threadId, name, input: `You are the ${name}.` }),
  call: (at: number, callId: string, name: string, args: Record<string, unknown>, threadId: string, server: string | null = 'monk-chaos'): Action =>
    E.turn(at, { type: 'tool.call', threadId, callId, name, server, args: JSON.stringify(args) }),
  result: (at: number, callId: string, content: string, isError = false): Action => E.turn(at, { type: 'tool.result', threadId: 'x', callId, name: '', content, isError }),
  fault: (at: number, faultId: string, tool: string, faultType: string): Action =>
    E.monk(at, 'fault.injected', { mcpSessionId: 'mcp_1', tfSessionId: 'sess_demo', faultId, tool, faultType, profile: 'moderate', manual: false }),
  recovered: (at: number, faultId: string, tool: string, faultType: string, steps: number, ms: number): Action =>
    E.monk(at, 'fault.recovered', { mcpSessionId: 'mcp_1', tfSessionId: 'sess_demo', faultId, tool, faultType, steps, ms }),
  used: (at: number, name: string): Action => E.monk(at, 'skill.used', { name, tfSessionId: 'sess_demo' }),
  label: (at: number, callId: string, patch: Omit<Extract<Extra, { kind: 'step.label' }>, 'kind' | 'callId'>): Action => E.extra(at, { kind: 'step.label', callId, ...patch }),
};

export const DEMO_REPO = { owner: 'monk-demo', repo: 'tally' };
export const SHOWCASE_MESSAGE = 'Test PR #12 on the phone before we ship';

export const DEMO_PLAN: PlanStep[] = [
  { label: 'read the PR', owner: 'operator', state: 'done' },
  { label: 'build + test', owner: 'coder', state: 'running' },
  { label: 'try it on the phone', owner: 'phone', state: 'todo' },
  { label: 'report back', owner: 'operator', state: 'todo' },
  { label: 're-test the fix', owner: 'phone', state: 'todo' },
  { label: 'merge + publish', owner: 'operator', state: 'gate' },
];

function skill(name: string, type: SkillInfo['type'], version: number, winRate: number | null, extra: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name,
    type,
    version,
    verified: true,
    checking: false,
    status: 'active',
    winRate,
    uses: winRate === null ? 0 : 10,
    wins: winRate === null ? 0 : Math.round(winRate * 10),
    isNew: false,
    description: '',
    generation: 3,
    ...extra,
  };
}

export const DEMO_SKILLS: SkillInfo[] = [
  skill('android-dismiss-rating-popup', 'recovery', 1, null, { isNew: true, description: 'Use when a rating or promo dialog covers the app.' }),
  skill('android-relaunch-after-crash', 'recovery', 1, null, { isNew: true, verified: false, checking: true, description: 'Use when the app closes mid-task.' }),
  skill('github-rate-limit-recovery', 'recovery', 2, 0.9, { wins: 9, description: 'Use when a GitHub tool returns 429 or "rate limit exceeded".' }),
  skill('android-emulator-install', 'procedure', 3, 0.93),
  skill('gradle-offline-cache', 'procedure', 1, 0.88),
  skill('mobile-permission-grant', 'recovery', 1, 0.83),
  skill('github-pr-qa-report', 'procedure', 2, 0.8),
  skill('mobile-wait-for-spinner', 'recovery', 2, 0.75),
  skill('github-partial-list-cursor', 'recovery', 2, 0.71),
  skill('auth-expired-refresh', 'recovery', 1, 0.7),
  skill('github-search-needs-repo', 'tool_quirk', 1, 1),
  skill('sandbox-apk-handoff', 'procedure', 1, 1),
  skill('github-schema-drift-files', 'recovery', 1, 0.67),
  skill('android-rotation-recoords', 'recovery', 1, 0.6),
  skill('github-retry-immediately', 'recovery', 1, 0.4, { status: 'retired' }),
  skill('popup-press-back', 'recovery', 2, 0.45, { status: 'retired' }),
];

/** The browser lists github-rate-limit-recovery first, then the new ones, then by rank. */
export const BROWSER_ORDER = [
  'github-rate-limit-recovery',
  'android-dismiss-rating-popup',
  'android-relaunch-after-crash',
  'android-emulator-install',
  'gradle-offline-cache',
  'mobile-permission-grant',
  'github-pr-qa-report',
  'mobile-wait-for-spinner',
  'github-partial-list-cursor',
  'auth-expired-refresh',
  'github-search-needs-repo',
  'sandbox-apk-handoff',
  'github-schema-drift-files',
  'android-rotation-recoords',
  'github-retry-immediately',
  'popup-press-back',
];

export const DEMO_PREVIEW: SkillPreview = {
  name: 'github-rate-limit-recovery',
  whenToUse: ['use when a GitHub tool returns 429', 'or "rate limit exceeded"'],
  steps: ['read retry_after from the error;\nif it is missing, wait 20s', 'never retry more than 3 times', 'batch the remaining reads into\none search call when you can'],
  history: [
    { sha: '4e1a9d0', message: 'v2 · merged in batched reads', age: '3d' },
    { sha: 'b72c310', message: 'v1 · verified, 3.1 fewer steps', age: '6d' },
    { sha: '19fe0a2', message: 'v1 · drafted from s_812', age: '6d' },
  ],
  winHistory: [0.4, 0.47, 0.54, 0.69, 0.76, 0.83, 0.83, 0.9],
  learnedFrom: 'sessions s_812, s_847 · fault rate_limit',
  saves: 'saves 3.1 steps per rate_limit on average',
};

const BASE_STATUS: Extra = {
  kind: 'status',
  patch: {
    generation: 3,
    connections: { github: 'ok', sandbox: 'ok', phone: 'ok' },
    api: 'ok',
    trueforge: 'ok',
    channel: 'Telegram',
  },
};

function base(): Action[] {
  return [E.extra(0, BASE_STATUS), E.extra(0, { kind: 'skills', skills: DEMO_SKILLS }), E.extra(0, { kind: 'skill.preview', preview: DEMO_PREVIEW }), E.extra(0, { kind: 'session', id: 'sess_demo' })];
}

export type Scene = { name: string; state: AppState; now: number };

function build(name: string, actions: Action[], nowSec: number, patch?: (s: AppState) => void): Scene {
  let s = initialState(sec(0));
  for (const a of [...base(), ...actions]) s = reduce(s, a);
  s = structuredClone(s);
  patch?.(s);
  return { name, state: s, now: sec(nowSec) };
}

const OPEN = "On it. Six steps: read the PR, build and test it in the sandbox, try it on the phone, report back. I'll stop and ask before merging or publishing.";

function readAndBuild(): Action[] {
  const pr = { ...DEMO_REPO, pull_number: 12 };
  return [
    E.send(0, SHOWCASE_MESSAGE),
    E.started(0.1),
    E.say(0.9, OPEN),
    E.extra(1, { kind: 'plan', steps: DEMO_PLAN.map((p) => ({ ...p, state: p.state === 'gate' ? 'gate' : 'todo' })) }),
    E.helper(1.2, 't_op', 'Operator'),
    E.call(2, 'c1', 'get_pull_request', pr, 't_op'),
    E.result(2.8, 'c1', '{"number":12,"changed_files":6}'),
    E.call(3, 'c2', 'get_pull_request_files', pr, 't_op'),
    E.fault(3.1, 'f_0412', 'get_pull_request_files', 'rate_limit'),
    E.result(3.3, 'c2', '{"error":"429 Too Many Requests · retry_after 12"}', true),
    E.extra(3.3, { kind: 'skill.note', name: 'github-rate-limit-recovery', detail: 'waited 12s, batched reads' }),
    E.used(3.3, 'github-rate-limit-recovery'),
    E.call(3.4, 'c3', 'get_pull_request_files', pr, 't_op'),
    E.result(16, 'c3', '[{"filename":"HabitList.kt"}]'),
    E.recovered(16, 'f_0412', 'get_pull_request_files', 'rate_limit', 2, 12_900),
    E.fault(16.2, 'f_0413', 'list_commits', 'latency_spike'),
    E.recovered(17, 'f_0413', 'list_commits', 'latency_spike', 1, 800),
    E.helper(16.3, 't_cd', 'Coder'),
    E.extra(16.4, { kind: 'skill.loaded', name: 'gradle-offline-cache' }),
    E.extra(16.4, { kind: 'skill.loaded', name: 'android-emulator-install' }),
    E.call(16.5, 'c4', 'exec', { command: './gradlew assembleDebug' }, 't_cd', null),
    E.result(64.7, 'c4', 'BUILD SUCCESSFUL in 47s\napp-release.apk 4.2 MB'),
    E.label(64.7, 'c4', { detail: '4.2 MB apk', detailTone: 'muted' }),
    E.extra(16.5, { kind: 'plan', steps: DEMO_PLAN }),
  ];
}

export function sceneIdle(): Scene {
  return build('MainIdle', [], 0);
}

export function sceneWorking(): Scene {
  return build(
    'MainWorking',
    [
      ...readAndBuild(),
      E.call(51, 'c5', 'exec', { command: './gradlew testDebugUnitTest' }, 't_cd', null),
      E.extra(71, { kind: 'progress', callId: 'c5', done: 31, total: 38, label: 'passed' }),
      E.stream(71.5, "Build is green. 31 of 38 tests passed so far; next I'll install the app on the phone and try the new swipe-to-archive."),
      E.extra(72, { kind: 'status', patch: { costUsd: 0.18 } }),
    ],
    72,
  );
}

export const SANDBOX_LINES = [
  { text: '> Task :app:compileDebugKotlin  UP-TO-DATE', tone: 'muted' as const },
  { text: '> Task :app:testDebugUnitTest', tone: 'muted' as const },
  { text: 'archive_removesFromActive', tone: 'ok' as const },
  { text: 'archive_keepsHistory', tone: 'ok' as const },
  { text: 'undoArchive_restoresOrder', tone: 'ok' as const },
  { text: 'swipe_emitsArchiveEvent', tone: 'ok' as const },
  { text: 'undo_withinWindow', tone: 'ok' as const },
  { text: 'dailyStreak_acrossMidnight', tone: 'ok' as const },
];

export function sceneSandbox(): Scene {
  return build(
    'SandboxRun',
    [
      E.send(0, SHOWCASE_MESSAGE),
      E.started(0.1),
      E.say(0.9, 'Building and testing it in the sandbox first, so nothing runs on your machine.'),
      E.extra(1, { kind: 'plan', steps: DEMO_PLAN }),
      E.helper(1.2, 't_cd', 'Coder'),
      E.used(1.3, 'gradle-offline-cache'),
      E.extra(1.3, { kind: 'skill.loaded', name: 'android-emulator-install' }),
      E.call(2.8, 'c4', 'exec', { command: './gradlew assembleDebug' }, 't_cd', null),
      E.result(51, 'c4', 'BUILD SUCCESSFUL'),
      E.label(51, 'c4', { detail: '4.2 MB apk', detailTone: 'muted' }),
      E.call(51, 'c5', 'exec', { command: './gradlew testDebugUnitTest' }, 't_cd', null),
      E.extra(51, { kind: 'sandbox.start', callId: 'c5', where: 'daytona · /work/tally', command: './gradlew testDebugUnitTest', testsTotal: 38 }),
      ...SANDBOX_LINES.map((line, i) => E.extra(52 + i, { kind: 'sandbox.line', callId: 'c5', line })),
      E.extra(71, { kind: 'sandbox.stats', callId: 'c5', cpu: '2 cpu · 4 GB' }),
      E.extra(72, { kind: 'status', patch: { costUsd: 0.18, faults: 2, recovered: 2 } }),
    ],
    72,
    (s) => {
      const step = s.items.find((it) => it.kind === 'step' && it.callId === 'c5');
      if (step?.kind === 'step' && step.run) {
        step.run.testsPassed = 31;
        s.ui.wellOpen = step.id;
        s.ui.focus = 'well';
      }
      s.turn.startedAt = sec(0);
    },
  );
}

function phoneSteps(from: number): Action[] {
  return [
    E.helper(from, 't_ph', 'Phone'),
    E.call(from + 0.1, 'p1', 'install_apk', { sandbox_id: 'sbx_1', path: 'app/build/outputs/apk/release/app-release.apk' }, 't_ph'),
    E.result(from + 2.5, 'p1', 'installed'),
    E.label(from + 2.5, 'p1', { done: 'copied the apk from the sandbox to the phone' }),
    E.call(from + 2.6, 'p2', 'mobile_install_app', { path: '/tmp/app-release.apk' }, 't_ph'),
    E.result(from + 6.4, 'p2', 'ok'),
    E.label(from + 6.4, 'p2', { done: 'installed Tally 1.3.0' }),
  ];
}

export const OVERLAP = { label: 'snackbar', topY: 2262, barY: 2274, bottomY: 2318, hiddenPx: 44, button: 'UNDO', text: 'Archived "Read 20 min"' };

export function scenePhone(): Scene {
  return build(
    'PhoneView',
    [
      E.send(0, SHOWCASE_MESSAGE),
      E.started(0.1),
      E.extra(0.2, { kind: 'milestone', text: 'read PR #12, built and tested it in the sandbox (38/38)' }),
      E.extra(0.2, { kind: 'phone.device', device: 'Pixel 7', api: 34, screenW: 1080, screenH: 2400 }),
      ...phoneSteps(150),
      E.call(157, 'p3', 'mobile_swipe_on_screen', { direction: 'left' }, 't_ph'),
      E.result(158.4, 'p3', 'ok'),
      E.label(158.4, 'p3', { done: 'swiped "Read 20 min" away', detail: 'archived', detailTone: 'muted' }),
      E.call(159, 'p4', 'mobile_click_on_screen_at_coordinates', { x: 812, y: 2290 }, 't_ph'),
      E.result(159.5, 'p4', 'ok'),
      E.label(159.5, 'p4', { done: 'tapped UNDO' }),
      E.extra(159.5, { kind: 'phone.tap', col: 16, row: 22, label: 'UNDO' }),
      E.call(160, 'p5', 'mobile_list_elements_on_screen', {}, 't_ph'),
      E.result(160.3, 'p5', '{"error":"row still archived"}', true),
      E.label(160.3, 'p5', { done: 'nothing came back', detail: 'row still archived', detailTone: 'muted' }),
      E.call(167, 'p6', 'mobile_take_screenshot', {}, 't_ph'),
      E.label(167, 'p6', { doing: 'taking a screenshot for the issue' }),
      E.extra(167.5, { kind: 'phone.frame', frame: demoPhoneFrame(), clock: '12:06' }),
      E.stream(167.6, "Undo didn't work. On screen, the Undo button starts at y 2262 but the navigation bar starts at y 2274, so the bar covers it. That's the bug."),
      E.extra(167.7, { kind: 'diagram', data: OVERLAP }),
      E.extra(168, { kind: 'status', patch: { costUsd: 0.27, faults: 3, recovered: 3 } }),
    ],
    168,
    (s) => {
      s.turn.goal = 'trying it on the phone';
      s.phone.lastAction = 'nothing happened';
    },
  );
}

export function sceneFault(): Scene {
  return build(
    'FaultRecovery',
    [
      E.send(0, SHOWCASE_MESSAGE),
      E.started(0.1),
      E.extra(0.2, { kind: 'milestone', text: 'read PR #12, built and tested it in the sandbox (38/38)' }),
      E.fault(3.1, 'f_0412', 'get_pull_request_files', 'latency_spike'),
      E.recovered(3.9, 'f_0412', 'get_pull_request_files', 'latency_spike', 1, 800),
      E.fault(4, 'f_0413', 'list_pull_requests', 'rate_limit'),
      E.recovered(16, 'f_0413', 'list_pull_requests', 'rate_limit', 2, 12_000),
      E.used(4, 'github-rate-limit-recovery'),
      E.helper(180, 't_ph', 'Phone'),
      E.call(180, 'p2', 'mobile_install_app', { path: '/tmp/app-release.apk' }, 't_ph'),
      E.result(183.8, 'p2', 'ok'),
      E.label(183.8, 'p2', { done: 'installed Tally 1.3.0 on the phone' }),
      E.call(184, 'p3', 'mobile_launch_app', { packageName: 'dev.monk.tally' }, 't_ph'),
      E.result(185.9, 'p3', 'ok'),
      E.label(185.9, 'p3', { done: 'opened the habits list' }),
      E.call(186, 'p4', 'mobile_swipe_on_screen', { direction: 'left' }, 't_ph'),
      E.extra(186, { kind: 'fault.note', faultType: 'popup', saw: 'popup · "Enjoying Tally?" covered the list', steps: ['found "Not now"', 'tapped it', 'swiped again'] }),
      E.fault(186.1, 'f_0417', 'mobile_swipe_on_screen', 'popup'),
      E.result(186.2, 'p4', '{"error":"element covered by dialog"}', true),
      E.used(186.2, 'android-dismiss-rating-popup'),
      E.call(186.3, 'p5', 'mobile_list_elements_on_screen', {}, 't_ph'),
      E.result(186.7, 'p5', 'ok'),
      E.call(186.8, 'p6', 'mobile_click_on_screen_at_coordinates', { x: 300, y: 1400 }, 't_ph'),
      E.result(187.2, 'p6', 'ok'),
      E.call(187.3, 'p7', 'mobile_swipe_on_screen', { direction: 'left' }, 't_ph'),
      E.result(187.6, 'p7', 'ok'),
      E.recovered(187.6, 'f_0417', 'mobile_swipe_on_screen', 'popup', 3, 1400),
      E.call(188, 'p8', 'mobile_launch_app', { packageName: 'dev.monk.tally' }, 't_ph'),
      E.fault(188.1, 'f_0418', 'mobile_launch_app', 'app_crash'),
      E.result(188.2, 'p8', '{"error":"app closed"}', true),
      E.extra(188.2, { kind: 'skill.note', name: 'android-relaunch-after-crash', detail: 'relaunched, reopened the list' }),
      E.used(188.2, 'android-relaunch-after-crash'),
      E.call(188.3, 'p9', 'mobile_launch_app', { packageName: 'dev.monk.tally' }, 't_ph'),
      E.result(190.4, 'p9', 'ok'),
      E.label(190.4, 'p9', { done: 'back on the habits list' }),
      E.recovered(190.4, 'f_0418', 'mobile_launch_app', 'app_crash', 2, 2100),
      E.call(191, 'p10', 'mobile_click_on_screen_at_coordinates', { x: 812, y: 2290 }, 't_ph'),
      E.result(191.5, 'p10', 'ok'),
      E.label(191.5, 'p10', { done: 'tapped UNDO', detail: 'nothing happened', detailTone: 'muted' }),
      E.say(192, "Found the bug. After you archive a habit, the Undo button hides behind the navigation bar, so you can't tap it. Filing an issue with a screenshot."),
      E.helper(193, 't_op', 'Operator'),
      E.call(193, 'o1', 'create_issue', { ...DEMO_REPO, title: 'Undo hidden behind the navigation bar' }, 't_op'),
      E.result(194.1, 'o1', '{"number":13}'),
      E.label(194.1, 'o1', { done: 'filed issue #13 with a screenshot + repro steps' }),
      E.call(198, 'o2', 'wait_for_pull_request_update', { ...DEMO_REPO, pull_number: 12 }, 'main'),
      E.label(198, 'o2', { doing: 'waiting for a fix to land on PR #12', owner: 'you' }),
      E.monk(200, 'skill.drafted', { name: 'android-undo-inset', type: 'recovery', sourceSessions: ['sess_demo'] }),
      E.extra(207, { kind: 'status', patch: { costUsd: 0.31 } }),
    ],
    207,
    (s) => {
      // Order the chaos list the way the card story reads, and restart the startle now.
      const order = ['latency_spike', 'rate_limit', 'popup', 'app_crash'];
      s.faults.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      s.moodFaultAt = sec(207);
      s.sessionSkills = { 'android-dismiss-rating-popup': 'used', 'android-relaunch-after-crash': 'used', 'github-rate-limit-recovery': 'used' };
      for (const it of s.items) if (it.kind === 'card') it.doneAt = sec(207);
    },
  );
}

export const APPROVAL_CONTEXT: Extract<Extra, { kind: 'approval.context' }> = {
  kind: 'approval.context',
  alsoOn: 'Telegram',
  evidence: ['build passed in the sandbox', 'tests 38/38 in the sandbox', 're-tested on the phone after the fix', 'issue #13 fixed by a3f9c1e'],
  evidenceShort: ['sandbox build', '38/38 tests', 'phone re-test', '#13 fixed'],
  actions: [
    {
      title: 'merge PR #12 into main',
      details: ['monk-demo/tally · #12 "Add swipe-to-archive on habit list" · 3 commits', 'squash a3f9c1e (fix/undo-insets) → main at 7d20b44'],
      compact: 'monk-demo/tally · squash a3f9c1e → main 7d20b44',
      call: 'merge_pull_request owner=monk-demo repo=tally pull_number=12 merge_method=squash',
    },
    {
      title: 'publish release v1.3.0',
      details: ['app-release.apk · 4.2 MB · sha256 9c1e07…4b07', 'public · 38 watchers get an email'],
      compact: 'app-release.apk 4.2 MB · public · 38 watchers emailed',
      call: 'create_release tag_name=v1.3.0 target_commitish=main name="Tally 1.3.0" draft=false',
    },
  ],
};

export function sceneApproval(): Scene {
  return build(
    'ApprovalModal',
    [
      ...readAndBuild(),
      E.call(300, 'm1', 'merge_pull_request', { ...DEMO_REPO, pull_number: 12, merge_method: 'squash' }, 't_op'),
      E.call(300, 'm2', 'create_release', { ...DEMO_REPO, tag_name: 'v1.3.0', target_commitish: 'main', name: 'Tally 1.3.0', draft: false }, 't_op'),
      E.turn(300.1, {
        type: 'approval.required',
        calls: [
          { threadId: 't_op', callId: 'm1', name: 'merge_pull_request', server: 'monk-chaos', args: '' },
          { threadId: 't_op', callId: 'm2', name: 'create_release', server: 'monk-chaos', args: '' },
        ],
      }),
      E.extra(300.1, APPROVAL_CONTEXT),
      E.extra(300.2, { kind: 'status', patch: { costUsd: 0.52, faults: 5, recovered: 5 } }),
    ],
    300.1,
  );
}

export function sceneSkills(): Scene {
  return build('SkillsBrowser', [E.extra(1, { kind: 'status', patch: { costUsd: 0.52, faults: 5, recovered: 5 } })], 2, (s) => {
    s.skills = BROWSER_ORDER.map((n) => DEMO_SKILLS.find((k) => k.name === n)!).filter(Boolean);
    s.ui.popup = { kind: 'skills', selected: 0, filter: '', filtering: false, openedAt: sec(2), reading: false };
  });
}

export function scenePalette(): Scene {
  const sc = sceneWorking();
  sc.state.ui.popup = { kind: 'palette', query: 'chaos', selected: 0 };
  return { ...sc, name: 'CommandPalette' };
}

export function sceneSlash(): Scene {
  const sc = sceneIdle();
  sc.state.ui.input = { text: '/ch', cursor: 3 };
  sc.state.ui.popup = { kind: 'slash', selected: 4 };
  return { ...sc, name: 'CommandPalette.slash' };
}

export function sceneSlashArgs(): Scene {
  const sc = sceneIdle();
  sc.state.ui.input = { text: '/chaos p', cursor: 8 };
  sc.state.ui.popup = { kind: 'slash', selected: 0 };
  return { ...sc, name: 'CommandPalette.args' };
}

/** The 80×24 mockups show a slightly earlier moment: before the issue was filed. */
export function sceneFaultNarrow(): Scene {
  const sc = sceneFault();
  sc.state.items = sc.state.items.filter((it) => !(it.kind === 'step' && (it.callId === 'o1' || it.callId === 'o2')));
  return { ...sc, name: 'FaultRecovery.narrow' };
}

/** At 80×24 the phone story starts at the install; the sandbox recap and apk copy scrolled away. */
export function scenePhoneNarrow(): Scene {
  const sc = scenePhone();
  sc.state.items = sc.state.items.filter((it) => it.kind !== 'milestone' && it.kind !== 'user' && !(it.kind === 'step' && it.callId === 'p1'));
  return { ...sc, name: 'PhoneView.narrow' };
}

export const SCENES: Record<string, () => Scene> = {
  MainIdle: sceneIdle,
  MainWorking: sceneWorking,
  SandboxRun: sceneSandbox,
  FaultRecovery: sceneFault,
  PhoneView: scenePhone,
  'FaultRecovery.narrow': sceneFaultNarrow,
  'PhoneView.narrow': scenePhoneNarrow,
  ApprovalModal: sceneApproval,
  SkillsBrowser: sceneSkills,
  CommandPalette: scenePalette,
  'CommandPalette.slash': sceneSlash,
  'CommandPalette.args': sceneSlashArgs,
};
