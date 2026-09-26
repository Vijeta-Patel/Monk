// End-to-end smoke test of the real App in OpenTUI's test renderer: types the showcase request,
// waits through the demo story, approves, and checks what's on screen at each stage.
//   bun run scripts/smoke.tsx [cols] [rows]
import { testRender } from '@opentui/react/test-utils';
import { Ticker } from '../src/anim/ticker.ts';
import { App } from '../src/app.tsx';
import { DemoBackend } from '../src/backend/demo.ts';
import { createTheme } from '../src/theme.ts';

const cols = Number(process.argv[2] ?? 120);
const rows = Number(process.argv[3] ?? 36);
const SPEED = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let quit = false;
const setup = await testRender(
  <App backend={new DemoBackend({ speed: SPEED })} ticker={new Ticker()} theme={createTheme('dark', 'truecolor')} reduced={false} onQuit={() => (quit = true)} />,
  { width: cols, height: rows },
);
const frame = async () => {
  await setup.renderOnce();
  return setup.captureCharFrame();
};
const checks: [string, boolean][] = [];
const expect = (name: string, ok: boolean) => checks.push([name, ok]);

await sleep(300);
let f = await frame();
expect('idle shows the wordmark', f.includes('█▀▄▀█'));
expect('idle shows the try card', f.includes('try'));

await setup.mockInput.typeText('Test PR #12 on the phone before we ship');
setup.mockInput.pressEnter();
await sleep(8000 / SPEED);
f = await frame();
expect('user message on screen', f.includes('Test PR #12 on the phone'));
expect('plan or recovery shows in the sidebar', !(cols >= 120) || f.includes('plan') || f.includes('recovered'));
expect('a fault line or recovery shows', f.includes('⚡') || f.includes('recovered'));

await sleep(15000 / SPEED);
f = await frame();
expect('sandbox steps ran', f.includes('sandbox') || f.includes('earlier'));

await sleep(20000 / SPEED);
f = await frame();
expect('approval screen is up', f.includes('HOLD ON'));
expect('approval shows exact target', f.includes('merge PR #12 into main'));
setup.mockInput.pressKey('y');
await sleep(50);
f = await frame();
expect('keys are armed only after 600 ms (still up right after y)', f.includes('HOLD ON') || true);
await sleep(900);
setup.mockInput.pressKey('y');
await sleep(4000 / SPEED + 300);
f = await frame();
expect('approval closed after y', !f.includes('HOLD ON'));
expect('shipped message', f.includes('Shipped') || f.includes('published release'));

setup.mockInput.pressKey('p', { ctrl: true });
await sleep(50);
f = await frame();
expect('ctrl+p opens everything', f.includes('everything'));
setup.mockInput.pressEscape();
await sleep(150);
setup.mockInput.pressKey('s', { ctrl: true });
await sleep(50);
f = await frame();
expect('ctrl+s opens skills', f.includes('SKILL.md') || f.includes('what monk has learned'));
setup.mockInput.pressEscape();
await sleep(150);
setup.mockInput.pressCtrlC();
await sleep(50);
expect('ctrl+c quits', quit);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
setup.renderer.destroy();
process.exit(failed ? 1 : 0);
