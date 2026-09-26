// End-to-end check of ask_user_question in the real App under OpenTUI's test renderer: a scripted
// backend asks, the "monk asks" card shows above the input, and a digit + enter, ↓ + enter and a
// typed answer (one starting with a digit too) each reach the backend as an answer for the asked call.
//   bun run scripts/question-smoke.tsx [cols] [rows] [--print]
import { testRender } from '@opentui/react/test-utils';
import { Ticker } from '../src/anim/ticker.ts';
import { App } from '../src/app.tsx';
import type { Dispatch, MonkBackend } from '../src/backend/types.ts';
import { computeLayout } from '../src/layout.ts';
import type { Effect } from '../src/state/keys.ts';
import { createTheme } from '../src/theme.ts';

const sizes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cols = Number(sizes[0] ?? 120);
const rows = Number(sizes[1] ?? 36);
const print = process.argv.includes('--print');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks when told to and keeps every effect it is asked to run. */
class ScriptedBackend implements MonkBackend {
  readonly kind = 'demo' as const;
  private dispatch: Dispatch = () => {};
  effects: Effect[] = [];
  async start(dispatch: Dispatch): Promise<void> {
    this.dispatch = dispatch;
  }
  async run(e: Effect): Promise<void> {
    this.effects.push(e);
    if (e.kind === 'send') this.dispatch({ type: 'send', text: e.text, at: Date.now() });
  }
  async stop(): Promise<void> {}
  ask(turnId: string, callId: string, question: string, options: string[]): void {
    const at = Date.now();
    const args = JSON.stringify({ question, options });
    this.dispatch({ type: 'turn', ev: { type: 'turn.started', turnId }, at });
    this.dispatch({ type: 'turn', ev: { type: 'tool.call', threadId: 'main', callId, name: 'ask_user_question', server: null, args }, at });
    this.dispatch({ type: 'turn', ev: { type: 'question', calls: [{ threadId: 'main', callId, name: 'ask_user_question', server: null, args, question, options }] }, at });
    this.dispatch({ type: 'turn', ev: { type: 'turn.done', status: 'paused', output: '', inputTokens: 1, outputTokens: 1 }, at });
  }
}

const backend = new ScriptedBackend();
const setup = await testRender(
  <App backend={backend} ticker={new Ticker()} theme={createTheme('dark', 'truecolor')} reduced={false} onQuit={() => {}} />,
  { width: cols, height: rows },
);
const l = computeLayout(cols, rows);
const frame = async () => {
  await sleep(30);
  await setup.renderOnce();
  return setup.captureCharFrame();
};
const lines = (f: string) => f.split('\n');
const answered = () => backend.effects.filter((e): e is Extract<Effect, { kind: 'answer' }> => e.kind === 'answer').at(-1)?.answers.map((a) => `${a.callId}=${a.content}`).join(',');
const checks: [string, boolean][] = [];
const expect = (name: string, ok: boolean) => checks.push([name, ok]);

await sleep(100);
await setup.mockInput.typeText('file the login crash');
setup.mockInput.pressEnter();
backend.ask('t1', 'q1', 'Which repo should I file the issue in?', ['acme/app (Recommended)', 'acme/web', 'Other']);
let f = await frame();
const open = f;
const top = lines(f).findIndex((ln) => ln.includes('monk asks'));
expect('the card shows the question', top > 0 && (lines(f)[top + 1] ?? '').includes('Which repo should I file the issue in?'));
expect('options are numbered with the first selected', (lines(f)[top + 3] ?? '').includes('› 1  acme/app (Recommended)') && (lines(f)[top + 4] ?? '').includes('2  acme/web'));
expect('the key line sits on the card', (lines(f)[l.bodyBottom] ?? '').includes('enter answer'));
expect('the input is still there under it', (lines(f)[l.inputTop + 1] ?? '').includes('or type your own answer'));

setup.mockInput.pressKey('2');
f = await frame();
expect('2 picks acme/web and waits for enter', f.includes('› 2  acme/web') && f.includes('monk asks') && answered() === undefined);
setup.mockInput.pressEnter();
f = await frame();
expect('enter answers acme/web for q1', answered() === 'q1=acme/web');
expect('and closes the card', !f.includes('monk asks'));

backend.ask('t1b', 'q1b', 'When should I ship it?', ['Today (Recommended)', 'Tomorrow', 'Other']);
await setup.mockInput.typeText('2 days please');
setup.mockInput.pressEnter();
f = await frame();
expect('an answer starting with a digit can be typed', answered() === 'q1b=2 days please' && !f.includes('monk asks'));
expect('and nothing of it goes out as a message', backend.effects.filter((e) => e.kind === 'send').length === 1);

backend.ask('t2', 'q2', 'Which label?', ['bug', 'crash', 'Other']);
setup.mockInput.pressArrow('down');
setup.mockInput.pressArrow('down');
setup.mockInput.pressArrow('up');
f = await frame();
expect('↓↓↑ selects the second option', f.includes('› 2  crash'));
setup.mockInput.pressEnter();
f = await frame();
expect('enter answers the selection', answered() === 'q2=crash' && !f.includes('monk asks'));

backend.ask('t3', 'q3', 'What should the issue be called?', []);
f = await frame();
const none = f;
expect('with no options it asks for a typed answer', f.includes('type your answer · enter to send'));
setup.mockInput.pressEnter();
f = await frame();
expect('enter on an empty input does nothing', f.includes('monk asks') && answered() === 'q2=crash');
await setup.mockInput.typeText('Crash on login');
setup.mockInput.pressEnter();
f = await frame();
expect('a typed answer is sent', answered() === 'q3=Crash on login' && !f.includes('monk asks'));

if (print) console.log(`${open}\n${none}\n`);
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
setup.renderer.destroy();
process.exit(failed ? 1 : 0);
