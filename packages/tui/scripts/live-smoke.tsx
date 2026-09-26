// Drives the real TUI against the live stack (TrueForge + Monk API): sends one question and
// prints the screen once the answer is in. Costs one model turn.
//   bun run scripts/live-smoke.tsx
import { testRender } from '@opentui/react/test-utils';
import { loadConfig } from '@monk/shared/config';
import { Ticker } from '../src/anim/ticker.ts';
import { App } from '../src/app.tsx';
import { LiveBackend } from '../src/backend/live.ts';
import { createTheme } from '../src/theme.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setup = await testRender(
  <App backend={new LiveBackend(loadConfig(), { continue: false })} ticker={new Ticker()} theme={createTheme('dark', 'truecolor')} reduced={false} onQuit={() => {}} />,
  { width: 120, height: 36 },
);
await sleep(2500);
await setup.mockInput.typeText('What is 17 times 23? Reply with just the number.');
setup.mockInput.pressEnter();
let frame = '';
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  await setup.renderOnce();
  frame = setup.captureCharFrame();
  if (/\b391\b/.test(frame) && /ready/.test(frame.split('\n')[0] ?? '')) break;
}
console.log(frame);
console.log(/\b391\b/.test(frame) ? '✓ live answer rendered' : '✗ no answer on screen');
setup.renderer.destroy();
process.exit(0);
