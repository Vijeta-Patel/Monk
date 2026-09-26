import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameIndex, spinner } from '../src/anim/frames.ts';
import { SCENES, sceneApproval, sceneIdle, sceneWorking } from '../src/demo/scenes.ts';
import { computeLayout } from '../src/layout.ts';
import { paintScreen } from '../src/paint/screen.ts';
import { truncate, width, wrap } from '../src/render/text.ts';
import { handleKey, type Key } from '../src/state/keys.ts';
import { initialState, reduce } from '../src/state/reducer.ts';

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
