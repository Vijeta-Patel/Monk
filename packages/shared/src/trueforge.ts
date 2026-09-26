import { TrueForge, type TrueForgeApi, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { loadConfig, type MonkConfig } from './config.ts';

export { TrueForge, type TrueForgeApi };

export function createTrueForgeClient(cfg: MonkConfig = loadConfig()): TrueForge {
  return new TrueForge({
    baseUrl: cfg.TRUEFORGE_URL,
    ...(cfg.TRUEFORGE_TOKEN ? { token: cfg.TRUEFORGE_TOKEN } : {}),
    timeoutInSeconds: 900,
  });
}

/** TrueForge provider name for the LLM proxy; agents reference models as `litellm/<slug>`. */
export const LLM_PROVIDER = 'litellm';

/** The model-facing name TrueForge uses for a proxy model id. */
export function tfModelName(proxyModelId: string): string {
  return `${LLM_PROVIDER}/${modelSlug(proxyModelId)}`;
}

/** TrueForge resource names are `^[a-z][a-z0-9-]{0,62}[a-z0-9]$`; proxy ids can be anything. */
export function modelSlug(proxyModelId: string): string {
  const slug = proxyModelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 64).replace(/-+$/, '');
}

// ---------------------------------------------------------------------------------------------
// Normalized turn events. Every Monk client (TUI, gateway, eval runner, cron) consumes these
// instead of raw TrueForge events, so delta merging and pause handling live in one place.

export type ToolCallInfo = {
  threadId: string;
  callId: string;
  name: string;
  /** MCP server name for MCP tools, null for TrueForge built-ins. */
  server: string | null;
  args: string;
};

export type TurnEvent =
  | { type: 'turn.started'; turnId: string }
  | { type: 'text'; threadId: string; delta: string }
  | { type: 'reasoning'; threadId: string; delta: string }
  | { type: 'message'; threadId: string; content: string }
  | ({ type: 'tool.call' } & ToolCallInfo)
  | { type: 'tool.result'; threadId: string; callId: string; name: string; content: string; isError: boolean }
  | { type: 'approval.required'; calls: ToolCallInfo[] }
  | { type: 'question'; calls: (ToolCallInfo & { question: string; options: string[] })[] }
  | { type: 'subagent.started'; threadId: string; name: string; input: string }
  | { type: 'subagent.done'; threadId: string }
  | { type: 'mcp.initialize'; servers: { name: string; sessionId: string | null }[] }
  | { type: 'usage'; threadId: string; inputTokens: number; outputTokens: number }
  | {
      type: 'turn.done';
      status: 'done' | 'cancelled' | 'error' | 'paused';
      output: string;
      error?: string;
      inputTokens: number;
      outputTokens: number;
    };

export type TurnInput =
  | { kind: 'message'; content: string }
  | { kind: 'approvals'; decisions: { threadId: string; callId: string; allow: boolean; reason?: string }[] }
  | { kind: 'answers'; answers: { threadId: string; callId: string; content: string }[] };

function toTurnInput(input: TurnInput): TrueForgeApi.TurnInputItem[] {
  switch (input.kind) {
    case 'message':
      return [{ type: 'user.message', content: input.content }];
    case 'approvals':
      return input.decisions.map((d) => ({
        type: 'user.tool_approval' as const,
        threadId: d.threadId,
        toolCallId: d.callId,
        approval: d.allow ? { status: 'allow' as const } : { status: 'deny' as const, ...(d.reason ? { reason: d.reason } : {}) },
      }));
    case 'answers':
      return input.answers.map((a) => ({ type: 'user.tool_response' as const, threadId: a.threadId, toolCallId: a.callId, content: a.content }));
  }
}

export function contentToText(content: TrueForgeApi.ModelMessageEventContent | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** TrueForge reports MCP errors as `{"error": ...}` in the result body; there is no flag. */
export function isErrorResult(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  } catch {
    return false;
  }
}

/**
 * TrueForge can route MCP tools through its generic `call_tool {mcp_server, tool_name, input}`.
 * Everything downstream (approvals, chaos accounting, evals, AgentEye, the UIs) keys on the real
 * tool, so unwrap it here, once.
 */
export function unwrapToolCall(name: string, args: string, server: string | null): { name: string; args: string; server: string | null } {
  if (name !== 'call_tool') return { name, args, server };
  try {
    const parsed = JSON.parse(args) as { mcp_server?: unknown; tool_name?: unknown; input?: unknown };
    if (typeof parsed.tool_name !== 'string' || !parsed.tool_name) return { name, args, server };
    return {
      name: parsed.tool_name,
      args: JSON.stringify(parsed.input ?? {}),
      server: typeof parsed.mcp_server === 'string' ? parsed.mcp_server : server,
    };
  } catch {
    return { name, args, server };
  }
}

/**
 * Converts a raw TrueForge event stream into TurnEvents. Pure over its input so it can be tested
 * with recorded streams; `runTurn` feeds it live events.
 */
export async function* normalizeTurnStream(
  raw: AsyncIterable<TrueForgeApi.TurnStreamingEvent>,
): AsyncGenerator<TurnEvent> {
  const messages = new Map<string, TrueForgeApi.ModelMessageEvent>();
  // Model messages whose tool calls haven't been emitted yet, per thread.
  const openByThread = new Map<string, string>();
  const callsById = new Map<string, ToolCallInfo>();
  let inputTokens = 0;
  let outputTokens = 0;
  let lastOutput = '';

  function* seal(threadId: string | null): Generator<TurnEvent> {
    const threads = threadId === null ? [...openByThread.keys()] : [threadId];
    for (const t of threads) {
      const id = openByThread.get(t);
      if (!id) continue;
      openByThread.delete(t);
      const msg = messages.get(id);
      if (!msg) continue;
      const text = contentToText(msg.content);
      if (text) {
        yield { type: 'message', threadId: t, content: text };
        if (t === 'main') lastOutput = text;
      }
      if (msg.usage) {
        inputTokens += msg.usage.inputTokens;
        outputTokens += msg.usage.outputTokens;
        yield { type: 'usage', threadId: t, inputTokens: msg.usage.inputTokens, outputTokens: msg.usage.outputTokens };
      }
      for (const tc of msg.toolCalls ?? []) {
        const real = unwrapToolCall(tc.function.name, tc.function.arguments ?? '', tc.toolInfo?.type === 'mcp' ? tc.toolInfo.serverName : null);
        const info: ToolCallInfo = { threadId: t, callId: tc.id, name: real.name, server: real.server, args: real.args };
        callsById.set(tc.id, info);
        yield { type: 'tool.call', ...info };
      }
    }
  }

  for await (const ev of raw) {
    if (isEventDelta(ev)) {
      const base = messages.get(ev.id);
      if (base) mergeEventDelta(base, ev);
      if (ev.content) yield { type: 'text', threadId: ev.threadId, delta: ev.content };
      if (ev.reasoningContent) yield { type: 'reasoning', threadId: ev.threadId, delta: ev.reasoningContent };
      continue;
    }
    if (ev.type !== 'model.message') yield* seal(ev.type === 'turn.done' ? null : (ev.threadId ?? null));

    switch (ev.type) {
      case 'turn.created':
        yield { type: 'turn.started', turnId: ev.turnId };
        break;
      case 'model.message': {
        yield* seal(ev.threadId);
        const copy = structuredClone(ev);
        messages.set(ev.id, copy);
        openByThread.set(ev.threadId, ev.id);
        // A non-streamed message arrives complete; its text is emitted on seal.
        break;
      }
      case 'tool.response': {
        const call = callsById.get(ev.toolCallId);
        yield {
          type: 'tool.result',
          threadId: ev.threadId,
          callId: ev.toolCallId,
          name: call?.name ?? '',
          content: ev.content,
          isError: isErrorResult(ev.content),
        };
        break;
      }
      case 'tool.approval_required':
        yield { type: 'approval.required', calls: ev.toolCalls.map((r) => callsById.get(r.id) ?? unknownCall(ev.threadId, r.id)) };
        break;
      case 'tool.response_required':
        yield {
          type: 'question',
          calls: ev.toolCalls.map((r) => {
            const call = callsById.get(r.id) ?? unknownCall(ev.threadId, r.id);
            const parsed = safeJson(call.args) as { question?: string; options?: string[] } | undefined;
            return { ...call, question: parsed?.question ?? '', options: parsed?.options ?? [] };
          }),
        };
        break;
      case 'thread.created':
        yield { type: 'subagent.started', threadId: ev.threadId, name: ev.agentInfo.name, input: ev.agentInfo.input };
        break;
      case 'thread.done':
        yield { type: 'subagent.done', threadId: ev.threadId };
        break;
      case 'mcp.initialize':
        yield { type: 'mcp.initialize', servers: ev.mcpServers.map((s) => ({ name: s.name, sessionId: s.sessionId ?? null })) };
        break;
      case 'turn.done': {
        const st = ev.state;
        const m = st.metrics;
        const inTok = m?.totalInputTokens ?? inputTokens;
        const outTok = m?.totalOutputTokens ?? outputTokens;
        if (st.status === 'done') {
          const paused = st.requiredActions.length > 0;
          const output = st.output ? contentToText(st.output.content) : lastOutput;
          yield { type: 'turn.done', status: paused ? 'paused' : 'done', output, inputTokens: inTok, outputTokens: outTok };
        } else if (st.status === 'error') {
          yield { type: 'turn.done', status: 'error', output: lastOutput, error: st.message, inputTokens: inTok, outputTokens: outTok };
        } else {
          yield { type: 'turn.done', status: 'cancelled', output: lastOutput, error: String(st.reason), inputTokens: inTok, outputTokens: outTok };
        }
        break;
      }
      default:
        break;
    }
  }
}

function unknownCall(threadId: string, callId: string): ToolCallInfo {
  return { threadId, callId, name: '', server: null, args: '' };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export async function* runTurn(
  client: TrueForge,
  sessionId: string,
  input: TurnInput,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<TurnEvent> {
  const stream = await client.sessions.createTurnStream(
    sessionId,
    { input: toTurnInput(input) },
    opts.signal ? { abortSignal: opts.signal } : undefined,
  );
  yield* normalizeTurnStream(stream);
}

// ---------------------------------------------------------------------------------------------
// Idempotent setup helpers used by `monk setup` and the learning loop.

export async function ensureLlmProvider(client: TrueForge, cfg: MonkConfig): Promise<void> {
  if (!cfg.LLM_BASE_URL) throw new Error('LLM_BASE_URL is not set');
  if (!cfg.MODEL) throw new Error('MODEL is not set; run `monk models` to pick one');
  const ids = [...new Set([cfg.MODEL, cfg.VISION_MODEL].filter(Boolean))];
  // Advertising the efforts lets the agent pin `none`: some proxied models refuse tool calls under any other.
  const models = ids.map((modelId) => ({
    modelId,
    name: modelSlug(modelId),
    properties: { reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high'] as TrueForgeApi.ReasoningEffort[] },
  }));
  await client.settings.modelProviders.createOrUpdate({
    manifest: {
      type: 'custom',
      name: LLM_PROVIDER,
      baseUrl: cfg.LLM_BASE_URL.replace(/\/+$/, ''),
      ...(cfg.LLM_API_KEY ? { auth: { apiKey: cfg.LLM_API_KEY } } : {}),
      models,
    },
  });
}

export async function ensureRemoteMcpServer(
  client: TrueForge,
  server: { name: string; url: string; description: string },
): Promise<void> {
  await client.settings.mcpServers.createOrUpdate({
    manifest: { type: 'remote', name: server.name, url: server.url, description: server.description },
  });
}

export async function ensureGitSkill(
  client: TrueForge,
  skill: { name: string; description: string; url: string; ref: string; path: string },
): Promise<void> {
  await client.settings.skills.createOrUpdate({ manifest: { type: 'git', ...skill } });
}

export async function ensureAgent(
  client: TrueForge,
  agent: { name: string; description: string; manifest: TrueForgeApi.AgentSpec },
): Promise<string> {
  for await (const existing of await client.agents.list({ agentName: agent.name })) {
    if (existing.name === agent.name) {
      await client.agents.update(existing.id, { description: agent.description, manifest: agent.manifest });
      return existing.id;
    }
  }
  const { data } = await client.agents.create(agent);
  return data.id;
}
