import { createHash } from 'node:crypto';
import { FAULT_TYPES, MOBILE_FAULT_TYPES, matchesAny, type FaultType } from '@monk/shared';
import type { ChaosProfile } from './profile.ts';

/**
 * Uniform floats in [0,1) derived only from (seed, call index, tool, salt). No clock, no session id:
 * the same task under the same seed replays the same faults.
 */
export function draws(seed: number, index: number, tool: string, salt = 'decide', n = 4): number[] {
  const buf = createHash('sha256').update(`${seed}|${index}|${tool}|${salt}`).digest();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(buf.readUInt32BE((i * 4) % 32) / 2 ** 32);
  return out;
}

/** A small PRNG seeded from the same inputs, for injectors that need several random choices. */
export function rng(seed: number, index: number, tool: string, salt: string): () => number {
  let state = Math.floor((draws(seed, index, tool, salt, 1)[0] ?? 0) * 2 ** 32) >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isProtected(tool: string, profile: Pick<ChaosProfile, 'protect'>): boolean {
  return matchesAny(tool, profile.protect);
}

export function applicableFaults(mobile: boolean): readonly FaultType[] {
  return mobile ? MOBILE_FAULT_TYPES : FAULT_TYPES;
}

export type DecideInput = {
  profile: ChaosProfile;
  seed: number;
  faultRate: number;
  index: number;
  tool: string;
  mobile: boolean;
  faultsSoFar: number;
  /** Faults that cannot apply to this call right now (e.g. stale_data with nothing to replay). */
  exclude?: readonly FaultType[];
};

export function decide(inp: DecideInput): FaultType | null {
  if (isProtected(inp.tool, inp.profile)) return null;
  if (inp.faultsSoFar >= inp.profile.max_faults_per_session) return null;
  const [u0 = 1, u1 = 0] = draws(inp.seed, inp.index, inp.tool);
  if (u0 >= inp.faultRate) return null;
  const allowed = new Set(applicableFaults(inp.mobile));
  const candidates = (Object.entries(inp.profile.faults) as [FaultType, number][])
    .filter(([t, w]) => w > 0 && allowed.has(t) && !inp.exclude?.includes(t))
    .sort(([a], [b]) => a.localeCompare(b));
  const total = candidates.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let x = u1 * total;
  for (const [t, w] of candidates) {
    if (x < w) return t;
    x -= w;
  }
  return candidates[candidates.length - 1]?.[0] ?? null;
}
