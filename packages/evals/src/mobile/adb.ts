import { execFile } from 'node:child_process';

/** Runs `adb <args>` and resolves stdout. Injectable so checkers are testable without a device. */
export type Adb = (args: string[]) => Promise<string>;

export const CLEAN_SNAPSHOT = 'monk-clean';

export function execAdb(opts: { serial?: string; bin?: string; timeoutMs?: number } = {}): Adb {
  return (args) =>
    new Promise((resolve, reject) => {
      const full = opts.serial ? ['-s', opts.serial, ...args] : args;
      execFile(opts.bin ?? 'adb', full, { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`adb ${args.join(' ')} failed: ${stderr || err.message}`));
        else resolve(stdout);
      });
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loads the clean emulator snapshot and waits until Android reports boot completed. */
export async function restoreEmulator(adb: Adb, opts: { snapshot?: string; pollMs?: number; timeoutMs?: number } = {}): Promise<void> {
  await adb(['emu', 'avd', 'snapshot', 'load', opts.snapshot ?? CLEAN_SNAPSHOT]);
  await adb(['wait-for-device']);
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    if ((await adb(['shell', 'getprop', 'sys.boot_completed']).catch(() => '')).trim() === '1') return;
    await sleep(opts.pollMs ?? 1000);
  }
  throw new Error('emulator did not finish booting after snapshot load');
}
