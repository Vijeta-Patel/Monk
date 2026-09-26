# feat(core): let dynamic subagents run on a different catalog model

## Why

`create_sub_agent` already supports a per-subagent model: `DynamicSubAgents` accepts a
`ModelSetConfig`, offers the keys as a `model` enum to the LLM, and `TurnResourceResolver`
resolves `agent_info.model` against the catalog. Nothing in `AgentSpec` can supply that config,
so on stock TrueForge every subagent runs on the parent's model.

Monk needs this for exactly one case: its Phone helper reads screenshots, which the text-only
parent model (DeepSeek V3.2) can't. Routing only that helper to a vision model keeps cost low.

## Change

- `AgentSpec.config.dynamic_sub_agents.models`: optional record of catalog model name →
  `{ description }` (when to pick it).
- `builtinsFromSpec` passes it to `dynamicSubAgents({ modelSetConfig })`.

When `models` is omitted nothing changes. When present, the model must list every model a
subagent may use (including the parent's), because the tool then requires a choice.

## Follow-ups in the same PR (per AGENTS.md)

- `pnpm openapi:write` and `pnpm sdk:generate` to publish `DynamicSubAgentModel` in the
  OpenAPI spec and SDKs; keep `packages/frontend` types in sync.
- `.changeset/*.md` for `@truefoundry/trueforge-core` (minor).
- Unit test in `packages/trueforge-core/test/agent-session/builtinsFromSpec.test.ts`: models in the
  spec produce a `create_sub_agent` schema with a `model` enum.

## Apply locally

```sh
cd vendor/trueforge && git apply ../../patches/0001-subagent-models.patch
```

Then set `TRUEFORGE_SUBAGENT_MODELS=true` in Monk's `.env` so `monk setup` sends the models map.
