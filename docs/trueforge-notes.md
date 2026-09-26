# TrueForge notes (M0)

Verified against `truefoundry/trueforge` main (cloned 2026-09-23 into `vendor/trueforge`), npm `@truefoundry/trueforge@0.2.1`, `@truefoundry/trueforge-sdk@0.2.0`.
Paths: `C/` = `packages/trueforge-core/src`, `P/` = `packages/trueforge/src`, `SDK/` = `packages/trueforge-sdk/src`.

## Running locally

- `npx @truefoundry/trueforge@latest [--port N]`. Standalone (SQLite, no Redis/Postgres) is the default (`P/config.ts:9-11`). Default port **8790** (`P/config.ts:26`), not 8791 (8791 is the docker-compose smoke port).
- No auth in standalone: omit `token` in the SDK and you act as local admin.
- `SQLITE_PATH`, `SERVER_EXECUTION_TIMEOUT_SECONDS` (default 600), `LOG_LEVEL`.
- Env reads go through `P/config.ts`; model providers, MCP servers, skills and sandbox providers are **configured over the settings API, not env vars**.

## Models (OpenRouter)

- No OpenRouter provider type. Use `type: 'custom'` (OpenAI-compatible chat completions, `C/core/llm/VercelAILLM.ts:130-147`). Do not use `openai` + baseUrl (that uses the Responses API).
- `client.settings.modelProviders.create({ manifest: { type: 'custom', name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', auth: { apiKey }, models: [{ modelId: 'deepseek/deepseek-v3.2', name: 'deepseek-v3-2', properties: {} }] } })`.
- Agents reference it as `openrouter/deepseek-v3-2` (exactly one slash; names match `^[a-z][a-z0-9-]{0,62}[a-z0-9]$`).
- **Cost:** `turn.done.state.metrics.totalCostInUsd` is only filled if the provider returns `costInUSD` in raw usage (`VercelAILLM.ts:974-987`). OpenRouter won't; Monk prices tokens itself from `metrics.totalInputTokens/totalOutputTokens`.

## Agents and subagents

- `client.agents.create({ name, description, manifest: AgentSpec })`, or inline via `sessions.create({ agent: { spec } })`.
- `AgentSpec`: `model {name, params}`, `instructions`, `mcpServers[] {name, enableTools, disableTools, requireApprovalForTools, preload, preloadTools}`, `skills[] {name, preload}`, `config {iterationLimit, dynamicSubAgents, sandbox, askUserQuestions, contextManagement, webSearch, ...}`.
- **No static subagents.** Only dynamic ones: the LLM calls `create_sub_agent {name, input}` (`C/.../DynamicSubAgents.ts`). Children inherit the parent's toolsets (`SessionHandle.ts:510`) and, in the stock build, the parent's model (`builtinsFromSpec.ts:48-52` never passes a `ModelSetConfig`).
- ⇒ PRD roles (Researcher/Coder/Operator/Phone) become **instructions in the orchestrator prompt**, not configured subagents. A separate **vision model for the Phone subagent needs a core patch** (pass a `ModelSetConfig` in `builtinsFromSpec.ts`) — candidate for `patches/`.

## SDK: sessions, turns, events

```ts
const client = new TrueForge({ baseUrl, timeoutInSeconds: 600 });
const { data: session } = await client.sessions.create({ agent: { name: 'monk' } });
const stream = await client.sessions.createTurnStream(session.id, { input: [{ type: 'user.message', content }] });
for await (const { data: ev, id: seq } of stream.withMetadata()) { /* isEventDelta / mergeEventDelta */ }
```

- `TurnStreamingEvent` types: `turn.created`, `model.message` (+ `model.message.delta`, merge by `id` with `mergeEventDelta`), `tool.response`, `tool.approval_required`, `tool.response_required`, `thread.created`, `thread.done`, `mcp.initialize`, `mcp.auth_required`, `sandbox.created`, `turn.update`, `turn.done` (always last; `state.status` = `done | cancelled | error`). Every event has `id`, `createdAt`, `threadId` (`"main"` or a subagent thread).
- Tool call starts are inside `model.message.toolCalls[]`; there is no separate start event.
- **`tool.response` has no error flag**; MCP errors arrive as `content = JSON.stringify({ error })` (`C/core/mcp/executeToolCalls.ts:153-154`). Fault/recovery accounting must come from the chaos proxy's own log, joined on tool-call id / session.
- Resume a live stream: `sessions.subscribeToTurn(sid, tid, { afterSequenceNumber })`.
- Interrupt: `sessions.cancel(sessionId)` — then let the stream end on `turn.done{cancelled}`.
- Session metrics: `sessions.get` → `metrics {totalCostInUsd?, totalDurationMs, totalTurns}`.
- Chat-id → session mapping helper exists but is internal: `client.internal.sessions.getOrCreateByExternalId`. Prefer Monk's own `links` table.

## Open questions from the PRD — answers

### 1. Hook/middleware around tool execution?

**No.** Tool calls run in `C/core/mcp/executeToolCalls.ts:40` → `ToolSet.callTool`. Core has in-process `AgentCapability` processors (`toolResponseProcessors` can rewrite results after execution), but they are only injectable via a `resolveAgentDefinition` override, which the server never exposes (`P/apis/turns.ts:188`). No pre-execution hook on arguments.
Built-in tools (`exec`/sandbox, `web_search`, `web_fetch`, `ask_user_question`, `create_sub_agent`, `call_tool`, ...) are in-process `LocalToolMCP` and never touch a remote MCP server.
⇒ The chaos proxy as a registered remote MCP server is the right (and only non-patch) seam. **v1 chaos covers MCP tools only**, as the PRD's risk table anticipated. Sandbox/web chaos would need a patch.

### 2. How are skills loaded from git?

- Registered via `PUT /api/v1/settings/skills` as `{ type: 'git', name, url, path?, ref, description }`. **URL must be HTTPS on github.com or gitlab.com**; no `file://`, no local directories (`P/schemas/skill.ts:15-28`).
- **Effectively public repos only**: the in-sandbox downloader runs git with prompts and global config disabled and no credentials are passed (`C/core/sandbox/scripts/skill_downloader.py:505-510`).
- Refresh: resolved every turn; `git ls-remote` on `ref`, re-downloads only if the commit changed. A branch ref picks up new commits on the next turn. No webhook, no server cache.
- **Frontmatter is never parsed.** Name/description shown to the model come from the registered manifest; the agent reads `SKILL.md` from `/opt/tfy/skills/{name}`. Extra `monk:` keys are harmless.
- Skills require a sandbox (Daytona or the local fallback).
- ⇒ `skills-repo` must be **a public GitHub repo**; the learning loop must (a) commit + push the SKILL.md and (b) register/update the skill (name + description) through the settings API and add it to the agent's `skills[]`. One registration per skill (`path` = skill dir), max 50 per agent.

### 3. Can the SDK read a finished session's full event log?

**Yes.** `sessions.listEvents(sid, { lastTurnId?, pageToken?, limit? })` (whole session, newest first, items `{ event, turnId }`) and `sessions.listTurnEvents(sid, turnId, ...)` (completed turns, deltas pre-merged). Arguments in `model.message.toolCalls[].function.arguments`, results in `tool.response.content`, `createdAt` on every event.

### 4. How are approvals exposed over the SDK?

- Triggered only per MCP server by `requireApprovalForTools`: `@all`, `@write`, `@destructive` (default), or **exact tool names** — no globs (`C/core/mcp/toolSelectors.ts:74`). Built-in tools never require approval.
- Stream emits `tool.approval_required { toolCalls: [{ id, sourceEventId }] }`; turn pauses (`turn.update {status:'paused'}`, `turn.done.state.requiredActions`).
- Respond by creating a **new turn** whose input is only approvals: `{ type: 'user.tool_approval', threadId, toolCallId, approval: { status: 'allow' } | { status: 'deny', reason? } }`. All pending ids in one request.
- `ask_user_question {question, options[0-5]}` → `tool.response_required`; answer with `{ type: 'user.tool_response', threadId, toolCallId, content }`. Root thread only, needs `config.askUserQuestions.enabled`.
- ⇒ Gateway/TUI render buttons from `tool.approval_required` + the matching `model.message.toolCalls` entry (look up by `sourceEventId`). The chaos proxy should set MCP `annotations.destructiveHint` on destructive tools so `@destructive` works, and Monk's agent spec also lists exact names (merge, delete_branch, uninstall, ...).
- Caveat: in sandbox code mode, MCP tools needing approval throw instead of pausing (`CodeModeDispatcher.ts:130-142`). Keep code mode off for Monk's agent or accept this.

### 5. Does the MCP catalog accept a local HTTP MCP server without auth?

**Yes, with one env var.** Registration `{ type: 'remote', name, url, description, auth? }` via `POST /api/v1/settings/mcp-servers`; `http:` accepted, auth optional. But the SSRF guard blocks loopback/private IPs and dotless hosts like `localhost` by default (`C/core/util/ssrfGuard.ts`). Start TrueForge with
`OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'` (or `NETWORK_POLICY_ENABLED=false`).
Transports: Streamable HTTP, then SSE fallback. **No stdio** — the chaos proxy owns stdio upstreams (GitHub MCP, mobile-mcp) as planned. MCP calls originate from the server process, so `localhost` = TrueForge host.

## Other findings that change the plan

- **Schedules exist in TrueForge** (`client.schedules.*`: cron + IANA timezone, per saved agent), but minimum interval is 1 hour and there is **no delivery** of results. Monk's cron module is still needed for delivery to channels; it can stay on croner + fresh sessions.
- **Sandbox:** Daytona is configured with `PUT /api/v1/settings/sandbox-providers {type:'daytona', auth:{api_key}, ...}`. With no provider, standalone mode falls back to a **local bwrap sandbox** (needs `bwrap`, `socat`, `rg`, python) whose network allowlist is pypi + GitHub only — fine for skill verification and Python scripts, **not enough for a Gradle build** (Maven Central/Google Maven). The mobile showcase needs Daytona.
- **Benchmark dir** runs DevRev Enterprise-Bench against 3 harnesses (Python, blind LLM judge). Usable as the PRD's "external check", but its tasks aren't shipped and need their own MCP servers.

## Decisions for M1

1. Chaos proxy: Node + `@modelcontextprotocol/sdk`, streamable HTTP server on `localhost:8787`, upstream GitHub MCP over stdio. Registered as one remote MCP server `monk-chaos`.
2. TrueForge launched with `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'`.
3. Session correlation without a patch: the proxy runs **stateful** streamable HTTP and issues an `Mcp-Session-Id`. TrueForge persists it per server in the turn snapshot and resumes it on every later turn of the same session (`C/agent-session/TurnResourceResolver.ts:192`), and emits it in the `mcp.initialize` event (`McpServerInitInfo.sessionId`). The proxy logs by MCP session id; consumers (learning loop, eval runner, TUI) join `mcp.initialize.sessionId` → TrueForge `session_id`. Subagent threads share the parent's toolsets, so they share the MCP session too.
