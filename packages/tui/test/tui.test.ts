import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameIndex, spinner } from '../src/anim/frames.ts';
import { SCENES, sceneApproval, sceneIdle, sceneSandbox, sceneWorking } from '../src/demo/scenes.ts';
import { computeLayout } from '../src/layout.ts';
import { paintScreen, screenConversation, screenLayout } from '../src/paint/screen.ts';
import { truncate, width, wrap } from '../src/render/text.ts';
import { handleKey, handleWheel, type Key, type Screen } from '../src/state/keys.ts';
import { FOLLOW, initialState, reduce, reduceAll } from '../src/state/reducer.ts';
import type { AppState, StepItem } from '../src/state/types.ts';

const key = (name: string, extra: Partial<Key> = {}): Key => ({ name, ctrl: false, shift: false, meta: false, sequence: name.length === 1 ? name : '', ...extra });

function mockup(file: string, block: string): string[] {
  const md = readFileSync(join(import.meta.dir, '../design/screens', `${file}.md`), 'utf8');
  const start = md.indexOf(`### ${block}\n`);
  const body = md.slice(md.indexOf('```text\n', start) + 8);
  return body.slice(0, body.indexOf('```')).replace(/\n$/, '').split('\n');
}

const trimRight = (rows: string[]) => rows.map((r) => r.replace(/\s+$/, ''));

describe('screens match the design mockups cell for cell', () => {
  const cases: [string, string, string, number, number][] = [
    ['MainIdle', 'MainIdle', '120 × 36', 120, 36],
    ['MainIdle', 'MainIdle', '80 × 24', 80, 24],
    ['MainWorking', 'MainWorking', '120 × 36', 120, 36],
    ['MainWorking', 'MainWorking', '80 × 24', 80, 24],
    ['SandboxRun', 'SandboxRun', '120 × 36', 120, 36],
    ['SandboxRun', 'SandboxRun', '80 × 24', 80, 24],
    ['FaultRecovery', 'FaultRecovery', '120 × 36', 120, 36],
    ['FaultRecovery.narrow', 'FaultRecovery', '80 × 24', 80, 24],
    ['PhoneView.narrow', 'PhoneView', '80 × 24', 80, 24],
    ['ApprovalModal', 'ApprovalModal', '120 × 36', 120, 36],
    ['ApprovalModal', 'ApprovalModal', '80 × 24', 80, 24],
    ['SkillsBrowser', 'SkillsBrowser', '120 × 36', 120, 36],
    ['SkillsBrowser', 'SkillsBrowser', '80 × 24', 80, 24],
    ['CommandPalette.slash', 'CommandPalette', '120 × 36, slash commands', 120, 36],
    ['CommandPalette.args', 'CommandPalette', '80 × 24, slash arguments', 80, 24],
  ];
  for (const [scene, file, block, w, h] of cases) {
    test(`${scene} ${w}×${h}`, () => {
      const sc = SCENES[scene]!();
      const got = paintScreen(sc.state, { now: sc.now, still: true, reduced: false }, w, h).lines();
      expect(trimRight(got)).toEqual(trimRight(mockup(file, block)));
    });
  }
});

describe('text and layout', () => {
  test('⚡ is two cells and truncation respects cells', () => {
    expect(width('⚡ rate_limit')).toBe(13);
    expect(width(truncate('android-emulator-install', 22))).toBe(22);
  });
  test('wrap keeps words and hard-splits long tokens', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  test('layout geometry', () => {
    const l = computeLayout(120, 36);
    expect([l.full, l.convW, l.ruleX, l.sideX, l.inputTop, l.hintsY]).toEqual([true, 78, 82, 85, 32, 35]);
    expect(computeLayout(80, 24).full).toBe(false);
  });
});

describe('motion', () => {
  test('reduced motion freezes frames and swaps the spinner', () => {
    expect(frameIndex({ now: 5000, still: false, reduced: true }, 10, 80)).toBe(0);
    expect(spinner({ now: 5000, still: false, reduced: true })).toBe('●');
    expect(frameIndex({ now: 160, still: false, reduced: false }, 10, 80)).toBe(2);
  });
});

describe('keys', () => {
  test('approval: esc never closes, keys arm after 600 ms, y approves', () => {
    const sc = sceneApproval();
    const opened = sc.state.approval!.openedAt;
    expect(handleKey(sc.state, key('escape'), opened + 5000).state.approval).not.toBeNull();
    expect(handleKey(sc.state, key('y'), opened + 100).effects).toEqual([]);
    expect(handleKey(sc.state, key('y'), opened + 700).effects).toEqual([{ kind: 'approve', allow: true }]);
  });
  test('approval: n asks why, enter sends the reason', () => {
    const sc = sceneApproval();
    const t = sc.state.approval!.openedAt + 1000;
    let s = handleKey(sc.state, key('n'), t).state;
    expect(s.approval!.stage).toBe('reason');
    for (const ch of 'wait') s = handleKey(s, key(ch), t).state;
    expect(handleKey(s, key('return'), t).effects).toEqual([{ kind: 'approve', allow: false, reason: 'wait' }]);
  });
  test('typing and enter sends; tab accepts the idle suggestion', () => {
    let s = sceneIdle().state;
    s = handleKey(s, key('tab'), 0).state;
    expect(s.ui.input.text).toBe('Test PR #12 on the phone before we ship');
    const r = handleKey(s, key('return'), 0);
    expect(r.effects).toEqual([{ kind: 'send', text: 'Test PR #12 on the phone before we ship' }]);
    expect(r.state.ui.input.text).toBe('');
  });
  test('slash: /ch + tab completes to /chaos, then a profile runs', () => {
    let s = sceneIdle().state;
    for (const ch of '/ch') s = handleKey(s, key(ch), 0).state;
    s = handleKey(s, key('tab'), 0).state;
    expect(s.ui.input.text).toBe('/chaos ');
    for (const ch of 'pre') s = handleKey(s, key(ch), 0).state;
    expect(handleKey(s, key('return'), 0).effects).toEqual([{ kind: 'chaos', profile: 'pressure', enabled: true }]);
  });
  test('esc stops a running turn; ctrl+c quits', () => {
    const s = sceneWorking().state;
    expect(handleKey(s, key('escape'), 0).effects).toEqual([{ kind: 'cancel' }]);
    expect(handleKey(s, key('c', { ctrl: true }), 0).effects).toEqual([{ kind: 'quit' }]);
  });
  test('ctrl+o opens the sandbox well for a sandbox step', () => {
    const s = sceneWorking().state;
    const r = handleKey({ ...s, ui: { ...s.ui, selectedStep: null } }, key('o', { ctrl: true }), 0);
    expect(r.state.ui.popup?.kind === 'details' || r.state.ui.wellOpen !== null).toBe(true);
  });
});

describe('reducer', () => {
  test('a fault that recovers in 3+ steps folds into a chaos card', () => {
    const sc = SCENES.FaultRecovery!();
    const card = sc.state.items.find((i) => i.kind === 'card');
    expect(card?.kind === 'card' && card.faultId).toBe('f_0417');
    expect(card?.kind === 'card' && card.steps.length).toBe(3);
  });
  test('turn.done paused keeps the turn running for the approval', () => {
    let s = initialState(0);
    s = reduce(s, { type: 'send', text: 'hi', at: 0 });
    s = reduce(s, { type: 'turn', ev: { type: 'turn.done', status: 'paused', output: '', inputTokens: 1, outputTokens: 1 }, at: 1 });
    expect(s.turn.running).toBe(true);
    s = reduce(s, { type: 'turn', ev: { type: 'turn.done', status: 'done', output: '', inputTokens: 1, outputTokens: 1 }, at: 2 });
    expect(s.turn.running).toBe(false);
  });
  test("other sessions' faults don't mark steps without a matching tool", () => {
    const s = sceneWorking().state;
    expect(s.items.filter((i) => i.kind === 'step' && i.state === 'fault').length).toBe(1);
  });
});

describe('phone frames', () => {
  test('downsamples a screenshot to 22×48 and maps taps to cells', async () => {
    const { PNG } = await import('pngjs');
    const { decodeScreen, tapCell } = await import('../src/backend/phone-frame.ts');
    const png = new PNG({ width: 108, height: 240 });
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 108; x++) {
        const i = (y * 108 + x) * 4;
        const top = y < 120;
        png.data[i] = top ? 255 : 0;
        png.data[i + 1] = 0;
        png.data[i + 2] = top ? 0 : 255;
        png.data[i + 3] = 255;
      }
    const { frame, width, height } = decodeScreen(PNG.sync.write(png));
    expect([frame.w, frame.h, frame.px.length, width, height]).toEqual([22, 48, 22 * 48, 108, 240]);
    expect(frame.px[0]).toBe('#ff0000');
    expect(frame.px.at(-1)).toBe('#0000ff');
    expect(tapCell(812, 2290, 1080, 2400)).toEqual({ col: 17, row: 22 });
  });
});

describe('conversation scrolling', () => {
  const WIDE: Screen = { w: 120, h: 36 };
  const NARROW: Screen = { w: 80, h: 24 };
  const clock = { now: 0, still: true, reduced: false };
  const ask = (s: AppState, i: number) => reduce(s, { type: 'send', text: `question ${i}`, at: i });
  const answer = (s: AppState, i: number) =>
    reduce(s, { type: 'turn', ev: { type: 'message', threadId: 'main', content: `answer ${i}\nsecond line\nthird line` }, at: i });
  /** `pairs` questions and three-line answers: 5 rows each after the first. */
  function chat(pairs: number): AppState {
    let s = initialState(0);
    for (let i = 1; i <= pairs; i++) s = answer(ask(s, i), i);
    return reduce(s, { type: 'turn', ev: { type: 'turn.done', status: 'done', output: '', inputTokens: 1, outputTokens: 1 }, at: pairs });
  }
  const rows = (s: AppState, sz: Screen = WIDE) => {
    const l = screenLayout(s, sz.w, sz.h);
    const lines = paintScreen(s, clock, sz.w, sz.h).lines();
    // The conversation column only: the sidebar changes with the turn.
    return { body: lines.slice(l.bodyTop, l.bodyBottom + 1).map((ln) => ln.slice(0, l.convX + l.convW)), hint: lines[l.inputTop - 1]!.trim() };
  };

  test('following paints the newest rows with no hint', () => {
    const r = rows(chat(12));
    expect(r.body.join('\n')).toContain('answer 12');
    expect(r.hint).toBe('');
  });
  test('pgup goes back a page, home clamps at the oldest row, end follows again', () => {
    let s = chat(12);
    // 120×36: 29 body rows; a page keeps two of them.
    s = handleKey(s, key('pageup'), 0, WIDE).state;
    expect(s.ui.scroll.up).toBe(27);
    expect(rows(s).body.join('\n')).not.toContain('answer 12');
    expect(rows(s).hint).toBe('↓ 27 more · end to follow');
    for (let i = 0; i < 5; i++) s = handleKey(s, key('pageup'), 0, WIDE).state;
    const max = screenConversation(s, clock, 120, 36).max;
    expect(s.ui.scroll.up).toBe(max);
    expect(rows(s).body[1]).toContain('question 1');
    expect(handleKey(s, key('home'), 0, WIDE).state).toBe(s);
    s = handleKey(s, key('pagedown'), 0, WIDE).state;
    expect(s.ui.scroll.up).toBe(max - 27);
    s = handleKey(s, key('end'), 0, WIDE).state;
    expect(s.ui.scroll).toEqual(FOLLOW);
    expect(rows(s).hint).toBe('');
  });
  test('home jumps to the oldest row; nothing moves when it all fits', () => {
    const s = handleKey(chat(12), key('home'), 0, WIDE).state;
    expect(rows(s).body[1]).toContain('question 1');
    const short = chat(2);
    expect(handleKey(short, key('home'), 0, WIDE).state).toBe(short);
    expect(handleKey(short, key('pageup'), 0, WIDE).state).toBe(short);
  });
  test('shift+↑↓ and ctrl+↑↓ move a row; plain ↑ still recalls history and typing keeps the view', () => {
    let s = chat(12);
    s = { ...s, ui: { ...s.ui, history: ['run it again'] } };
    s = handleKey(s, key('up', { shift: true }), 0, WIDE).state;
    s = handleKey(s, key('up', { ctrl: true }), 0, WIDE).state;
    expect(s.ui.scroll.up).toBe(2);
    s = handleKey(s, key('down', { shift: true }), 0, WIDE).state;
    expect(s.ui.scroll.up).toBe(1);
    s = handleKey(s, key('up'), 0, WIDE).state;
    expect(s.ui.input.text).toBe('run it again');
    s = handleKey(s, key('x'), 0, WIDE).state;
    expect(s.ui.input.text).toBe('run it againx');
    expect(s.ui.scroll.up).toBe(1);
    s = handleKey(s, key('down', { ctrl: true }), 0, WIDE).state;
    expect(s.ui.scroll).toEqual(FOLLOW);
  });
  test('new rows while scrolled back keep the view still and count as new', () => {
    let s = handleKey(chat(12), key('pageup'), 0, WIDE).state;
    const before = rows(s).body;
    s = answer(ask(s, 13), 13);
    expect(rows(s).body).toEqual(before);
    // A blank row and the question, a blank row and the three-line answer.
    expect(rows(s).hint).toBe('↓ 6 new · end to follow');
    s = handleKey(s, key('pageup'), 0, WIDE).state;
    expect(rows(s).hint).toBe('↓ 6 new · end to follow');
    s = handleKey(s, key('end'), 0, WIDE).state;
    expect(rows(s).body.join('\n')).toContain('answer 13');
    expect(rows(s).hint).toBe('');
  });
  test('a milestone hides the history being read, so the view follows and stays following', () => {
    let s = handleKey(chat(12), key('pageup'), 0, WIDE).state;
    s = reduce(s, { type: 'extra', ev: { kind: 'milestone', text: 'answered twelve questions' }, at: 13 });
    expect(s.ui.scroll).toEqual(FOLLOW);
    for (let i = 13; i <= 24; i++) s = answer(ask(s, i), i);
    expect(rows(s).body.join('\n')).toContain('answer 24');
    expect(rows(s).hint).toBe('');
  });
  test('sending a message follows again', () => {
    let s = handleKey(chat(12), key('pageup'), 0, WIDE).state;
    for (const ch of 'hi') s = handleKey(s, key(ch), 0, WIDE).state;
    const r = handleKey(s, key('return'), 0, WIDE);
    expect(r.effects).toEqual([{ kind: 'send', text: 'hi' }]);
    expect(r.state.ui.scroll).toEqual(FOLLOW);
  });
  test('the wheel moves three rows a notch; popups and the approval screen ignore wheel and keys', () => {
    let s = chat(12);
    s = handleWheel(s, 'up', WIDE, 0);
    expect(s.ui.scroll.up).toBe(3);
    s = handleWheel(s, 'up', WIDE, 0, 2);
    expect(s.ui.scroll.up).toBe(9);
    s = handleWheel(s, 'down', WIDE, 0);
    expect(s.ui.scroll.up).toBe(6);
    const help: AppState = { ...s, ui: { ...s.ui, popup: { kind: 'help' } } };
    expect(handleWheel(help, 'up', WIDE, 0)).toBe(help);
    expect(handleKey(help, key('pageup'), 0, WIDE).state).toBe(help);
    const approval = sceneApproval().state;
    expect(handleWheel(approval, 'up', WIDE, 0)).toBe(approval);
    expect(handleKey(approval, key('pageup'), approval.approval!.openedAt + 1000, WIDE).state).toBe(approval);
  });
  test('80×24 pages by its own height and still reaches the oldest row', () => {
    let s = handleKey(chat(12), key('pageup'), 0, NARROW).state;
    // 17 body rows.
    expect(s.ui.scroll.up).toBe(15);
    expect(rows(s, NARROW).hint).toBe('↓ 15 more · end to follow');
    s = handleKey(s, key('home'), 0, NARROW).state;
    expect(rows(s, NARROW).body[1]).toContain('question 1');
  });
  test('under the 80-col phone strip the conversation starts a row lower and scrolls under it', () => {
    const sc = SCENES.PhoneView!();
    const clk = { now: sc.now, still: true, reduced: false };
    const v = screenConversation(sc.state, clk, 80, 24);
    expect([v.top, v.avail, v.max]).toEqual([3, 16, 1]);
    const s = handleKey(sc.state, key('home'), sc.now, NARROW).state;
    expect(s.ui.scroll.up).toBe(1);
    const lines = paintScreen(s, clk, 80, 24).lines();
    expect(lines[2]).toContain('▣ phone');
    expect(lines[screenLayout(s, 80, 24).inputTop - 1]!.trim()).toBe('↓ 1 more · end to follow');
  });
  test('an open well keeps ↑↓ and end for its output; pgup still scrolls the conversation', () => {
    let s = sceneSandbox().state;
    const id = s.ui.wellOpen!;
    const callId = (s.items.find((it) => it.id === id) as StepItem).callId!;
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'extra', ev: { kind: 'sandbox.line', callId, line: { text: `line ${i}`, tone: 'muted' } }, at: 0 });
    const run = (st: AppState) => (st.items.find((it) => it.id === id) as StepItem).run!;
    s = handleKey(s, key('up'), 0, NARROW).state;
    s = handleKey(s, key('up', { shift: true }), 0, NARROW).state;
    expect([run(s).scroll, run(s).following, s.ui.scroll.up]).toEqual([2, false, 0]);
    s = handleKey(s, key('pageup'), 0, NARROW).state;
    expect(s.ui.scroll.up).toBeGreaterThan(0);
    expect(run(s).scroll).toBe(2);
    s = handleKey(s, key('end'), 0, NARROW).state;
    expect([run(s).scroll, run(s).following, s.ui.focus]).toEqual([0, true, 'well']);
    expect(s.ui.scroll.up).toBeGreaterThan(0);
  });
});

describe('ask_user_question', () => {
  const WIDE: Screen = { w: 120, h: 36 };
  const NARROW: Screen = { w: 80, h: 24 };
  const OPTS = ['acme/app (Recommended)', 'acme/web', 'Other'];
  const call = (callId: string, question: string, options: string[]) => ({ threadId: 'main', callId, name: 'ask_user_question', server: null, args: '', question, options });
  const asked = (s: AppState, options = OPTS, question = 'Which repo should I file the issue in?') =>
    reduce(s, { type: 'turn', ev: { type: 'question', calls: [call('q1', question, options)] }, at: 1 });
  const typed = (s: AppState, text: string) => ({ ...s, ui: { ...s.ui, input: { text, cursor: text.length } } });
  const paint = (s: AppState, sz: Screen = WIDE) => paintScreen(s, { now: 0, still: true, reduced: false }, sz.w, sz.h).lines();
  const done = (status: 'done' | 'paused') => ({ type: 'turn' as const, ev: { type: 'turn.done' as const, status, output: '', inputTokens: 1, outputTokens: 1 }, at: 2 });

  test('the card paints above the input with the question, numbered options and the selection', () => {
    const s = asked(sceneWorking().state);
    const lines = paint(s);
    const l = screenLayout(s, 120, 36);
    const top = lines.findIndex((ln) => ln.includes('╭─ • monk asks'));
    expect(top).toBeGreaterThan(l.bodyTop);
    expect(lines[top + 1]).toContain('Which repo should I file the issue in?');
    expect(lines[top + 3]).toContain('› 1  acme/app (Recommended)');
    expect(lines[top + 4]).toContain('  2  acme/web');
    expect(lines[top + 5]).toContain('  3  Other');
    // The card ends where the body does; the blank row and the input are untouched.
    expect(lines[l.bodyBottom]).toContain('↑↓ choose · 1–3 pick · enter answer · or type your own');
    expect(lines[l.inputTop - 1]!.trim()).toBe('');
    expect(lines[l.inputTop + 1]).toContain('or type your own answer');
    // The conversation stops a blank row above the card instead of running under it.
    expect(lines[top - 1]!.slice(0, l.convX + l.convW).trim()).toBe('');
    expect(lines.slice(l.bodyTop, top).join('\n')).toContain('Build is green');
    expect(lines[0]).toContain('waiting for your answer');
    const moved = handleKey(s, key('down'), 0, WIDE).state;
    expect(paint(moved)[top + 4]).toContain('› 2  acme/web');
  });

  test('with no options it asks for a typed answer', () => {
    const s = asked(sceneWorking().state, [], 'What should the issue be called?');
    const lines = paint(s, NARROW);
    const top = lines.findIndex((ln) => ln.includes('monk asks'));
    expect(lines[top + 1]).toContain('What should the issue be called?');
    expect(lines[top + 2]).toContain('type your answer · enter to send');
    expect(lines.join('\n')).not.toMatch(/› 1 /);
    expect(lines[screenLayout(s, 80, 24).inputTop + 1]).toContain('type your answer');
  });

  test('with nothing said yet, the card replaces the welcome screen instead of covering it', () => {
    const text = paint(asked(sceneIdle().state), NARROW).join('\n');
    expect(text).toContain('monk asks');
    expect(text).not.toContain('try');
  });

  test('a long question wraps, then truncates, and keeps three conversation rows at 80×24', () => {
    const s = asked(sceneWorking().state, ['a', 'b', 'c', 'd', 'Other'], 'word '.repeat(200).trim());
    const lines = paint(s, NARROW);
    const l = screenLayout(s, 80, 24);
    const top = lines.findIndex((ln) => ln.includes('monk asks'));
    expect(top - l.bodyTop).toBeGreaterThanOrEqual(4);
    expect(lines.slice(top, l.bodyBottom + 1).join('\n')).toContain('…');
    expect(lines[l.bodyBottom]).toContain('1–5 pick');
    for (const ln of lines) expect(width(ln)).toBe(80);
    const v = screenConversation(s, { now: 0, still: true, reduced: false }, 80, 24);
    expect(v.top + v.avail).toBe(top - 1);
  });

  test('scrolled back, the hint sits in the blank row above the card', () => {
    const s = handleKey(asked(sceneSandbox().state), key('pageup'), 0, WIDE).state;
    expect(s.ui.scroll.up).toBeGreaterThan(0);
    const lines = paint(s);
    const top = lines.findIndex((ln) => ln.includes('monk asks'));
    expect(lines[top - 1]).toContain('end to follow');
  });

  test('a digit on an empty input picks, enter answers it; Other waits for a typed answer', () => {
    const s = asked(sceneWorking().state);
    const picked = handleKey(s, key('2'), 0);
    expect([picked.effects, picked.state.question?.selected, picked.state.ui.input.text]).toEqual([[], 1, '2']);
    const r = handleKey(picked.state, key('return'), 0);
    expect(r.effects).toEqual([{ kind: 'answer', answers: [{ threadId: 'main', callId: 'q1', question: 'Which repo should I file the issue in?', content: 'acme/web' }] }]);
    expect(r.state.question).toBeNull();
    expect(r.state.ui.input.text).toBe('');
    // ↓ after a digit takes over the pick, so the digit goes and enter answers the new selection.
    const moved = handleKey(picked.state, key('down'), 0).state;
    expect([moved.question?.selected, moved.ui.input.text]).toEqual([2, '']);
    const other = handleKey(s, key('3'), 0);
    expect([other.effects, other.state.question?.selected]).toEqual([[], 2]);
    expect(handleKey(other.state, key('return'), 0).effects).toEqual([]);
    let t = other.state;
    for (const ch of 'acme/mobile') t = handleKey(t, key(ch), 0).state;
    const sent = handleKey(t, key('return'), 0);
    expect(sent.effects[0]?.kind === 'answer' && sent.effects[0].answers[0]!.content).toBe('acme/mobile');
    expect(sent.state.ui.input.text).toBe('');
    // With text typed, a digit is just text; past the last option it is too.
    expect(handleKey(typed(s, 'v'), key('1'), 0).state.ui.input.text).toBe('v1');
    expect(handleKey(s, key('7'), 0).state.ui.input.text).toBe('7');
  });

  test('an answer of your own that starts with a digit can be typed', () => {
    let t = asked(sceneWorking().state, ['Today (Recommended)', 'Tomorrow', 'Other'], 'When should I ship it?');
    const effects: unknown[] = [];
    for (const ch of '2 days please') {
      const r = handleKey(t, { ...key(ch === ' ' ? 'space' : ch), sequence: ch }, 0);
      effects.push(...r.effects);
      t = r.state;
    }
    expect([effects, t.ui.input.text, t.question?.selected]).toEqual([[], '2 days please', 1]);
    const r = handleKey(t, key('return'), 0);
    expect(r.effects).toEqual([{ kind: 'answer', answers: [{ threadId: 'main', callId: 'q1', question: 'When should I ship it?', content: '2 days please' }] }]);
  });

  test("a question moves focus to the input, so a sandbox well left open doesn't keep ↑↓", () => {
    const well = sceneSandbox().state;
    expect(well.ui.focus).toBe('well');
    const s = asked(well);
    expect([s.ui.focus, s.ui.wellOpen]).toEqual(['input', well.ui.wellOpen]);
    expect(handleKey(s, key('down'), 0).state.question?.selected).toBe(1);
  });

  test('↑↓ move the selection, enter answers it; shift+↑ still scrolls', () => {
    let s = asked(sceneWorking().state);
    s = handleKey(s, key('down'), 0).state;
    s = handleKey(s, key('down'), 0).state;
    s = handleKey(s, key('down'), 0).state;
    expect(s.question!.selected).toBe(2);
    s = handleKey(s, key('up'), 0).state;
    expect(s.question!.selected).toBe(1);
    const shifted = handleKey(s, key('up', { shift: true }), 0, WIDE).state;
    expect(shifted.question!.selected).toBe(1);
    const r = handleKey(s, key('return'), 0);
    expect(r.effects[0]?.kind === 'answer' && r.effects[0].answers[0]!.content).toBe('acme/web');
    // Typed text wins over the selection, even while ↑↓ keep moving it.
    const own = handleKey(handleKey(typed(s, 'acme/api'), key('up'), 0).state, key('return'), 0);
    expect(own.effects[0]?.kind === 'answer' && own.effects[0].answers[0]!.content).toBe('acme/api');
  });

  test('with no options: enter on an empty input does nothing, typed text answers, ↑ recalls history', () => {
    const s = asked({ ...sceneWorking().state, ui: { ...sceneWorking().state.ui, history: ['earlier'] } }, []);
    const empty = handleKey(s, key('return'), 0);
    expect(empty.effects).toEqual([]);
    expect(empty.state).toBe(s);
    expect(handleKey(s, key('up'), 0).state.ui.input.text).toBe('earlier');
    const r = handleKey(typed(s, 'Crash on login'), key('return'), 0);
    expect(r.effects[0]?.kind === 'answer' && r.effects[0].answers[0]!.content).toBe('Crash on login');
  });

  test('the approval screen keeps priority and slash commands still run', () => {
    const appr = sceneApproval().state;
    const both = asked(appr);
    expect(handleKey(both, key('1'), appr.approval!.openedAt + 1000).effects).toEqual([]);
    const s = typed(asked(sceneWorking().state), '/new');
    expect(handleKey(s, key('return'), 0).effects).toEqual([{ kind: 'new' }]);
  });

  test('a batch is asked one at a time and sent together', () => {
    let s = reduce(sceneWorking().state, { type: 'turn', ev: { type: 'question', calls: [call('q1', 'Which repo?', ['a', 'b']), call('q2', 'Label?', [])] }, at: 1 });
    expect(paint(s).join('\n')).toContain('1 of 2');
    const first = handleKey(handleKey(s, key('2'), 0).state, key('return'), 0);
    expect(first.effects).toEqual([]);
    s = first.state;
    expect(s.ui.input.text).toBe('');
    expect(paint(s).join('\n')).toContain('Label?');
    const r = handleKey(typed(s, 'bug'), key('return'), 0);
    expect(r.effects).toEqual([{ kind: 'answer', answers: [
      { threadId: 'main', callId: 'q1', question: 'Which repo?', content: 'b' },
      { threadId: 'main', callId: 'q2', question: 'Label?', content: 'bug' },
    ] }]);
  });

  test('a result for the question clears it and leaves the answer; unrelated results do not', () => {
    let s = asked(sceneWorking().state);
    const running = s.items.find((it): it is StepItem => it.kind === 'step' && it.state === 'running')!;
    s = reduce(s, { type: 'turn', ev: { type: 'tool.result', threadId: 'main', callId: running.callId!, name: running.tool, content: 'ok', isError: false }, at: 2 });
    expect(s.question).not.toBeNull();
    s = reduce(s, { type: 'turn', ev: { type: 'tool.result', threadId: 'main', callId: 'nope', name: '', content: 'ok', isError: false }, at: 2 });
    expect(s.question).not.toBeNull();
    s = reduce(s, { type: 'turn', ev: { type: 'tool.result', threadId: 'main', callId: 'q1', name: 'ask_user_question', content: 'acme/web', isError: false }, at: 3 });
    expect(s.question).toBeNull();
    expect(s.items.at(-1)).toMatchObject({ kind: 'note', glyph: '›', text: 'Which repo should I file the issue in? · acme/web' });
    expect(paint(s).join('\n')).not.toContain('monk asks');
  });

  test('a finished or newer turn, or a reset, closes the question; the paused asking turn does not', () => {
    const start = reduce(initialState(0), { type: 'turn', ev: { type: 'turn.started', turnId: 't1' }, at: 0 });
    const s = asked(start);
    expect(s.question!.turnId).toBe('t1');
    expect(reduce(s, done('paused')).question).not.toBeNull();
    expect(reduce(s, { type: 'turn', ev: { type: 'turn.started', turnId: 't1' }, at: 2 }).question).not.toBeNull();
    expect(reduce(s, { type: 'turn', ev: { type: 'turn.started', turnId: 't2' }, at: 2 }).question).toBeNull();
    expect(reduce(s, done('done')).question).toBeNull();
    expect(reduce(s, { type: 'extra', ev: { kind: 'reset' }, at: 2 }).question).toBeNull();
  });
});

describe('ask_user_question through the live backend', () => {
  type Raw = Record<string, unknown>;
  const at = '2026-09-26T00:00:00Z';
  const ev = (e: Raw): Raw => ({ createdAt: at, threadId: 'main', ...e });
  const turnDone = (paused: boolean) =>
    ev({ type: 'turn.done', id: `d${paused}`, threadId: null, state: { status: 'done', completedAt: at, output: null, requiredActions: paused ? [{}] : [], metrics: { totalInputTokens: 1, totalOutputTokens: 1 } } });
  const asking: Raw[] = [
    ev({ type: 'turn.created', id: 't1', turnId: 'T1', input: [{ type: 'user.message', content: 'file a bug' }] }),
    ev({ type: 'model.message', id: 'm1', content: '', toolCalls: [{ id: 'q1', type: 'function', function: { name: 'ask_user_question', arguments: JSON.stringify({ question: 'Which repo?', options: ['acme/app', 'acme/web'] }) }, toolInfo: { type: 'local', name: 'ask_user_question' } }] }),
    ev({ type: 'tool.response_required', id: 'r1', toolCalls: [{ id: 'q1', sourceEventId: 'm1' }] }),
    turnDone(true),
  ];
  const answering: Raw[] = [
    ev({ type: 'turn.created', id: 't2', turnId: 'T2', input: [{ type: 'user.tool_response', threadId: 'main', toolCallId: 'q1', content: 'acme/web' }] }),
    ev({ type: 'model.message', id: 'm2', content: 'Filed it in acme/web.' }),
    turnDone(false),
  ];

  async function backend(): Promise<{ b: Record<string, unknown> & { run: (e: unknown) => Promise<void> }; actions: import('../src/state/actions.ts').Action[]; turns: unknown[][] }> {
    // The live backend remembers sessions in ~/.monk/tui.json; never touch the real one.
    const remembered: string[] = [];
    mock.module('../src/backend/session-file.ts', () => ({ lastSessionId: () => null, rememberSession: (id: string) => remembered.push(id) }));
    const { LiveBackend } = await import('../src/backend/live.ts');
    const { rememberSession } = await import('../src/backend/session-file.ts');
    rememberSession('probe');
    expect(remembered).toEqual(['probe']);
    const cfg = { TRUEFORGE_URL: 'http://127.0.0.1:9', monkApiUrl: 'http://127.0.0.1:9', chaosProxyUrl: 'http://127.0.0.1:9/mcp', MODEL: 'm' };
    const b = new LiveBackend(cfg as never, { continue: false }) as unknown as Record<string, unknown> & { run: (e: unknown) => Promise<void> };
    const actions: import('../src/state/actions.ts').Action[] = [];
    const turns: unknown[][] = [];
    let state = initialState(0);
    b.dispatch = (a: import('../src/state/actions.ts').Action) => {
      actions.push(a);
      state = reduce(state, a);
    };
    b.getState = () => state;
    b.api = { reportCost: async () => ({}) };
    b.refreshStatus = async () => {};
    b.client = {
      sessions: {
        createTurnStream: async (_sid: string, req: { input: unknown[] }) => {
          turns.push(req.input);
          return (async function* () {
            yield* answering;
          })();
        },
        listEvents: async () => [] as unknown[],
      },
    };
    return { b, actions, turns };
  }
  const replay = async (b: Record<string, unknown>, turns: Raw[][]) => {
    // Newest first, the way TrueForge lists them.
    const items = turns.flatMap((t) => t.map((event) => ({ turnId: (t[0] as { turnId: string }).turnId, event }))).reverse();
    (b.client as { sessions: Record<string, unknown> }).sessions.listEvents = async () => items;
    await (b.resume as (id: string) => Promise<void>).call(b, 'ses_1');
  };

  test('resume of an unanswered question ends with the card open', async () => {
    const { b, actions } = await backend();
    await replay(b, [asking]);
    const s = reduceAll(initialState(0), actions);
    expect(s.question?.calls[0]).toMatchObject({ callId: 'q1', question: 'Which repo?', options: ['acme/app', 'acme/web'] });
    expect(paintScreen(s, { now: 0, still: true, reduced: false }, 120, 36).lines().join('\n')).toContain('› 1  acme/app');
  });

  test('resume of an answered question (here or on Telegram) ends with no card and the answer shown', async () => {
    const { b, actions } = await backend();
    await replay(b, [asking, answering]);
    const s = reduceAll(initialState(0), actions);
    expect(s.question).toBeNull();
    const text = paintScreen(s, { now: 0, still: true, reduced: false }, 120, 36).lines().join('\n');
    expect(text).not.toContain('monk asks');
    expect(text).toContain('›  Which repo? · acme/web');
    expect(text).toContain('Filed it in acme/web.');
  });

  test('answering from the keyboard sends a tool response for the call the card showed', async () => {
    const { b, turns } = await backend();
    await replay(b, [asking]);
    const s = (b.getState as () => AppState)();
    const r = handleKey(handleKey(s, key('2'), 0).state, key('return'), 0);
    b.getState = () => r.state;
    await b.run(r.effects[0]);
    await (b.running as Promise<void> | null);
    expect(turns[0]).toEqual([{ type: 'user.tool_response', threadId: 'main', toolCallId: 'q1', content: 'acme/web' }]);
  });
});
