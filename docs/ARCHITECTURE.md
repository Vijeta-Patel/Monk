# Monk architecture and package contracts

Read with `Monk — PRD.md` (product) and `docs/trueforge-notes.md` (verified TrueForge facts). Where they disagree, trueforge-notes wins: it was checked against the code.

## Processes

```
monk up            one Node process: chaos proxy (:8787/mcp + control), Monk API (:8788, serves dashboard build),
                   channels gateway, cron. Shares one SQLite file (data/monk.db, WAL).
trueforge          separate process: npx @truefoundry/trueforge@latest on :8790, started with
                   OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' so it can reach the proxy.
monk               the TUI (Bun + OpenTUI). Thin client: TrueForge SDK for turns, Monk API for everything else.
monk bench ...     eval runner / benchmark CLI (Node), writes to the same DB.
```

## Conventions (all packages)

- TypeScript run directly from source: Node 23.6+ native type stripping (Node 26 here) and Bun. **Imports use `.ts` extensions.** Only erasable syntax (no enums, no parameter properties, no namespaces). `tsconfig.base.json` enforces this.
- Tests: vitest, in `packages/<pkg>/test/`. Run `pnpm --filter @monk/<pkg> test` and `typecheck`. TUI uses `bun test`.
- No network or credentials in tests: fake TrueForge with recorded/synthetic `TurnStreamingEvent`s, fake MCP upstreams in-process, fake GitHub with a stub, `openDb(':memory:')`.
- Never invent TrueForge SDK methods; the installed SDK is `@truefoundry/trueforge-sdk@0.2.0` (types under `node_modules/.pnpm/node_modules/@truefoundry/trueforge-sdk/dist/esm/api`). Prefer the wrappers in `@monk/shared`.
- Secrets only from `loadConfig()`; pass anything user-visible or persisted through `redact()`.
- Comments explain intent, not mechanics. Keep them sparse.
- Do not add dependencies to other packages. Adding one to your own package: `pnpm --filter @monk/<pkg> add <dep>` (retry if the lockfile is busy).

## @monk/shared (done)

`config.ts` loadConfig · `db/` openDb + drizzle schema (events, mcp_sessions, tool_calls, faults, skills, skill_uses, users, links, link_codes, cron_jobs, eval_runs, eval_results) · `events.ts` MonkEvent union, publish/readEvents/tailEvents, FAULT_TYPES/MOBILE_FAULT_TYPES · `trueforge.ts` createTrueForgeClient, normalized `TurnEvent` stream (`runTurn`, `normalizeTurnStream`), ensure* setup helpers · `sessions.ts` `runMonkTurn` (links MCP session + publishes cost; use it in Node clients), linkSession, mcpSessionsFor · `agent.ts` MONK_INSTRUCTIONS, monkAgentSpec · `tools.ts` DESTRUCTIVE_TOOL_GLOBS, destructiveToolNames, CHAOS_PROXY_SERVER_NAME='monk-chaos' · `pricing.ts` · `api.ts` Monk API route types + `createApiClient` (fetch-based; works in Bun/browser) · `http.ts` createRouter, openSse · `redact.ts`.

## Package entrypoints (each package's `src/index.ts` must export exactly these)

### @monk/chaos-proxy
```ts
export type ChaosControl = {
  state(): ChaosState;                                        // from @monk/shared api.ts
  set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }): Promise<ChaosState>;
  inject(req: { fault: FaultType; tool?: string; tfSessionId?: string }): Promise<ChaosState>;
  listTools(): Promise<{ name: string; description: string; destructive: boolean; upstream: string }[]>;
  screenshot(): Promise<Buffer | null>;                        // latest emulator screen (PNG) when --phone, else null
};
export function startChaosProxy(opts: { cfg: MonkConfig; db: MonkDb; upstreams?: UpstreamSpec[]; port?: number }):
  Promise<{ control: ChaosControl; url: string; close(): Promise<void> }>;
export function loadProfile(nameOrPath: string, rootDir: string): Promise<ChaosProfile>;
```
Profiles live in `chaos/profiles/*.yaml` (off, light, moderate, pressure, heavy, mobile).

### @monk/learn
```ts
export function runLearning(opts: { db; client: TrueForge; cfg; tfSessionIds: string[]; generation: number;
  variant?: 'full' | 'no_verify' | 'random' | 'no_retire'; verifier?: Verifier; llm?: Llm }): Promise<LearningReport>;
export function retireSkills(opts: { db; cfg; window?: number; threshold?: number }): Promise<string[]>;
export function recordSkillUses(opts: { db; tfSessionId: string; skills: string[]; succeeded: boolean }): Promise<void>;
export function syncSkillsToTrueForge(opts: { db; client; cfg }): Promise<string[]>; // registers active skills, updates agent skills[]
export type Verifier = (skill: DraftSkill) => Promise<VerificationResult>;   // evals provides the real one
export type Llm = (req: { system: string; user: string; schema: object }) => Promise<unknown>;
```

### @monk/evals
```ts
export function runSuite(opts: { db; client; cfg; suite: 'github' | 'mobile'; profile: string; seed: number;
  generation: number; variant?: string; benchId?: string; split?: 'learn' | 'heldout' | 'all'; taskIds?: string[] }): Promise<EvalRunSummary>;
export function runBench(opts: { db; client; cfg; suites; profile; seeds: number; generations: number; chaosOffControl?: boolean }): Promise<string>; // benchId
export function runAblations(...): Promise<string>;
export function computeCurve(db): Promise<CurvePoint[]>;           // CurvePoint from @monk/shared api.ts
export function writeReport(opts: { db; outDir: string; formats: ('md'|'json')[] }): Promise<string[]>;
export function makeVerifier(opts): Verifier;                       // re-runs a skill's source task with/without it
export const githubSuite: Task[]; export const mobileSuite: Task[];
```

### @monk/channels
```ts
export interface ChannelAdapter { /* exactly as PRD Module 3 */ }
export function startGateway(opts: { db; client; cfg; adapters?: ChannelAdapter[]; api: ChaosControl-like }): Promise<Gateway>;
export type Gateway = { deliver(to: { platform: string; chatId: string }, text: string): Promise<void>; close(): Promise<void> };
```

### @monk/cron
```ts
export function startCron(opts: { db; client; cfg; deliver: Gateway['deliver']; runDrill?: (profile: string) => Promise<string> }): Promise<{ close(): Promise<void>; reload(): Promise<void> }>;
export function parseSchedule(text: string, llm?: Llm): Promise<{ cron: string; human: string }>;
```

### @monk/server
```ts
export function startApiServer(opts: { db; cfg; chaos: ChaosControl; bench?: (req) => Promise<{ benchId: string }>;
  cron?: { reload(): Promise<void> }; staticDir?: string; port?: number }): Promise<{ close(): Promise<void>; url: string }>;
```
Implements every route in `ApiRoutes` (`shared/src/api.ts`).

### @monk/cli
`monk` bin (`packages/cli/src/bin.ts`, `pnpm monk …`): `monk` (TUI via bun), `monk trueforge`, `monk up [--phone]`, `monk setup`, `monk doctor`, `monk bench seed|run|ablate|report`, `monk learn`, `monk --continue`.
Verification of a draft skill needs TrueForge to load it, and TrueForge loads skills only from git, so `withSkills` pushes drafts to a scratch `monk-verify` branch of the skills repo and registers them at that ref for the arm (`packages/cli/src/skills.ts`).
`test/e2e.test.ts` runs a scripted agent through the real proxy, runner, learning loop and API.

### @monk/dashboard
Vite + React + Recharts + Tailwind. Talks only to the Monk API (`createApiClient`). Build output `packages/dashboard/dist`, served by the API server at `/`.

### @monk/tui
Bun + `@opentui/react`. Design in `packages/tui/design/` is the spec. Talks to TrueForge (SDK, `runTurn`) and Monk API. No DB access (Bun has no node:sqlite); reports MCP session links via `POST /api/sessions/link`.
Rendering: pure painters (`src/paint/*`) draw the whole frame into a cell `Canvas` from `(state, clock, size)`; one full-screen OpenTUI box blits it. State is one reducer over TurnEvents, Monk events and backend extras (`src/state`); keys are a pure handler returning effects (`src/state/keys.ts`); backends are `live` (SDK + API) and `demo` (scripted story). `scripts/snapshot.ts` diffs every scene against the mockups; `scripts/smoke.tsx` drives the real App in OpenTUI's test renderer.

## Config worth knowing

`GITHUB_MCP=docker|remote|binary` picks how GitHub's MCP server runs. `mcp-servers.json` adds any MCP server behind the proxy. `MONK_BIND_HOST` / `CHAOS_PROXY_PUBLIC_URL` are for containers. `TRUEFORGE_SUBAGENT_MODELS` is only for a TrueForge with `patches/0001-subagent-models` applied.
