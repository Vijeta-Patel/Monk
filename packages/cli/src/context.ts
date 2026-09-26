import { createTrueForgeClient, loadConfig, openDb, refreshPricing, type MonkConfig, type MonkDb, type TrueForge } from '@monk/shared';

export type Ctx = { cfg: MonkConfig; db: MonkDb; client: TrueForge };

export function context(): Ctx {
  const cfg = loadConfig();
  if (cfg.LLM_BASE_URL) void refreshPricing(cfg);
  return { cfg, db: openDb(cfg.MONK_DB_PATH), client: createTrueForgeClient(cfg) };
}

/** Chaos control over HTTP, for commands running outside the `monk up` process. */
export function remoteChaos(cfg: MonkConfig) {
  const base = cfg.chaosProxyUrl.replace(/\/mcp$/, '');
  return {
    async set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }) {
      const res = await fetch(`${base}/chaos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`chaos proxy at ${base}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async tools(): Promise<{ name: string; destructive: boolean; upstream: string }[]> {
      const res = await fetch(`${base}/chaos/tools`);
      if (!res.ok) throw new Error(`chaos proxy at ${base}: ${res.status}`);
      return (await res.json()) as { name: string; destructive: boolean; upstream: string }[];
    },
  };
}

export const log = (msg: string) => process.stderr.write(`${msg}\n`);
