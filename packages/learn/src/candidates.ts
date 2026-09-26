import { and, eq, isNull, notInArray, or } from 'drizzle-orm';
import { schema, type MonkDb } from '@monk/shared';
import { renderEpisode } from './episode.ts';
import type { Candidate, Episode, SourceRun } from './types.ts';

const MAX_EVIDENCE = 3;

function source(ep: Episode, seed: number | null = null, profile: string | null = null): SourceRun {
  const f = ep.faults[0];
  return { tfSessionId: ep.tfSessionId, task: ep.task, seed: seed ?? f?.seed ?? null, profile: profile ?? f?.profile ?? null };
}

function addUnique<T>(arr: T[], v: T): void {
  if (!arr.includes(v)) arr.push(v);
}

/**
 * Recovery: a fault that took 2+ steps to recover. Procedure: a successful task with 3+ tool calls.
 * Tool quirk: the same tool and error class in two sessions (DB history counts as a second sighting).
 */
export async function detectCandidates(episodes: Episode[], db?: MonkDb): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  const get = (key: string, init: () => Candidate): Candidate => {
    let c = out.get(key);
    if (!c) {
      c = init();
      out.set(key, c);
    }
    return c;
  };

  for (const ep of episodes) {
    for (const f of ep.faults) {
      if (f.outcome !== 'recovered' || (f.recoverySteps ?? 0) < 2) continue;
      const key = `recovery:${f.faultType}`;
      const c = get(key, () => ({ type: 'recovery', key, faultTypes: [f.faultType], tools: [], sourceSessions: [], sources: [], evidence: [] }));
      addUnique(c.tools, f.tool);
      if (!c.sourceSessions.includes(ep.tfSessionId)) {
        c.sourceSessions.push(ep.tfSessionId);
        c.sources.push(source(ep, f.seed, f.profile));
      }
      if (c.evidence.length < MAX_EVIDENCE) {
        const start = f.stepIndex ?? 0;
        const range: [number, number] = f.stepIndex === null ? [0, 1e9] : [Math.max(0, start - 1), start + (f.recoverySteps ?? 2) + 1];
        c.evidence.push(`Fault ${f.faultType} on ${f.tool}, recovered in ${f.recoverySteps} steps.\n${renderEpisode(ep, range)}`);
      }
    }

    if (ep.succeeded && ep.steps.length >= 3) {
      const key = `procedure:${ep.tfSessionId}`;
      const faultTypes = [...new Set(ep.faults.map((f) => f.faultType))];
      out.set(key, {
        type: 'procedure',
        key,
        faultTypes,
        tools: [...new Set(ep.steps.map((s) => s.tool))],
        sourceSessions: [ep.tfSessionId],
        sources: [source(ep)],
        evidence: [renderEpisode(ep)],
      });
    }
  }

  // Tool quirks: (tool, error class) across sessions.
  const quirks = new Map<string, { tool: string; cls: string; eps: Episode[]; lines: string[] }>();
  for (const ep of episodes) {
    for (const s of ep.steps) {
      if (s.status !== 'error' || !s.errorClass) continue;
      const k = `${s.tool}:${s.errorClass}`;
      let q = quirks.get(k);
      if (!q) quirks.set(k, (q = { tool: s.tool, cls: s.errorClass, eps: [], lines: [] }));
      if (!q.eps.includes(ep)) {
        q.eps.push(ep);
        if (q.lines.length < MAX_EVIDENCE) q.lines.push(renderEpisode(ep, [Math.max(0, s.i - 1), s.i + 2]));
      }
    }
  }
  for (const q of quirks.values()) {
    let sightings = q.eps.length;
    if (sightings < 2 && db) sightings += await pastErrorSessions(db, q.tool, q.cls, q.eps.flatMap((e) => e.mcpSessionIds));
    if (sightings < 2) continue;
    const key = `quirk:${q.tool}:${q.cls}`;
    out.set(key, {
      type: 'tool_quirk',
      key,
      faultTypes: [],
      tools: [q.tool],
      sourceSessions: q.eps.map((e) => e.tfSessionId),
      sources: q.eps.map((e) => source(e)),
      evidence: [`Tool ${q.tool} failed with error class ${q.cls} in ${sightings} sessions.`, ...q.lines],
    });
  }
  return [...out.values()];
}

/** Distinct earlier MCP sessions where the proxy saw the same real (non-injected) error class from this tool. */
async function pastErrorSessions(db: MonkDb, tool: string, cls: string, exclude: string[]): Promise<number> {
  // Rows from before error_class existed have it null; count those as possibly the same error.
  const cond = and(eq(schema.toolCalls.tool, tool), eq(schema.toolCalls.status, 'error'), or(eq(schema.toolCalls.errorClass, cls), isNull(schema.toolCalls.errorClass)));
  const rows = await db
    .selectDistinct({ s: schema.toolCalls.mcpSessionId })
    .from(schema.toolCalls)
    .where(exclude.length ? and(cond, notInArray(schema.toolCalls.mcpSessionId, exclude)) : cond);
  return rows.length;
}
