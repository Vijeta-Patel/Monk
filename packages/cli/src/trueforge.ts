import { spawn } from 'node:child_process';
import type { MonkConfig } from '@monk/shared';

/** Env TrueForge needs to reach Monk's chaos proxy on localhost past its SSRF guard. */
export function trueforgeEnv(cfg: MonkConfig): NodeJS.ProcessEnv {
  const port = new URL(cfg.TRUEFORGE_URL).port || '8790';
  return {
    ...process.env,
    PORT: port,
    OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify(['localhost', '127.0.0.1']),
  };
}

/** Runs stock TrueForge in the foreground (standalone mode, SQLite). */
export function runTrueForge(cfg: MonkConfig): Promise<number> {
  const env = trueforgeEnv(cfg);
  const child = spawn('npx', ['-y', '@truefoundry/trueforge@latest', '--port', env.PORT ?? '8790'], { stdio: 'inherit', env });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
}

export async function trueforgeReachable(cfg: MonkConfig): Promise<boolean> {
  try {
    const res = await fetch(new URL('/healthz', cfg.TRUEFORGE_URL), { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
