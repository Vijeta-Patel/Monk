import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const ConfigSchema = z.object({
  /** OpenAI-compatible endpoint (your LiteLLM proxy), including /v1. */
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  /** Model names as the proxy knows them; `monk models` suggests the cheapest with tool calling. */
  MODEL: z.string().default(''),
  VISION_MODEL: z.string().default(''),
  TRUEFORGE_URL: z.string().default('http://localhost:8790'),
  TRUEFORGE_TOKEN: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  /** How to run GitHub's MCP server: its docker image, its hosted endpoint, or a local binary. */
  GITHUB_MCP: z.enum(['docker', 'remote', 'binary']).default('docker'),
  /** Extra MCP servers the chaos proxy wraps (JSON, see mcp-servers.example.json). */
  MCP_SERVERS_FILE: z.string().default('./mcp-servers.json'),
  EVAL_REPO: z.string().default(''),
  SKILLS_REPO_URL: z.string().default(''),
  SKILLS_REPO_REF: z.string().default('main'),
  SKILLS_REPO_PATH: z.string().default('./data/skills-repo'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  DISCORD_BOT_TOKEN: z.string().default(''),
  ALLOWED_USERS: z.string().default(''),
  CHAOS_ENABLED: bool.default(true),
  CHAOS_PROFILE: z.string().default('moderate'),
  CHAOS_PROXY_PORT: z.coerce.number().int().default(8787),
  MONK_API_PORT: z.coerce.number().int().default(8788),
  MONK_API_URL: z.string().default(''),
  /** Interface the proxy and API listen on; 0.0.0.0 inside containers. */
  MONK_BIND_HOST: z.string().default('127.0.0.1'),
  /** URL TrueForge uses to reach the chaos proxy, when it differs from localhost (compose). */
  CHAOS_PROXY_PUBLIC_URL: z.string().default(''),
  MONK_DB_PATH: z.string().default('./data/monk.db'),
  MONK_PHONE: bool.default(false),
  DAYTONA_API_KEY: z.string().default(''),
  /** TrueForge has patches/0001-subagent-models applied: subagents may pick a model. */
  TRUEFORGE_SUBAGENT_MODELS: bool.default(false),
  TIMEZONE: z.string().default('Asia/Kolkata'),
  /** AgentEye (Failproof AI) for observability + evals; export is off while the key is empty. */
  AGENTEYE_URL: z.string().default('http://localhost:8080'),
  AGENTEYE_INGEST_KEY: z.string().default(''),
  AGENTEYE_ENVIRONMENT: z.string().default('monk-live'),
  AGENTEYE_AGENT_ID: z.string().default('monk'),
});

export type MonkConfig = z.infer<typeof ConfigSchema> & {
  rootDir: string;
  allowedUsers: string[];
  monkApiUrl: string;
  chaosProxyUrl: string;
};

/** Walks up from `start` to the directory holding pnpm-workspace.yaml. */
export function findRootDir(start = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

let cached: MonkConfig | undefined;

export function loadConfig(opts: { env?: Record<string, string | undefined>; rootDir?: string; reload?: boolean } = {}): MonkConfig {
  if (cached && !opts.reload && !opts.env) return cached;
  const rootDir = opts.rootDir ?? findRootDir();
  if (!opts.env) loadDotenv({ path: join(rootDir, '.env'), quiet: true });
  const env = opts.env ?? process.env;
  // Blank values in .env mean "unset", so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = ConfigSchema.parse(cleaned);
  const cfg: MonkConfig = {
    ...parsed,
    rootDir,
    SKILLS_REPO_PATH: resolve(rootDir, parsed.SKILLS_REPO_PATH),
    MONK_DB_PATH: parsed.MONK_DB_PATH === ':memory:' ? ':memory:' : resolve(rootDir, parsed.MONK_DB_PATH),
    allowedUsers: parsed.ALLOWED_USERS.split(',').map((s) => s.trim()).filter(Boolean),
    monkApiUrl: parsed.MONK_API_URL || `http://localhost:${parsed.MONK_API_PORT}`,
    chaosProxyUrl: `http://localhost:${parsed.CHAOS_PROXY_PORT}/mcp`,
  };
  if (!opts.env) cached = cfg;
  return cfg;
}

/** Names of config keys that are secrets; used by redaction. */
export const SECRET_KEYS = ['LLM_API_KEY', 'AGENTEYE_INGEST_KEY', 'GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'DAYTONA_API_KEY', 'TRUEFORGE_TOKEN'] as const;
