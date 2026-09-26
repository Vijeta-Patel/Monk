// TrueForge session log + Monk's chaos/eval records → AgentEye NDJSON events. Pure, so the exact
// wire shape is unit-tested. Field names follow @failproofai/sdk's schema.ts; Monk-specific data
// rides in fw_* payload fields, which AgentEye keeps verbatim.
import { contentToText, isErrorResult, redact, type TrueForgeApi } from '@monk/shared';

export type AgentEyeEvent = Record<string, unknown> & {
  session_id: string;
  agent_id: string;
  type: string;
  timestamp: string;
  environment: string;
};

export type FaultRecord = {
  id: string;
  tool: string;
  faultType: string;
  injectedAt: string;
  recoveredAt: string | null;
  recoverySteps: number | null;
  outcome: 'pending' | 'recovered' | 'unrecovered';
  manual: boolean;
};

export type EvalRecord = {
  taskId: string;
  split: string;
  passed: boolean;
  suite: string;
  generation: number;
  seed: number;
  profile: string;
  variant: string;
  runId: string;
  benchId: string | null;
  approvalsRequested: number;
  approvalsRequired: number;
  destructiveUnapproved: number;
  costUsd: number;
  error: string | null;
};

export type SessionMeta = {
  tfSessionId: string;
  agentId: string;
  environment: string;
  model: string;
  costUsd: number;
  eval: EvalRecord | null;
  /** Tool names that count as irreversible (for fw_destructive on tool_use). */
  destructive: (tool: string) => boolean;
};

const MAX_TEXT = 8000;

function clip(s: string, n = MAX_TEXT): string {
  return s.length <= n ? s : `${s.slice(0, n)}… [${s.length - n} more chars]`;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: clip(raw, 2000) };
  }
}

/** AgentEye rejects environments with commas; keep them short and filter-friendly. */
export function safeEnvironment(env: string): string {
  return env.replace(/,/g, '_').slice(0, 64) || 'dev';
}

/** The environment a session is filed under: benchmark generation, else the live label. */
export function environmentFor(ev: EvalRecord | null, live: string): string {
  if (!ev) return safeEnvironment(live);
  if (ev.variant === 'verify') return 'monk-verify';
  const chaos = ev.profile === 'off' ? '-chaos-off' : '';
  const variant = ev.variant && ev.variant !== 'full' ? `-${ev.variant}` : '';
  return safeEnvironment(`gen-${ev.generation}${variant}${chaos}`);
}

type Ev = TrueForgeApi.SessionEvent & { type: string; createdAt: string; threadId?: string | null };

export function mapSession(events: Ev[], faults: FaultRecord[], meta: SessionMeta): AgentEyeEvent[] {
  const base = { session_id: meta.tfSessionId, agent_id: meta.agentId, environment: meta.environment };
  const out: AgentEyeEvent[] = [];
  const toolName = new Map<string, string>();
  const toolStart = new Map<string, number>();
  let started = false;
  let lastModel = meta.model;
  let totalIn = 0;
  let totalOut = 0;
  let lastTs = '';

  const push = (timestamp: string, type: string, fields: Record<string, unknown>) => {
    lastTs = timestamp > lastTs ? timestamp : lastTs;
    out.push({ ...base, type, timestamp, ...fields });
  };

  for (const raw of events) {
    const ev = raw as Ev & Record<string, unknown>;
    const ts = ev.createdAt;
    const thread = ev.threadId ?? 'main';
    switch (ev.type) {
      case 'turn.created': {
        const input = (ev.input as TrueForgeApi.TurnInputItem[] | undefined) ?? [];
        for (const item of input) {
          if (item.type === 'user.message') {
            const text = redact(typeof item.content === 'string' ? item.content : '(attachment)');
            if (!started) {
              started = true;
              push(ts, 'agent_start', {
                goal: clip(text, 2000),
                fw_harness: 'trueforge',
                fw_model: meta.model,
                ...(meta.eval ? { fw_task_id: meta.eval.taskId, fw_generation: meta.eval.generation, fw_seed: meta.eval.seed, fw_profile: meta.eval.profile, fw_variant: meta.eval.variant, fw_split: meta.eval.split } : {}),
              });
              // AgentEye's judges read user turns from human_input, so the request itself is one too.
              push(ts, 'human_input', { input_id: String(ev.id), response: clip(text, 4000), fw_kind: 'message' });
            } else {
              push(ts, 'human_input', { input_id: String(ev.id), response: clip(text, 2000), fw_kind: 'message' });
            }
          } else if (item.type === 'user.tool_approval') {
            const allowed = item.approval.status === 'allow';
            push(ts, 'human_input', {
              input_id: item.toolCallId,
              response: allowed ? 'approved' : `denied${'reason' in item.approval && item.approval.reason ? `: ${item.approval.reason}` : ''}`,
              fw_kind: 'approval',
              fw_approved: allowed,
            });
          } else if (item.type === 'user.tool_response') {
            push(ts, 'human_input', { input_id: item.toolCallId, response: clip(redact(item.content), 2000), fw_kind: 'answer' });
          }
        }
        break;
      }
      case 'model.message': {
        const m = ev as unknown as TrueForgeApi.ModelMessageEvent;
        const text = redact(contentToText(m.content));
        const inTok = m.usage?.inputTokens ?? 0;
        const outTok = m.usage?.outputTokens ?? 0;
        totalIn += inTok;
        totalOut += outTok;
        push(ts, 'model_request', { model: lastModel, request_id: m.id, fw_thread: thread });
        push(ts, 'model_response', {
          model: lastModel,
          request_id: m.id,
          role: 'assistant',
          content: clip(text),
          ...(m.finishReason ? { stop_reason: String(m.finishReason) } : {}),
          ...(m.usage ? { input_tokens: inTok, output_tokens: outTok } : {}),
          fw_thread: thread,
        });
        for (const tc of m.toolCalls ?? []) {
          toolName.set(tc.id, tc.function.name);
          toolStart.set(tc.id, Date.parse(ts));
          push(ts, 'tool_use', {
            tool_name: tc.function.name,
            tool_call_id: tc.id,
            input: parseArgs(redact(tc.function.arguments ?? '')),
            fw_thread: thread,
            fw_server: tc.toolInfo?.type === 'mcp' ? tc.toolInfo.serverName : 'trueforge',
            ...(meta.destructive(tc.function.name) ? { fw_destructive: true } : {}),
          });
        }
        break;
      }
      case 'tool.response': {
        const r = ev as unknown as TrueForgeApi.ToolResponseEvent;
        const name = toolName.get(r.toolCallId) ?? 'unknown';
        const started0 = toolStart.get(r.toolCallId);
        const failed = isErrorResult(r.content);
        push(ts, 'tool_result', {
          tool_name: name,
          tool_call_id: r.toolCallId,
          ...(failed ? { error: clip(redact(r.content), 2000) } : { output: clip(redact(r.content)) }),
          ...(started0 !== undefined ? { duration_ms: Math.max(0, Date.parse(ts) - started0) } : {}),
          fw_thread: thread,
        });
        break;
      }
      case 'tool.approval_required': {
        const a = ev as unknown as TrueForgeApi.ToolApprovalRequiredEvent;
        for (const ref of a.toolCalls) {
          push(ts, 'human_wait', { input_id: ref.id, prompt: `approve ${toolName.get(ref.id) ?? 'tool call'}?`, reason: 'irreversible action', fw_kind: 'approval' });
        }
        break;
      }
      case 'tool.response_required': {
        const q = ev as unknown as TrueForgeApi.ToolResponseRequiredEvent;
        for (const ref of q.toolCalls) push(ts, 'human_wait', { input_id: ref.id, prompt: 'agent asked a question', fw_kind: 'question' });
        break;
      }
      case 'thread.created': {
        const t = ev as unknown as TrueForgeApi.ThreadCreatedEvent;
        push(ts, 'hook_triggered', { hook_name: 'subagent', hook_id: t.threadId, trigger_event: 'delegation', input: { name: t.agentInfo.name, task: clip(redact(t.agentInfo.input), 2000) } });
        break;
      }
      case 'thread.done': {
        push(ts, 'hook_completed', { hook_name: 'subagent', hook_id: String(ev.threadId ?? ''), outcome: 'done' });
        break;
      }
      case 'turn.done': {
        const d = ev as unknown as TrueForgeApi.TurnDoneEvent;
        if (d.state.status === 'error') push(ts, 'error', { error_type: 'turn_error', message: clip(redact(d.state.message), 2000) });
        break;
      }
      default:
        break;
    }
  }

  // Chaos: each injected fault is a hook the harness fired; its recovery closes it.
  for (const f of faults) {
    push(f.injectedAt, 'hook_triggered', { hook_name: 'chaos_fault', hook_id: f.id, trigger_event: 'tool_use', input: { fault_type: f.faultType, tool: f.tool, manual: f.manual }, fw_fault_type: f.faultType, tool_name: f.tool });
    if (f.outcome !== 'pending') {
      push(f.recoveredAt ?? lastTs, 'hook_completed', {
        hook_name: 'chaos_fault',
        hook_id: f.id,
        outcome: f.outcome,
        ...(f.recoveredAt ? { duration_ms: Math.max(0, Date.parse(f.recoveredAt) - Date.parse(f.injectedAt)) } : {}),
        fw_fault_type: f.faultType,
        fw_recovery_steps: f.recoverySteps,
        tool_name: f.tool,
      });
    }
  }

  const lastTurn = [...events].reverse().find((e) => e.type === 'turn.done') as unknown as TrueForgeApi.TurnDoneEvent | undefined;
  if (lastTurn) {
    const st = lastTurn.state;
    const outcome = st.status === 'done' ? (st.requiredActions.length ? 'paused' : 'completed') : st.status === 'error' ? 'error' : 'cancelled';
    if (outcome !== 'paused') {
      const summary = st.status === 'done' && st.output ? redact(contentToText(st.output.content)) : '';
      const injected = faults.length;
      const recovered = faults.filter((f) => f.outcome === 'recovered').length;
      const endTs = lastTurn.createdAt > lastTs ? lastTurn.createdAt : bump(lastTs);
      push(endTs, 'agent_end', {
        outcome,
        summary: clip(summary, 4000),
        fw_input_tokens: totalIn,
        fw_output_tokens: totalOut,
        fw_cost_usd: Number(meta.costUsd.toFixed(6)),
        fw_faults_injected: injected,
        fw_faults_recovered: recovered,
        ...(meta.eval
          ? {
              fw_task_id: meta.eval.taskId,
              fw_split: meta.eval.split,
              fw_passed: meta.eval.passed,
              fw_generation: meta.eval.generation,
              fw_seed: meta.eval.seed,
              fw_profile: meta.eval.profile,
              fw_variant: meta.eval.variant,
              fw_bench_id: meta.eval.benchId,
              fw_approvals_requested: meta.eval.approvalsRequested,
              fw_approvals_required: meta.eval.approvalsRequired,
              fw_destructive_unapproved: meta.eval.destructiveUnapproved,
              ...(meta.eval.error ? { fw_eval_error: meta.eval.error } : {}),
            }
          : {}),
      });
    }
  }

  return out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

/** One microsecond later, so agent_end sorts after everything it closes. */
function bump(iso: string): string {
  const d = new Date(Date.parse(iso) + 1);
  return d.toISOString();
}

export function toNdjson(events: AgentEyeEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}
