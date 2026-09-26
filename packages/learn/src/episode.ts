import { errorClass } from '@monk/shared';
import { asc, inArray } from 'drizzle-orm';
import {
  CHAOS_PROXY_SERVER_NAME, contentToText, isErrorResult, mcpSessionsFor, redact, schema,
  type MonkConfig, type MonkDb, type TrueForge, type TrueForgeApi,
} from '@monk/shared';
import type { Episode, EpisodeFault, EpisodeStep } from './types.ts';
import { detectSkillsUsed } from './usage.ts';

type SessionEvent = TrueForgeApi.SessionEvent;
type ToolCallRow = typeof schema.toolCalls.$inferSelect;
type FaultRow = typeof schema.faults.$inferSelect;

const MAX_STEPS = 40;

export function makeCleaner(cfg?: Partial<MonkConfig>): (s: string) => string {
  const env = cfg ? (Object.fromEntries(Object.entries(cfg).filter(([, v]) => typeof v === 'string')) as Record<string, string>) : {};
  return (s) => redact(redact(s, env));
}

export function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

/** Full event log of a session, oldest first. listEvents pages newest first. */
export async function fetchSessionEvents(client: TrueForge, tfSessionId: string): Promise<SessionEvent[]> {
  const items: TrueForgeApi.SessionEventItem[] = [];
  const page = await client.sessions.listEvents(tfSessionId, { limit: 100 });
  for await (const item of page) items.push(item);
  const ordered = items.reverse().map((i, idx) => ({ ev: i.event, idx }));
  ordered.sort((a, b) => (a.ev.createdAt < b.ev.createdAt ? -1 : a.ev.createdAt > b.ev.createdAt ? 1 : a.idx - b.idx));
  return ordered.map((o) => o.ev);
}

export function summarizeArgs(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clip(raw, 120);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const parts = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${clip(s ?? '', 50)}`;
    });
    return clip(parts.join(' '), 160);
  }
  return clip(JSON.stringify(parsed), 120);
}

function errorMessage(content: string): string {
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    const e = parsed.error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
    return JSON.stringify(e);
  } catch {
    return content;
  }
}

/** Coarse error class so the same quirk is recognised across sessions despite ids and numbers. */

function toolMatches(proxyTool: string, tfTool: string): boolean {
  return proxyTool === tfTool || proxyTool.endsWith(`__${tfTool}`) || tfTool.endsWith(`__${proxyTool}`) || proxyTool.endsWith(`.${tfTool}`);
}

export type EpisodeInput = {
  tfSessionId: string;
  events: SessionEvent[];
  toolCalls?: ToolCallRow[];
  faults?: FaultRow[];
  mcpSessionIds?: string[];
  succeeded?: boolean;
  cfg?: Partial<MonkConfig>;
};

/** Pure: joins the TrueForge log with the chaos proxy's tool_calls/faults rows. */
export function buildEpisode(input: EpisodeInput): Episode {
  const clean = makeCleaner(input.cfg);
  const tasks: string[] = [];
  const steps: EpisodeStep[] = [];
  const stepByCallId = new Map<string, EpisodeStep>();
  let outcome: Episode['outcome'] = 'unknown';
  let finalOutput = '';
  let lastText = '';

  const proxyRows = [...(input.toolCalls ?? [])].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const usedProxy = new Set<string>();
  const faultById = new Map((input.faults ?? []).map((f) => [f.id, f]));
  const stepIndexByFault = new Map<string, number>();

  for (const ev of input.events) {
    switch (ev.type) {
      case 'turn.created':
        for (const item of ev.input ?? []) {
          if (item.type !== 'user.message') continue;
          const c = item.content;
          const text = typeof c === 'string' ? c : c.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join('');
          if (text.trim()) tasks.push(text);
        }
        break;
      case 'model.message': {
        const text = contentToText(ev.content);
        if (text && ev.threadId === 'main') lastText = text;
        for (const tc of ev.toolCalls ?? []) {
          const isMcp = tc.toolInfo?.type === 'mcp';
          const tool = isMcp ? tc.toolInfo.name || tc.function.name : tc.function.name;
          const step: EpisodeStep = {
            i: steps.length,
            tool,
            server: isMcp && tc.toolInfo.type === 'mcp' ? tc.toolInfo.serverName : null,
            args: clean(summarizeArgs(tc.function.arguments ?? '')),
            status: 'ok',
          };
          if (step.server === CHAOS_PROXY_SERVER_NAME || (isMcp && proxyRows.length)) {
            const row = proxyRows.find((r) => !usedProxy.has(r.id) && toolMatches(r.tool, tool));
            if (row) {
              usedProxy.add(row.id);
              if (row.status === 'fault' && row.faultId) {
                step.status = 'fault';
                const f = faultById.get(row.faultId);
                if (f) {
                  step.fault = f.faultType;
                  stepIndexByFault.set(f.id, step.i);
                }
              } else if (row.status === 'error') {
                step.status = 'error';
              }
            }
          }
          steps.push(step);
          stepByCallId.set(tc.id, step);
        }
        break;
      }
      case 'tool.response': {
        const step = stepByCallId.get(ev.toolCallId);
        if (!step) break;
        if (isErrorResult(ev.content) || step.status !== 'ok') {
          const msg = clean(clip(errorMessage(ev.content), 200));
          if (step.status === 'ok') step.status = 'error';
          step.error = msg;
          if (step.status === 'error') step.errorClass = errorClass(msg);
        }
        break;
      }
      case 'turn.done': {
        const st = ev.state;
        if (st.status === 'done') {
          outcome = st.requiredActions.length ? 'paused' : 'done';
          finalOutput = st.output ? contentToText(st.output.content) : lastText;
        } else {
          outcome = st.status;
          finalOutput = lastText;
        }
        break;
      }
      default:
        break;
    }
  }

  // Faults the log could not place (e.g. subagent MCP calls we did not see) still count.
  const faults: EpisodeFault[] = (input.faults ?? []).map((f) => ({
    id: f.id,
    tool: f.tool,
    faultType: f.faultType,
    outcome: f.outcome,
    recoverySteps: f.recoverySteps,
    seed: f.seed,
    profile: f.profile,
    stepIndex: stepIndexByFault.get(f.id) ?? null,
  }));
  for (const f of faults) {
    if (f.stepIndex !== null) continue;
    const s = steps.find((st) => st.status !== 'fault' && toolMatches(f.tool, st.tool) && st.error !== undefined);
    if (s) {
      s.status = 'fault';
      s.fault = f.faultType;
      delete s.errorClass;
      f.stepIndex = s.i;
    }
  }

  const skillsUsed = detectSkillsUsed(input.events);
  const succeeded = input.succeeded ?? (outcome === 'done');
  return {
    tfSessionId: input.tfSessionId,
    task: clean(clip(tasks.join(' / '), 500)),
    steps: compactSteps(steps),
    outcome,
    succeeded,
    finalOutput: clean(clip(finalOutput, 400)),
    faults,
    mcpSessionIds: input.mcpSessionIds ?? [],
    skillsUsed,
  };
}

/** Keeps every non-ok step with one step of context; elides long ok runs. */
function compactSteps(steps: EpisodeStep[]): EpisodeStep[] {
  if (steps.length <= MAX_STEPS) return steps;
  const keep = new Set<number>([0, steps.length - 1]);
  steps.forEach((s, i) => {
    if (s.status !== 'ok') for (let j = i - 1; j <= i + 3; j++) if (j >= 0 && j < steps.length) keep.add(j);
  });
  for (let i = 0; keep.size < MAX_STEPS && i < steps.length; i++) keep.add(i);
  return steps.filter((_, i) => keep.has(i)).slice(0, MAX_STEPS * 2);
}

export function renderStep(s: EpisodeStep): string {
  const where = s.server ? `${s.server}.${s.tool}` : s.tool;
  const res = s.status === 'fault' ? `FAULT ${s.fault ?? ''}: ${s.error ?? ''}` : s.status === 'error' ? `ERROR: ${s.error ?? ''}` : 'ok';
  return `${s.i + 1}. ${where}(${s.args}) -> ${res}`.trim();
}

export function renderEpisode(ep: Episode, range?: [number, number]): string {
  const steps = range ? ep.steps.filter((s) => s.i >= range[0] && s.i <= range[1]) : ep.steps;
  return [
    `Session ${ep.tfSessionId}`,
    `Task: ${ep.task || '(unknown)'}`,
    ...steps.map(renderStep),
    `Outcome: ${ep.outcome}${ep.succeeded ? ' (succeeded)' : ' (failed)'}${ep.finalOutput ? ` - ${clip(ep.finalOutput, 200)}` : ''}`,
  ].join('\n');
}

/** Reads the TrueForge log and joins the chaos proxy rows for one session. */
export async function loadEpisode(opts: {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  tfSessionId: string;
  succeeded?: boolean;
}): Promise<Episode> {
  const events = await fetchSessionEvents(opts.client, opts.tfSessionId);
  const mcpIds = new Set(await mcpSessionsFor(opts.db, opts.tfSessionId));
  // Fallback when nobody linked the session: the chaos server's MCP session id is in mcp.initialize.
  for (const ev of events) {
    if (ev.type !== 'mcp.initialize') continue;
    for (const s of ev.mcpServers) if (s.name === CHAOS_PROXY_SERVER_NAME && s.sessionId) mcpIds.add(s.sessionId);
  }
  const ids = [...mcpIds];
  const toolCalls = ids.length
    ? await opts.db.select().from(schema.toolCalls).where(inArray(schema.toolCalls.mcpSessionId, ids)).orderBy(asc(schema.toolCalls.startedAt))
    : [];
  const faults = ids.length
    ? await opts.db.select().from(schema.faults).where(inArray(schema.faults.mcpSessionId, ids)).orderBy(asc(schema.faults.injectedAt))
    : [];
  return buildEpisode({
    tfSessionId: opts.tfSessionId,
    events,
    toolCalls,
    faults,
    mcpSessionIds: ids,
    cfg: opts.cfg,
    ...(opts.succeeded !== undefined ? { succeeded: opts.succeeded } : {}),
  });
}

export { errorClass };
