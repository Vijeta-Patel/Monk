// Demo backend: no network. Sending any message plays the showcase story (mobile QA of PR #12)
// with real timing; the approval waits for your key, then it merges, publishes and learns.
import type { TurnEvent } from '@monk/shared/trueforge';
import { APPROVAL_CONTEXT, DEMO_PLAN, DEMO_PREVIEW, DEMO_SKILLS, DEMO_REPO, OVERLAP, SANDBOX_LINES } from '../demo/scenes.ts';
import { demoPhoneFrame } from '../demo/phone.ts';
import type { Action, Extra } from '../state/actions.ts';
import type { Effect } from '../state/keys.ts';
import { answeredNote } from '../state/describe.ts';
import type { AppState } from '../state/types.ts';
import type { Dispatch, MonkBackend } from './types.ts';

type Beat = { at: number; act: (now: number) => Action | Action[] };

let seq = 0;
const T = (ev: TurnEvent) => (now: number): Action => ({ type: 'turn', ev, at: now });
const X = (ev: Extra) => (now: number): Action => ({ type: 'extra', ev, at: now });
const M = (kind: string, data: Record<string, unknown>) => (now: number): Action =>
  ({ type: 'monk', ev: { id: ++seq, ts: '', sessionId: null, kind, data }, at: now }) as Action;

const call = (callId: string, name: string, args: Record<string, unknown>, threadId: string, server: string | null = 'monk-chaos') =>
  T({ type: 'tool.call', threadId, callId, name, server, args: JSON.stringify(args) });
const result = (callId: string, content: string, isError = false) => T({ type: 'tool.result', threadId: 'x', callId, name: '', content, isError });
const label = (callId: string, patch: Omit<Extract<Extra, { kind: 'step.label' }>, 'kind' | 'callId'>) => X({ kind: 'step.label', callId, ...patch });
const fault = (faultId: string, tool: string, faultType: string) =>
  M('fault.injected', { mcpSessionId: 'mcp_demo', tfSessionId: 'sess_demo', faultId, tool, faultType, profile: 'moderate', manual: false });
const recovered = (faultId: string, tool: string, faultType: string, steps: number, ms: number) =>
  M('fault.recovered', { mcpSessionId: 'mcp_demo', tfSessionId: 'sess_demo', faultId, tool, faultType, steps, ms });
const used = (name: string) => M('skill.used', { name, tfSessionId: 'sess_demo' });
const say = (content: string) => T({ type: 'message', threadId: 'main', content });
const helper = (threadId: string, name: string) => T({ type: 'subagent.started', threadId, name, input: `You are the ${name}.` });
const helperDone = (threadId: string) => T({ type: 'subagent.done', threadId });
const cost = (costUsd: number) => X({ kind: 'status', patch: { costUsd } });

const pr = { ...DEMO_REPO, pull_number: 12 };

/** Everything up to the approval, in seconds from the message. */
export const STORY: Beat[] = [
  { at: 0.3, act: T({ type: 'turn.started', turnId: 'turn_demo' }) },
  { at: 1.2, act: say("On it. Six steps: read the PR, build and test it in the sandbox, try it on the phone, report back. I'll stop and ask before merging or publishing.") },
  { at: 1.4, act: X({ kind: 'plan', steps: DEMO_PLAN.map((p) => ({ ...p, state: p.state === 'gate' ? 'gate' : 'todo' })) }) },
  { at: 1.6, act: helper('t_op', 'Operator') },
  { at: 2.0, act: call('c1', 'get_pull_request', pr, 't_op') },
  { at: 2.8, act: result('c1', '{"number":12,"changed_files":6}') },
  { at: 3.0, act: call('c2', 'get_pull_request_files', pr, 't_op') },
  { at: 3.1, act: fault('f_0412', 'get_pull_request_files', 'rate_limit') },
  { at: 3.3, act: result('c2', '{"error":"429 Too Many Requests · retry_after 4"}', true) },
  { at: 3.3, act: X({ kind: 'skill.note', name: 'github-rate-limit-recovery', detail: 'waited 4s, batched reads' }) },
  { at: 3.4, act: used('github-rate-limit-recovery') },
  { at: 3.5, act: call('c3', 'get_pull_request_files', pr, 't_op') },
  { at: 7.6, act: result('c3', '[{"filename":"HabitList.kt"}]') },
  { at: 7.6, act: recovered('f_0412', 'get_pull_request_files', 'rate_limit', 2, 4300) },
  { at: 7.8, act: helperDone('t_op') },
  { at: 8.0, act: helper('t_cd', 'Coder') },
  { at: 8.1, act: X({ kind: 'skill.loaded', name: 'gradle-offline-cache' }) },
  { at: 8.2, act: call('c4', 'exec', { command: './gradlew assembleDebug' }, 't_cd', null) },
  { at: 8.3, act: X({ kind: 'sandbox.start', callId: 'c4', where: 'daytona · /work/tally', command: './gradlew assembleDebug' }) },
  { at: 9.5, act: X({ kind: 'sandbox.line', callId: 'c4', line: { text: '> Task :app:compileReleaseKotlin', tone: 'muted' } }) },
  { at: 11.5, act: X({ kind: 'sandbox.line', callId: 'c4', line: { text: '> Task :app:assembleRelease', tone: 'muted' } }) },
  { at: 13.0, act: X({ kind: 'sandbox.line', callId: 'c4', line: { text: 'BUILD SUCCESSFUL in 4s', tone: 'ink' } }) },
  { at: 13.1, act: X({ kind: 'sandbox.exit', callId: 'c4', code: 0 }) },
  { at: 13.1, act: result('c4', 'BUILD SUCCESSFUL') },
  { at: 13.1, act: label('c4', { detail: '4.2 MB apk', detailTone: 'muted' }) },
  { at: 13.3, act: call('c5', 'exec', { command: './gradlew testDebugUnitTest' }, 't_cd', null) },
  { at: 13.4, act: X({ kind: 'sandbox.start', callId: 'c5', where: 'daytona · /work/tally', command: './gradlew testDebugUnitTest', testsTotal: 38 }) },
  ...SANDBOX_LINES.map((line, i) => ({ at: 14 + i * 0.35, act: X({ kind: 'sandbox.line', callId: 'c5', line }) })),
  ...Array.from({ length: 32 }, (_, i) => ({ at: 17 + i * 0.12, act: X({ kind: 'sandbox.line', callId: 'c5', line: { text: `habit_case_${i + 7}`, tone: 'ok' as const } }) })),
  { at: 20.9, act: X({ kind: 'sandbox.exit', callId: 'c5', code: 0 }) },
  { at: 20.9, act: result('c5', 'BUILD SUCCESSFUL · 38 tests passed') },
  { at: 20.9, act: label('c5', { done: 'ran the unit tests in the sandbox', detail: '38/38 passed', detailTone: 'ok' }) },
  { at: 21.0, act: helperDone('t_cd') },
  { at: 21.1, act: cost(0.18) },
  { at: 21.5, act: X({ kind: 'milestone', text: 'read PR #12, built and tested it in the sandbox (38/38)' }) },
  { at: 21.6, act: helper('t_ph', 'Phone') },
  { at: 21.7, act: call('p1', 'install_apk', { sandbox_id: 'sbx_1', path: 'app-release.apk' }, 't_ph') },
  { at: 24.1, act: result('p1', 'installed') },
  { at: 24.1, act: label('p1', { done: 'copied the apk from the sandbox to the phone' }) },
  { at: 24.2, act: X({ kind: 'phone.frame', frame: demoPhoneFrame({ snackbar: false }), clock: '12:05' }) },
  { at: 24.3, act: call('p2', 'mobile_launch_app', { packageName: 'dev.monk.tally' }, 't_ph') },
  { at: 25.9, act: result('p2', 'ok') },
  { at: 25.9, act: label('p2', { done: 'opened the habits list' }) },
  { at: 26.0, act: call('p3', 'mobile_swipe_on_screen', { direction: 'left' }, 't_ph') },
  { at: 26.0, act: X({ kind: 'fault.note', faultType: 'popup', saw: 'popup · "Enjoying Tally?" covered the list', steps: ['found "Not now"', 'tapped it', 'swiped again'] }) },
  { at: 26.1, act: fault('f_0417', 'mobile_swipe_on_screen', 'popup') },
  { at: 26.2, act: result('p3', '{"error":"element covered by dialog"}', true) },
  { at: 26.3, act: used('android-dismiss-rating-popup') },
  { at: 26.5, act: call('p4', 'mobile_list_elements_on_screen', {}, 't_ph') },
  { at: 26.9, act: result('p4', 'ok') },
  { at: 27.0, act: call('p5', 'mobile_click_on_screen_at_coordinates', { x: 300, y: 1400 }, 't_ph') },
  { at: 27.4, act: result('p5', 'ok') },
  { at: 27.5, act: call('p6', 'mobile_swipe_on_screen', { direction: 'left' }, 't_ph') },
  { at: 27.8, act: result('p6', 'ok') },
  { at: 27.8, act: recovered('f_0417', 'mobile_swipe_on_screen', 'popup', 3, 1400) },
  { at: 27.9, act: X({ kind: 'phone.frame', frame: demoPhoneFrame({ snackbar: true }), clock: '12:06' }) },
  { at: 28.3, act: call('p7', 'mobile_click_on_screen_at_coordinates', { x: 812, y: 2290 }, 't_ph') },
  { at: 28.8, act: result('p7', 'ok') },
  { at: 28.8, act: label('p7', { done: 'tapped UNDO' }) },
  { at: 28.8, act: X({ kind: 'phone.tap', col: 16, row: 22, label: 'UNDO' }) },
  { at: 29.0, act: call('p8', 'mobile_list_elements_on_screen', {}, 't_ph') },
  { at: 29.3, act: result('p8', '{"error":"row still archived"}', true) },
  { at: 29.3, act: label('p8', { done: 'nothing came back', detail: 'row still archived', detailTone: 'muted' }) },
  { at: 29.8, act: T({ type: 'text', threadId: 'main', delta: "Undo didn't work. On screen, the Undo button starts at y 2262 but the " }) },
  { at: 30.4, act: T({ type: 'text', threadId: 'main', delta: "navigation bar starts at y 2274, so the bar covers it. That's the bug." }) },
  { at: 30.6, act: X({ kind: 'diagram', data: OVERLAP }) },
  { at: 30.7, act: T({ type: 'message', threadId: 'main', content: "Undo didn't work. On screen, the Undo button starts at y 2262 but the navigation bar starts at y 2274, so the bar covers it. That's the bug." }) },
  { at: 31.0, act: cost(0.27) },
  { at: 33.5, act: helperDone('t_ph') },
  { at: 33.6, act: helper('t_op2', 'Operator') },
  { at: 33.7, act: call('o1', 'create_issue', { ...DEMO_REPO, title: 'Undo hidden behind the navigation bar' }, 't_op2') },
  { at: 34.8, act: result('o1', '{"number":13}') },
  { at: 34.8, act: label('o1', { done: 'filed issue #13 with a screenshot + repro steps' }) },
  { at: 35.0, act: M('skill.drafted', { name: 'android-undo-inset', type: 'recovery', sourceSessions: ['sess_demo'] }) },
  { at: 35.2, act: call('o2', 'wait_for_pull_request_update', pr, 'main') },
  { at: 35.2, act: label('o2', { doing: 'waiting for a fix to land on PR #12', owner: 'you' }) },
  { at: 39.0, act: result('o2', '{"head":"a3f9c1e"}') },
  { at: 39.0, act: label('o2', { done: 'a fix landed on PR #12 · a3f9c1e' }) },
  { at: 39.2, act: call('p9', 'mobile_click_on_screen_at_coordinates', { x: 812, y: 2190 }, 't_op2') },
  { at: 40.0, act: result('p9', 'ok') },
  { at: 40.0, act: label('p9', { done: 're-tested UNDO on the phone', detail: 'row came back', detailTone: 'ok' }) },
  { at: 40.5, act: say('The fix works. Everything checks out; before I ship this, I need your ok.') },
  { at: 40.8, act: call('m1', 'merge_pull_request', { ...pr, merge_method: 'squash' }, 't_op2') },
  { at: 40.8, act: call('m2', 'create_release', { ...DEMO_REPO, tag_name: 'v1.3.0', target_commitish: 'main', name: 'Tally 1.3.0', draft: false }, 't_op2') },
  { at: 41.0, act: cost(0.52) },
  {
    at: 41.2,
    act: T({
      type: 'approval.required',
      calls: [
        { threadId: 't_op2', callId: 'm1', name: 'merge_pull_request', server: 'monk-chaos', args: '' },
        { threadId: 't_op2', callId: 'm2', name: 'create_release', server: 'monk-chaos', args: '' },
      ],
    }),
  },
  { at: 41.2, act: X(APPROVAL_CONTEXT) },
  { at: 41.3, act: T({ type: 'turn.done', status: 'paused', output: '', inputTokens: 41_200, outputTokens: 3_100 }) },
];

const AFTER_YES: Beat[] = [
  { at: 0.4, act: result('m1', '{"merged":true,"sha":"7d20b44"}') },
  { at: 0.4, act: label('m1', { done: 'merged PR #12 into main', detail: '7d20b44', detailTone: 'muted' }) },
  { at: 1.2, act: result('m2', '{"tag_name":"v1.3.0"}') },
  { at: 1.2, act: label('m2', { done: 'published release v1.3.0' }) },
  { at: 1.6, act: say('Shipped. PR #12 is merged and v1.3.0 is out. I learned two things from the chaos on the way; they will load next time.') },
  { at: 2.0, act: M('skill.committed', { name: 'android-undo-inset', version: 1, commitSha: 'c0ffee1' }) },
  { at: 2.2, act: T({ type: 'turn.done', status: 'done', output: 'Shipped.', inputTokens: 2_100, outputTokens: 240 }) },
];

const AFTER_NO = (reason: string): Beat[] => [
  { at: 0.4, act: result('m1', '{"error":"denied"}', true) },
  { at: 0.4, act: result('m2', '{"error":"denied"}', true) },
  { at: 0.8, act: say(`Okay, not shipping. You said: "${reason}". PR #12 stays open and nothing was published.`) },
  { at: 1.0, act: T({ type: 'turn.done', status: 'done', output: 'Not shipped.', inputTokens: 900, outputTokens: 80 }) },
];

export class DemoBackend implements MonkBackend {
  readonly kind = 'demo' as const;
  private dispatch: Dispatch = () => {};
  private getState: () => AppState = () => {
    throw new Error('not started');
  };
  private timers: ReturnType<typeof setTimeout>[] = [];
  private playing = false;
  /** Playback speed; tests run the story faster. */
  private readonly speed: number;

  constructor(opts: { speed?: number } = {}) {
    this.speed = opts.speed ?? 1;
  }

  async start(dispatch: Dispatch, getState: () => AppState): Promise<void> {
    this.dispatch = dispatch;
    this.getState = getState;
    const now = Date.now();
    dispatch({ type: 'extra', ev: { kind: 'status', patch: { generation: 3, connections: { github: 'ok', sandbox: 'ok', phone: 'ok' }, api: 'ok', trueforge: 'ok', channel: 'Telegram' } }, at: now });
    dispatch({ type: 'extra', ev: { kind: 'skills', skills: DEMO_SKILLS }, at: now });
    dispatch({ type: 'extra', ev: { kind: 'skill.preview', preview: DEMO_PREVIEW }, at: now });
    dispatch({ type: 'extra', ev: { kind: 'session', id: 'sess_demo' }, at: now });
    dispatch({ type: 'extra', ev: { kind: 'sessions', sessions: [{ id: 'sess_tg', title: 'triage stale PRs in monk-demo/tally', updatedAt: '2h ago', platform: 'telegram' }, { id: 'sess_dc', title: 'why did the nightly drill fail?', updatedAt: '1d ago', platform: 'discord' }] }, at: now });
  }

  private play(beats: Beat[]): void {
    for (const b of beats) {
      this.timers.push(
        setTimeout(() => {
          const a = b.act(Date.now());
          for (const x of Array.isArray(a) ? a : [a]) this.dispatch(x);
        }, (b.at * 1000) / this.speed),
      );
    }
  }

  private note(text: string, tone: 'faint' | 'ok' | 'fail' | 'gate' | 'muted' = 'muted', glyph = '·'): void {
    this.dispatch({ type: 'extra', ev: { kind: 'note', glyph, text, tone }, at: Date.now() });
  }

  async run(effect: Effect): Promise<void> {
    switch (effect.kind) {
      case 'send':
        this.dispatch({ type: 'send', text: effect.text, at: Date.now() });
        if (!this.playing) {
          this.playing = true;
          this.play(STORY);
        } else {
          this.note("demo mode plays one story · it'll pick this up after", 'faint');
        }
        return;
      case 'cancel':
        for (const t of this.timers) clearTimeout(t);
        this.timers = [];
        this.playing = false;
        this.dispatch({ type: 'turn', ev: { type: 'turn.done', status: 'cancelled', output: '', inputTokens: 0, outputTokens: 0 }, at: Date.now() });
        return;
      case 'approve': {
        const allowed = effect.allow;
        this.dispatch({ type: 'extra', ev: { kind: 'approved.remote', platform: 'the terminal', allowed }, at: Date.now() });
        this.dispatch({ type: 'turn', ev: { type: 'turn.started', turnId: 'turn_demo_2' }, at: Date.now() });
        this.play(allowed ? AFTER_YES : AFTER_NO(effect.reason ?? 'not now'));
        this.timers.push(setTimeout(() => (this.playing = false), 3000 / this.speed));
        return;
      }
      case 'answer':
        for (const a of effect.answers) {
          const n = answeredNote(a.question, a.content);
          this.note(n.text, n.tone, n.glyph);
        }
        return;
      case 'chaos': {
        const st = this.getState().status;
        if (effect.fault) this.note(`next call gets a ${effect.fault}`, 'muted', '⚡');
        else this.dispatch({ type: 'extra', ev: { kind: 'status', patch: { profile: effect.profile ?? st.profile, chaosEnabled: effect.enabled ?? st.chaosEnabled } }, at: Date.now() });
        return;
      }
      case 'new':
        for (const t of this.timers) clearTimeout(t);
        this.timers = [];
        this.playing = false;
        this.dispatch({ type: 'extra', ev: { kind: 'reset' }, at: Date.now() });
        return;
      case 'resume':
        this.note(`demo mode can't resume ${effect.sessionId}; run monk without --demo`);
        return;
      case 'bench':
        this.note('benchmark started · watch it on the dashboard (demo)', 'muted', '▣');
        return;
      case 'agent':
        this.note(`talking to ${effect.name} now (demo)`);
        return;
      case 'verifySkill':
        this.note(`checking ${effect.name} again in the sandbox (demo)`);
        return;
      case 'retireSkill':
        this.note(`retiring ${effect.name} is a git commit; run monk learn outside demo mode`);
        return;
      case 'editCalls':
        this.note("editing calls isn't wired yet · press n and say what to change");
        return;
      case 'copy':
        this.note('copied', 'ok', '✓');
        return;
      case 'notice':
        this.note(effect.text);
        return;
      case 'sessions':
      case 'skills':
      case 'bell':
      case 'quit':
        return;
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
  }
}
