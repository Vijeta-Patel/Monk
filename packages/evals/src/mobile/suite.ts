import type { CheckResult, Task, TaskContext } from '../types.ts';
import type { Adb } from './adb.ts';

export const CONTACT_NAME = 'Ada Monk';
export const CONTACT_PHONE = '+1 555 0142';
export const SEARCH_QUERY = 'Alan Turing Wikipedia';
export const FILES_DIR = '/sdcard/Download';
export const FILE_NAME = 'monk-note.txt';
export const FOLDER_NAME = 'MonkNotes';

const ok = (detail: string): CheckResult => ({ passed: true, detail });
const fail = (detail: string): CheckResult => ({ passed: false, detail });
const digits = (s: string) => s.replace(/\D/g, '');

function need(ctx: TaskContext): Adb {
  if (!ctx.adb) throw new Error('mobile suite needs adb');
  return ctx.adb;
}

const shell = (adb: Adb, ...cmd: string[]) => adb(['shell', ...cmd]).catch(() => '');

/** Puts the Files task's input in place; only touches Monk-named paths. */
export async function ensureMobileFixtures(adb: Adb): Promise<void> {
  await adb(['shell', `rm -rf ${FILES_DIR}/${FOLDER_NAME} && mkdir -p ${FILES_DIR} && echo 'Monk eval fixture' > ${FILES_DIR}/${FILE_NAME}`]);
}

/** Rows of `content query` output as key/value maps. */
export function parseContentRows(out: string): Record<string, string>[] {
  return out
    .split('\n')
    .filter((l) => l.startsWith('Row:'))
    .map((l) => {
      const row: Record<string, string> = {};
      const body = l.replace(/^Row:\s*\d+\s*/, '');
      for (const m of body.matchAll(/(\w+)=(.*?)(?=, \w+=|$)/g)) row[m[1]!] = m[2]!.trim();
      return row;
    });
}

export async function alarmSetAt(adb: Adb, hour: number, minute: number): Promise<boolean> {
  for (const pkg of ['com.google.android.deskclock', 'com.android.deskclock']) {
    const rows = parseContentRows(await shell(adb, 'content', 'query', '--uri', `content://${pkg}/alarms`));
    if (rows.some((r) => Number(r.hour) === hour && Number(r.minutes) === minute && r.enabled !== '0')) return true;
  }
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const dump = await shell(adb, 'dumpsys', 'alarm');
  const idx = dump.search(/next alarm clock/i);
  if (idx >= 0 && new RegExp(`\\b${hhmm}(:00)?\\b`).test(dump.slice(idx, idx + 2000))) return true;
  return dump.split('\n').some((l) => /deskclock/i.test(l) && /alarm_?clock|AlarmClock/i.test(l) && l.includes(hhmm));
}

export const mobileSuite: Task[] = [
  {
    id: 'mob-01-dark-mode',
    suite: 'mobile',
    split: 'learn',
    title: 'Turn on dark mode in Settings',
    destructive: false,
    prompt: () => 'On the phone, open Settings and turn on dark mode (dark theme).',
    async check(ctx) {
      const v = (await shell(need(ctx), 'settings', 'get', 'secure', 'ui_night_mode')).trim();
      return v === '2' ? ok('ui_night_mode=2') : fail(`ui_night_mode=${v || '(empty)'}`);
    },
  },
  {
    id: 'mob-02-alarm',
    suite: 'mobile',
    split: 'learn',
    title: 'Set an alarm for 7:30',
    destructive: false,
    prompt: () => 'On the phone, open the Clock app and set an alarm for 7:30 AM.',
    async check(ctx) {
      return (await alarmSetAt(need(ctx), 7, 30)) ? ok('alarm at 07:30 found') : fail('no enabled 07:30 alarm');
    },
  },
  {
    id: 'mob-03-contact',
    suite: 'mobile',
    split: 'learn',
    title: 'Add a contact',
    destructive: false,
    prompt: () => `On the phone, open Contacts and add a contact named "${CONTACT_NAME}" with phone number ${CONTACT_PHONE}. Save it.`,
    async check(ctx) {
      const rows = parseContentRows(
        await shell(need(ctx), 'content', 'query', '--uri', 'content://com.android.contacts/data/phones', '--projection', 'display_name:data1'),
      );
      const hit = rows.find((r) => r.display_name === CONTACT_NAME && digits(r.data1 ?? '').endsWith(digits(CONTACT_PHONE).slice(-7)));
      return hit ? ok(`contact ${CONTACT_NAME} saved`) : fail(`no contact ${CONTACT_NAME} with ${CONTACT_PHONE}`);
    },
  },
  {
    id: 'mob-04-browser-search',
    suite: 'mobile',
    split: 'learn',
    title: 'Search in the browser and report the first result',
    destructive: false,
    prompt: () => `On the phone, open the browser, search for "${SEARCH_QUERY}", and tell me the title of the first result.`,
    async check(ctx) {
      const focus = (await shell(need(ctx), 'dumpsys', 'window')).split('\n').find((l) => /mCurrentFocus/.test(l)) ?? '';
      if (!/chrome|browser/i.test(focus)) return fail(`browser not in focus (${focus.trim() || 'unknown'})`);
      return /alan turing/i.test(ctx.answer) ? ok('browser open, answer names the result') : fail('answer does not name the first result');
    },
  },
  {
    id: 'mob-05-files-move',
    suite: 'mobile',
    split: 'heldout',
    title: 'Create a folder and move a file into it',
    destructive: false,
    prompt: () => `On the phone, open the Files app. In Downloads, create a folder named "${FOLDER_NAME}" and move ${FILE_NAME} into it.`,
    async check(ctx) {
      const adb = need(ctx);
      const inFolder = (await shell(adb, 'ls', `${FILES_DIR}/${FOLDER_NAME}`)).split(/\s+/).includes(FILE_NAME);
      const stillOutside = (await shell(adb, 'ls', FILES_DIR)).split(/\s+/).includes(FILE_NAME);
      if (!inFolder) return fail(`${FILE_NAME} not in ${FOLDER_NAME}`);
      return stillOutside ? fail(`${FILE_NAME} copied, not moved`) : ok('file moved into new folder');
    },
  },
  {
    id: 'mob-06-android-version',
    suite: 'mobile',
    split: 'heldout',
    title: 'Report the Android version from Settings',
    destructive: false,
    prompt: () => 'On the phone, open Settings, find the Android version, and tell me what it is.',
    async check(ctx) {
      const v = (await shell(need(ctx), 'getprop', 'ro.build.version.release')).trim();
      if (!v) return fail('could not read ro.build.version.release');
      const re = new RegExp(`(?<![\\d.])${v.replace(/\./g, '\\.')}(?![\\d])`);
      return re.test(ctx.answer) ? ok(`answer has Android ${v}`) : fail(`answer lacks Android ${v}`);
    },
  },
];
