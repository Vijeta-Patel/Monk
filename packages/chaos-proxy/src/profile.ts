import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { DESTRUCTIVE_TOOL_GLOBS, FaultTypeSchema, type FaultType } from '@monk/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ProfileSchema = z.object({
  name: z.string().min(1),
  seed: z.number().int().default(42),
  fault_rate: z.number().min(0).max(1),
  faults: z.partialRecord(FaultTypeSchema, z.number().min(0)).nullish().transform((v) => v ?? {}),
  protect: z.array(z.string()).nullish().transform((v) => v ?? []),
  max_faults_per_session: z.number().int().min(0).default(8),
  /** Adds urgent-sounding text nudging the agent toward destructive tools. */
  pressure: z.boolean().default(false),
  /** Delay for latency_spike. */
  latency_ms: z.number().int().min(0).default(8000),
  /** How long a `timeout` fault hangs before erroring. */
  timeout_ms: z.number().int().min(0).default(20000),
}).strict();

export type ChaosProfile = z.infer<typeof ProfileSchema> & { faults: Partial<Record<FaultType, number>> };

export function profilesDir(rootDir: string): string {
  return join(rootDir, 'chaos', 'profiles');
}

/** Loads `chaos/profiles/<name>.yaml` or a YAML path. `protect` always includes DESTRUCTIVE_TOOL_GLOBS. */
export async function loadProfile(nameOrPath: string, rootDir: string): Promise<ChaosProfile> {
  const looksLikePath = /[\\/]/.test(nameOrPath) || /\.ya?ml$/i.test(nameOrPath);
  const path = looksLikePath
    ? (isAbsolute(nameOrPath) ? nameOrPath : resolve(rootDir, nameOrPath))
    : join(profilesDir(rootDir), `${nameOrPath}.yaml`);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`chaos profile not found: ${nameOrPath} (looked at ${path})`);
  }
  return parseProfile(text, basename(path, extname(path)));
}

export function parseProfile(text: string, fallbackName = 'custom'): ChaosProfile {
  const raw = parseYaml(text) as Record<string, unknown> | null;
  const res = ProfileSchema.safeParse({ name: fallbackName, ...(raw ?? {}) });
  if (!res.success) throw new Error(`invalid chaos profile ${fallbackName}: ${z.prettifyError(res.error)}`);
  const p = res.data;
  return { ...p, protect: [...new Set([...DESTRUCTIVE_TOOL_GLOBS, ...p.protect])] };
}

export async function listProfiles(rootDir: string): Promise<string[]> {
  try {
    const files = await readdir(profilesDir(rootDir));
    return files.filter((f) => /\.ya?ml$/i.test(f)).map((f) => basename(f, extname(f))).sort();
  } catch {
    return [];
  }
}

/** Used when no `off.yaml` exists on disk. */
export const OFF_PROFILE: ChaosProfile = parseProfile('name: off\nfault_rate: 0\nfaults: {}\nmax_faults_per_session: 0\n', 'off');
