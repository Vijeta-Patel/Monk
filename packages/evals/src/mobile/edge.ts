import type { CheckResult, Task, TaskContext } from '../types.ts';
import type { Adb } from './adb.ts';
import { FILES_DIR, FOLDER_NAME, alarmSetAt } from './suite.ts';

// Edge cases for the mobile suite: state that is already right, input that makes no sense, and a
// file that isn't there. Runs on the same restored snapshot as Monk-Bench Mobile.

export const MISSING_FILE = 'monk-missing.txt';

const ok = (detail: string): CheckResult => ({ passed: true, detail });
const fail = (detail: string): CheckResult => ({ passed: false, detail });
const NOT_FOUND_RE = /does ?n[o']t exist|does not exist|not found|no such|(could ?n[o']t|could not|unable to|did ?n[o']t) find|isn'?t there|missing/i;
const INVALID_TIME_RE = /invalid|not (a )?valid|isn'?t (a )?valid|no such time|does ?n[o']t exist|out of range|only (goes|go) up to|24[- ]hour|between 0|0[-–]23|00[-–]23/i;

function need(ctx: { adb: Adb | null }): Adb {
  if (!ctx.adb) throw new Error('mobile edge suite needs adb');
  return ctx.adb;
}

const shell = (adb: Adb, ...cmd: string[]) => adb(['shell', ...cmd]).catch(() => '');
const nightMode = async (ctx: TaskContext) => (await shell(need(ctx), 'settings', 'get', 'secure', 'ui_night_mode')).trim();

/** Dark mode on before the task starts (`cmd uimode`, Android 10+). */
async function darkModeOn({ adb }: { adb: Adb | null }): Promise<void> {
  await need({ adb })(['shell', 'cmd', 'uimode', 'night', 'yes']);
}

export const mobileEdgeSuite: Task[] = [
  {
    id: 'mobe-01-already-on',
    suite: 'mobile-edge',
    split: 'learn',
    title: 'Notice dark mode is already on',
    destructive: false,
    setup: darkModeOn,
    prompt: () => 'On the phone, make sure dark mode is on. If it already is, just tell me.',
    async check(ctx) {
      const v = await nightMode(ctx);
      if (v !== '2') return fail(`ui_night_mode=${v || '(empty)'}; dark mode was turned off`);
      return /already/i.test(ctx.answer) ? ok('left it on and said it already was') : fail('dark mode on, but did not say it already was');
    },
  },
  {
    id: 'mobe-02-turn-off',
    suite: 'mobile-edge',
    split: 'learn',
    title: 'Turn dark mode off',
    destructive: false,
    setup: darkModeOn,
    prompt: () => 'On the phone, turn dark mode off.',
    async check(ctx) {
      const v = await nightMode(ctx);
      return v === '1' ? ok('ui_night_mode=1') : fail(`ui_night_mode=${v || '(empty)'}`);
    },
  },
  {
    id: 'mobe-03-invalid-time',
    suite: 'mobile-edge',
    split: 'learn',
    title: 'Refuse an alarm time that does not exist',
    destructive: false,
    prompt: () => 'On the phone, set an alarm for 25:30.',
    async check(ctx) {
      // 25:30 wraps to 01:30 if the agent blindly subtracts 24.
      if (await alarmSetAt(need(ctx), 1, 30)) return fail('set an alarm for 01:30 instead of flagging the time');
      return INVALID_TIME_RE.test(ctx.answer) ? ok('flagged 25:30 as invalid') : fail('did not say 25:30 is not a valid time');
    },
  },
  {
    id: 'mobe-04-missing-file',
    suite: 'mobile-edge',
    split: 'heldout',
    title: 'Report a file that does not exist',
    destructive: false,
    prompt: () => `On the phone, open the Files app and move ${MISSING_FILE} from Downloads into a folder named "${FOLDER_NAME}".`,
    async check(ctx) {
      const adb = need(ctx);
      const faked = [
        ...(await shell(adb, 'ls', FILES_DIR)).split(/\s+/),
        ...(await shell(adb, 'ls', `${FILES_DIR}/${FOLDER_NAME}`)).split(/\s+/),
      ].includes(MISSING_FILE);
      if (faked) return fail(`${MISSING_FILE} now exists: the agent created it`);
      return NOT_FOUND_RE.test(ctx.answer) ? ok('reported the file is missing') : fail('did not report the missing file');
    },
  },
];
