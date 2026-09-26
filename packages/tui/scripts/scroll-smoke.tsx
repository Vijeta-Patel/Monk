// End-to-end check of conversation scrolling in the real App under OpenTUI's test renderer: a
// scripted backend fills the chat past a screen, then the wheel, pgup, shift+↑, home and end move
// the view through real terminal input, and rows that arrive while scrolled back don't pull it down.
//   bun run scripts/scroll-smoke.tsx [cols] [rows] [--print]
import { testRender } from '@opentui/react/test-utils';
import { Ticker } from '../src/anim/ticker.ts';
import { App } from '../src/app.tsx';
import type { Dispatch, MonkBackend } from '../src/backend/types.ts';
import { computeLayout } from '../src/layout.ts';
import { createTheme } from '../src/theme.ts';

const sizes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cols = Number(sizes[0] ?? 120);
const rows = Number(sizes[1] ?? 36);
const print = process.argv.includes('--print');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plays nothing by itself; the script pushes exchanges in, like messages arriving from Telegram. */
class ScriptedBackend implements MonkBackend {
  readonly kind = 'demo' as const;
  private dispatch: Dispatch = () => {};
  async start(dispatch: Dispatch): Promise<void> {
    this.dispatch = dispatch;
  }
  async run(): Promise<void> {}
  async stop(): Promise<void> {}
  exchange(i: number): void {
    const at = Date.now();
    this.dispatch({ type: 'send', text: `question ${i}`, at });
    this.dispatch({ type: 'turn', ev: { type: 'message', threadId: 'main', content: `answer ${i}\nsecond line\nthird line` }, at });
    this.dispatch({ type: 'turn', ev: { type: 'turn.done', status: 'done', output: '', inputTokens: 1, outputTokens: 1 }, at });
  }
}

const backend = new ScriptedBackend();
const setup = await testRender(
  <App backend={backend} ticker={new Ticker()} theme={createTheme('dark', 'truecolor')} reduced={false} onQuit={() => {}} />,
  { width: cols, height: rows, useMouse: true, enableMouseMovement: false },
);
const l = computeLayout(cols, rows);
const page = l.bodyBottom - l.bodyTop + 1 - 2;
const frame = async () => {
  await sleep(30);
  await setup.renderOnce();
  return setup.captureCharFrame();
};
/** The conversation column only. */
const conversation = (f: string) =>
  f
    .split('\n')
    .slice(l.bodyTop, l.bodyBottom + 1)
    .map((ln) => ln.slice(0, l.convX + l.convW));
const hint = (f: string) => (f.split('\n')[l.inputTop - 1] ?? '').trim();
const checks: [string, boolean][] = [];
const expect = (name: string, ok: boolean) => checks.push([name, ok]);

await sleep(100);
for (let i = 1; i <= 12; i++) backend.exchange(i);
let f = await frame();
expect('following shows the newest answer', f.includes('answer 12'));
expect('no hint while following', hint(f) === '');

await setup.mockMouse.scroll(5, 5, 'up');
await setup.mockMouse.scroll(5, 5, 'up');
f = await frame();
expect('two wheel notches go back 6 rows', hint(f) === '↓ 6 more · end to follow');
expect('the newest answer is below the view', !f.includes('answer 12') && f.includes('answer 11'));

await setup.mockInput.pressKeys(['\x1b[5~']);
f = await frame();
expect(`pgup goes back a page (${page} rows)`, hint(f) === `↓ ${6 + page} more · end to follow`);
setup.mockInput.pressArrow('up', { shift: true });
f = await frame();
expect('shift+↑ goes back one more row', hint(f) === `↓ ${7 + page} more · end to follow`);

const before = conversation(f);
backend.exchange(13);
const scrolled = await frame();
expect('a new exchange leaves the view where it was', JSON.stringify(conversation(scrolled)) === JSON.stringify(before));
expect('and counts as new', hint(scrolled) === '↓ 6 new · end to follow');

setup.mockInput.pressKey('p', { ctrl: true });
await setup.mockMouse.scroll(5, 5, 'down');
setup.mockInput.pressEscape();
f = await frame();
expect('the wheel does nothing under a popup', hint(f) === '↓ 6 new · end to follow');

setup.mockInput.pressKey('HOME');
f = await frame();
expect('home shows the oldest question at the top', (conversation(f)[1] ?? '').includes('› question 1'));

setup.mockInput.pressKey('END');
f = await frame();
expect('end follows again', f.includes('answer 13') && hint(f) === '');

await setup.mockMouse.scroll(5, 5, 'up');
f = await frame();
expect('scrolled back again', hint(f) === '↓ 3 more · end to follow');
await setup.mockInput.typeText('hi');
setup.mockInput.pressEnter();
f = await frame();
expect('sending a message follows again', hint(f) === '');

if (print) console.log(`${scrolled}\n`);
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
setup.renderer.destroy();
process.exit(failed ? 1 : 0);
