import { execFile } from 'node:child_process';

/** The phone as the chaos engine sees it. Real implementation is adb; tests pass a fake. */
export type Device = {
  foregroundApp(): Promise<string | null>;
  forceStop(pkg: string): Promise<void>;
  home(): Promise<void>;
  /** 0 = portrait, 1 = landscape (90°). */
  setRotation(rotation: 0 | 1 | 2 | 3): Promise<void>;
  getRotation(): Promise<number>;
  screenshot(): Promise<Buffer>;
  install(apkPath: string): Promise<string>;
};

export function runAdb(args: string[], opts: { timeoutMs?: number; binary?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.ADB_PATH || 'adb',
      args,
      { encoding: 'buffer', timeout: opts.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`adb ${args.join(' ')} failed: ${stderr.toString('utf8').trim() || err.message}`));
        else resolve(stdout);
      },
    );
  });
}

const text = async (args: string[], timeoutMs?: number) => (await runAdb(args, { timeoutMs })).toString('utf8');

export function adbDevice(): Device {
  return {
    async foregroundApp() {
      const out = await text(['shell', 'dumpsys', 'activity', 'activities']);
      const m = /(?:mResumedActivity|topResumedActivity|ResumedActivity)[^\n]*?\s([a-zA-Z0-9_.]+)\/[^\s}]+/.exec(out);
      return m?.[1] ?? null;
    },
    async forceStop(pkg) {
      await text(['shell', 'am', 'force-stop', pkg]);
    },
    async home() {
      await text(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    },
    async setRotation(r) {
      await text(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
      await text(['shell', 'settings', 'put', 'system', 'user_rotation', String(r)]);
    },
    async getRotation() {
      const out = await text(['shell', 'settings', 'get', 'system', 'user_rotation']);
      return Number.parseInt(out.trim(), 10) || 0;
    },
    screenshot: () => runAdb(['exec-out', 'screencap', '-p'], { binary: true }),
    install: (apkPath) => text(['install', '-r', apkPath], 180_000),
  };
}

/** True when `adb` is on PATH and a device is attached. */
export async function adbReady(): Promise<boolean> {
  try {
    return (await text(['get-state'], 5_000)).trim() === 'device';
  } catch {
    return false;
  }
}
