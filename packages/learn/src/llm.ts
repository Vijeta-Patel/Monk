import { z } from 'zod';
import { proxyLlm, type MonkConfig } from '@monk/shared';
import { makeCleaner } from './episode.ts';
import type { Candidate, DraftSkill, Llm } from './types.ts';

export const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

/** The learning loop's model: the LLM proxy with a strict JSON schema response. */
export function proxyLearnLlm(cfg: MonkConfig, fetchImpl: typeof fetch = fetch): Llm {
  return proxyLlm(cfg, { fetch: fetchImpl, temperature: 0.2 });
}

const stepSchema = z.string().trim().min(8).max(400);

export const DraftOutput = z.object({
  applicable: z.boolean(),
  name: z.string().regex(SKILL_NAME_RE, 'name must be kebab-case, 2-64 chars'),
  description: z.string().trim().min(15).max(300).refine((d) => d.startsWith('Use when'), 'description must start with "Use when"'),
  steps: z.array(stepSchema).min(1).max(12),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

export const MergeOutput = z.object({
  description: DraftOutput.shape.description,
  steps: DraftOutput.shape.steps,
});

export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['applicable', 'name', 'description', 'steps'],
  properties: {
    applicable: { type: 'boolean', description: 'false if nothing reusable can be learned from this evidence' },
    name: { type: 'string', description: 'kebab-case, lowercase, 2-64 chars, e.g. github-rate-limit-recovery' },
    description: { type: 'string', description: 'One sentence starting with "Use when", naming the trigger (tool, error text, task).' },
    steps: { type: 'array', items: { type: 'string' }, description: '3-8 concrete, imperative steps; no numbering prefix' },
  },
} as const;

export const MERGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'steps'],
  properties: {
    description: DRAFT_JSON_SCHEMA.properties.description,
    steps: DRAFT_JSON_SCHEMA.properties.steps,
  },
} as const;

const SYSTEM = `You write SKILL.md files for an AI agent that uses MCP tools (GitHub, mobile) under injected faults.
A skill is a short playbook the agent loads before acting. Rules:
- Generalize: no session ids, repo-specific ids, tokens, URLs with credentials, or one-off values.
- Steps are concrete and imperative, reference real tool names and error text from the evidence, and say what to change before retrying.
- Never suggest bypassing approvals or retrying the same call more than 3 times.
- The description starts with "Use when" and names the trigger so the agent knows when to load it.
- If the evidence shows nothing reusable, set applicable=false.
Return only JSON matching the schema.`;

const TYPE_HINT: Record<Candidate['type'], string> = {
  recovery: 'a RECOVERY skill: how to recover from this fault type quickly (what worked, what to skip).',
  procedure: 'a PROCEDURE skill: the reliable sequence of tool calls to complete this kind of task.',
  tool_quirk: 'a TOOL-QUIRK skill: how to call this tool correctly to avoid the repeated error.',
};

export function draftPrompt(c: Candidate, existingNames: string[]): { system: string; user: string } {
  const user = [
    `Write ${TYPE_HINT[c.type]}`,
    c.faultTypes.length ? `Fault types: ${c.faultTypes.join(', ')}` : '',
    `Tools involved: ${c.tools.join(', ') || '(none)'}`,
    existingNames.length ? `Existing skill names (pick a different name unless this is the same skill): ${existingNames.slice(0, 60).join(', ')}` : '',
    '',
    'Evidence (tool call log excerpts):',
    ...c.evidence.map((e, i) => `--- excerpt ${i + 1}\n${e}`),
  ].filter((l) => l !== '').join('\n');
  return { system: SYSTEM, user };
}

export function renderBody(steps: string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.replace(/^\s*\d+[.)]\s*/, '').trim()}`).join('\n');
}

export function stepsFromBody(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s+/, ''));
}

/** Calls the LLM and validates strictly. Returns null (with a reason) for anything invalid. */
export async function extractDraft(opts: {
  llm: Llm;
  candidate: Candidate;
  existingNames: string[];
  generation: number;
  cfg?: Partial<MonkConfig>;
}): Promise<{ draft: DraftSkill | null; reason: string }> {
  const { system, user } = draftPrompt(opts.candidate, opts.existingNames);
  let raw: unknown;
  try {
    raw = await opts.llm({ system, user, schema: DRAFT_JSON_SCHEMA });
  } catch (err) {
    return { draft: null, reason: `llm error: ${(err as Error).message}` };
  }
  const parsed = DraftOutput.safeParse(raw);
  if (!parsed.success) return { draft: null, reason: `invalid draft: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  if (!parsed.data.applicable) return { draft: null, reason: 'model found nothing reusable' };
  const clean = makeCleaner(opts.cfg);
  const steps = parsed.data.steps.map((s) => clean(s));
  const c = opts.candidate;
  return {
    reason: 'ok',
    draft: {
      name: parsed.data.name,
      type: c.type,
      description: clean(parsed.data.description),
      steps,
      body: renderBody(steps),
      faultTypes: [...c.faultTypes],
      tools: [...c.tools],
      sourceSessions: [...c.sourceSessions],
      sources: [...c.sources],
      version: 1,
      generation: opts.generation,
    },
  };
}

export async function llmMerge(
  llm: Llm,
  existing: { name: string; description: string; steps: string[] },
  incoming: { description: string; steps: string[] },
): Promise<{ description: string; steps: string[] } | null> {
  const user = [
    `Merge two versions of the skill "${existing.name}" into one. Keep every distinct, useful step; drop duplicates; keep it under 10 steps.`,
    `Current description: ${existing.description}`,
    'Current steps:',
    ...existing.steps.map((s, i) => `${i + 1}. ${s}`),
    `New description: ${incoming.description}`,
    'New steps:',
    ...incoming.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');
  try {
    const parsed = MergeOutput.safeParse(await llm({ system: SYSTEM, user, schema: MERGE_JSON_SCHEMA }));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
