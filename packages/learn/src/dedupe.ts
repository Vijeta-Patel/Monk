import { makeCleaner } from './episode.ts';
import { llmMerge, renderBody } from './llm.ts';
import { jaccard, textSimilarity } from './similarity.ts';
import type { DraftSkill, Llm } from './types.ts';

export type SkillLike = Pick<DraftSkill, 'name' | 'type' | 'description' | 'steps' | 'faultTypes' | 'tools' | 'sourceSessions' | 'version'> & {
  sources?: DraftSkill['sources'];
};

export function similarity(a: SkillLike, b: SkillLike): number {
  if (a.name === b.name) return 1;
  const desc = textSimilarity(a.description, b.description);
  const faults = jaccard(a.faultTypes, b.faultTypes);
  const tools = jaccard(a.tools, b.tools);
  const nameSim = textSimilarity(a.name.replace(/-/g, ' '), b.name.replace(/-/g, ' '));
  return 0.45 * desc + 0.2 * nameSim + 0.2 * faults + 0.15 * tools;
}

/**
 * Near-duplicate: same name, or same type with a high combined score. Recovery skills for different
 * fault types are never merged, so each fault keeps its own playbook.
 */
export function findDuplicate<T extends SkillLike>(draft: SkillLike, pool: T[], threshold = 0.55): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const s of pool) {
    if (s.name === draft.name) return s;
    if (s.type !== draft.type) continue;
    if (draft.type === 'recovery' && jaccard(s.faultTypes, draft.faultTypes) === 0) continue;
    const faultOverlap = draft.faultTypes.some((f) => s.faultTypes.includes(f));
    const toolOverlap = draft.tools.some((t) => s.tools.includes(t));
    const desc = textSimilarity(draft.description, s.description);
    const score = similarity(draft, s);
    const dup = score >= threshold || (faultOverlap && toolOverlap && desc >= 0.35) || (draft.type === 'recovery' && faultOverlap && desc >= 0.25);
    if (dup && score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];

/** Deterministic fallback: existing steps first, then new steps that aren't near-copies. */
export function unionSteps(existing: string[], incoming: string[], max = 12): string[] {
  const out = [...existing];
  for (const s of incoming) if (!out.some((o) => textSimilarity(o, s) >= 0.8)) out.push(s);
  return out.slice(0, max);
}

export async function mergeSkill(
  existing: SkillLike,
  incoming: DraftSkill,
  opts: { llm?: Llm; bumpVersion: boolean; cfg?: Record<string, unknown> },
): Promise<DraftSkill> {
  const merged = opts.llm ? await llmMerge(opts.llm, existing, incoming) : null;
  const clean = makeCleaner(opts.cfg as never);
  const steps = (merged?.steps ?? unionSteps(existing.steps, incoming.steps)).map(clean);
  const description = clean(merged?.description ?? existing.description);
  return {
    ...incoming,
    name: existing.name,
    type: existing.type,
    description,
    steps,
    body: renderBody(steps),
    faultTypes: union(existing.faultTypes, incoming.faultTypes),
    tools: union(existing.tools, incoming.tools),
    sourceSessions: union(existing.sourceSessions, incoming.sourceSessions),
    sources: [...(existing.sources ?? []), ...incoming.sources.filter((s) => !(existing.sources ?? []).some((e) => e.tfSessionId === s.tfSessionId))],
    version: opts.bumpVersion ? existing.version + 1 : existing.version,
    mergedInto: existing.name,
  };
}
