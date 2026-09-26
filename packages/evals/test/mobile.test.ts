import { describe, expect, it } from 'vitest';
import { restoreEmulator } from '../src/mobile/adb.ts';
import { ensureMobileFixtures, mobileSuite, parseContentRows } from '../src/mobile/suite.ts';
import type { FixtureIds, TaskContext } from '../src/types.ts';
import { fakeAdb } from './fakes.ts';

const fixtures: FixtureIds = { issues: {}, pulls: {}, branches: {}, tag: null, defaultBranch: 'main', seededAt: '' };
const ctx = (adb: TaskContext['adb'], answer = ''): TaskContext => ({
  repo: { owner: '', name: '' }, fixtures, gh: null, adb, answer, events: [], startedAt: new Date(),
});
const task = (prefix: string) => mobileSuite.find((t) => t.id.startsWith(prefix))!;
const NOPE = new Error('No such file');

describe('mobile suite', () => {
  it('has 6 tasks, 4 learn and 2 held out', () => {
    expect(mobileSuite).toHaveLength(6);
    expect(mobileSuite.filter((t) => t.split === 'heldout').map((t) => t.id.slice(0, 6))).toEqual(['mob-05', 'mob-06']);
  });

  it('dark mode reads ui_night_mode', async () => {
    const key = 'shell settings get secure ui_night_mode';
    expect((await task('mob-01').check(ctx(fakeAdb({ [key]: '2\n' })))).passed).toBe(true);
    expect((await task('mob-01').check(ctx(fakeAdb({ [key]: '1\n' })))).passed).toBe(false);
  });

  it('alarm via the deskclock provider, or dumpsys fallback', async () => {
    const google = 'shell content query --uri content://com.google.android.deskclock/alarms';
    const aosp = 'shell content query --uri content://com.android.deskclock/alarms';
    const dump = 'shell dumpsys alarm';
    const viaProvider = fakeAdb({ [google]: 'Row: 0 _id=1, hour=7, minutes=30, enabled=1, label=\n', [aosp]: NOPE, [dump]: '' });
    expect((await task('mob-02').check(ctx(viaProvider))).passed).toBe(true);
    const viaDump = fakeAdb({ [google]: NOPE, [aosp]: NOPE, [dump]: 'Next alarm clock information:\n  user:0 pendingSend:false time=2026-09-24 07:30:00.000 = 179\n' });
    expect((await task('mob-02').check(ctx(viaDump))).passed).toBe(true);
    const wrong = fakeAdb({ [google]: 'Row: 0 _id=1, hour=8, minutes=30, enabled=1\n', [aosp]: NOPE, [dump]: 'Next alarm clock information:\n time=2026-09-24 08:30:00.000\n' });
    expect((await task('mob-02').check(ctx(wrong))).passed).toBe(false);
  });

  it('contact via the contacts provider', async () => {
    const key = 'shell content query --uri content://com.android.contacts/data/phones --projection display_name:data1';
    expect((await task('mob-03').check(ctx(fakeAdb({ [key]: 'Row: 0 display_name=Ada Monk, data1=+1 555-0142\n' })))).passed).toBe(true);
    expect((await task('mob-03').check(ctx(fakeAdb({ [key]: 'Row: 0 display_name=Ada Monk, data1=+1 555-0199\n' })))).passed).toBe(false);
    expect((await task('mob-03').check(ctx(fakeAdb({ [key]: 'No result found.\n' })))).passed).toBe(false);
  });

  it('browser search needs the browser in focus and the title in the answer', async () => {
    const key = 'shell dumpsys window';
    const chrome = fakeAdb({ [key]: '  mCurrentFocus=Window{1 u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity}\n' });
    expect((await task('mob-04').check(ctx(chrome, 'First result: Alan Turing - Wikipedia'))).passed).toBe(true);
    expect((await task('mob-04').check(ctx(chrome, 'I could not search'))).passed).toBe(false);
    const home = fakeAdb({ [key]: '  mCurrentFocus=Window{1 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}\n' });
    expect((await task('mob-04').check(ctx(home, 'Alan Turing'))).passed).toBe(false);
  });

  it('files move: in the folder and gone from Downloads', async () => {
    const inside = 'shell ls /sdcard/Download/MonkNotes';
    const outside = 'shell ls /sdcard/Download';
    expect((await task('mob-05').check(ctx(fakeAdb({ [inside]: 'monk-note.txt\n', [outside]: 'MonkNotes\n' })))).passed).toBe(true);
    expect((await task('mob-05').check(ctx(fakeAdb({ [inside]: 'monk-note.txt\n', [outside]: 'MonkNotes\nmonk-note.txt\n' })))).passed).toBe(false);
    expect((await task('mob-05').check(ctx(fakeAdb({ [inside]: NOPE, [outside]: 'monk-note.txt\n' })))).passed).toBe(false);
  });

  it('android version from getprop', async () => {
    const adb = fakeAdb({ 'shell getprop ro.build.version.release': '15\n' });
    expect((await task('mob-06').check(ctx(adb, 'This phone runs Android 15.'))).passed).toBe(true);
    expect((await task('mob-06').check(ctx(adb, 'Android 150'))).passed).toBe(false);
    expect((await task('mob-06').check(ctx(adb, 'Android 14'))).passed).toBe(false);
  });

  it('restoreEmulator loads the monk-clean snapshot and waits for boot', async () => {
    const adb = fakeAdb({ 'emu avd snapshot load monk-clean': 'OK', 'wait-for-device': '', 'shell getprop sys.boot_completed': '1\n' });
    await restoreEmulator(adb, { pollMs: 1 });
    expect(adb.calls[0]).toEqual(['emu', 'avd', 'snapshot', 'load', 'monk-clean']);
    const fx = fakeAdb({ "shell rm -rf /sdcard/Download/MonkNotes && mkdir -p /sdcard/Download && echo 'Monk eval fixture' > /sdcard/Download/monk-note.txt": '' });
    await ensureMobileFixtures(fx);
    expect(fx.calls).toHaveLength(1);
  });

  it('parses content query rows', () => {
    expect(parseContentRows('Row: 0 a=1, b=x, y\nRow: 1 a=2, b=\n')).toEqual([{ a: '1', b: 'x, y' }, { a: '2', b: '' }]);
  });
});
