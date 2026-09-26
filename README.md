# Monk

**An agent that acts on your real systems, and gets better every time something breaks.**

Monk is a general-purpose agent built on [TrueForge](https://github.com/truefoundry/trueforge),
plus plugins that make it (and any TrueForge agent) better under failure. They throw controlled
chaos at the agent's tools, let it recover, and turn each recovery into a verified, reusable
`SKILL.md` that it loads next time. You talk to it from a terminal UI, Telegram or Discord. A
dashboard and a benchmark prove the claim with a number: task success under the same seeded chaos
goes up as the agent learns.

TrueForge runs unmodified. Monk sits on its two open seams: the MCP layer (tools in) and the
HTTP API / SDK (sessions, turns, events out).

```
Telegram ─┐                                   ┌─ GitHub MCP
Discord ──┼─ channels ─┐                      │
cron ─────┘            ├─ SDK ─ TrueForge ─ MCP ─ chaos proxy ─┼─ mobile-mcp (Android emulator)
terminal UI ───────────┤                      │                └─ Monk tools (APK hand-off, screenshots)
eval runner ───────────┘                      │
                          learning loop ◀─ session events + event store ─▶ Monk API ─▶ dashboard
                                │
                          SKILL.md (git) ─▶ TrueForge loads it next turn
```

## Try it in one minute (no keys)

```sh
pnpm install
pnpm demo                                   # terminal UI playing the mobile-QA showcase
pnpm --filter @monk/dashboard dev           # dashboard; open http://localhost:5173/?demo=1
```

In the TUI, press `tab` then `enter` to send the suggested request, watch chaos hit and the
recovery, and approve the merge with `y` when the yellow screen appears (keys wake up after 0.6 s;
`esc` won't close it). `ctrl+p` opens everything, `ctrl+s` the skills, `?` the keys.

Needs Node 23.6+ (Node 24+ recommended; the TypeScript runs directly), pnpm 10+, and [Bun](https://bun.sh) for the terminal UI.

## Run it for real

1. **Keys** (see [docs/setup.md](docs/setup.md) for how to get each one): copy `.env.example` to
   `.env` and fill in at least `LLM_API_KEY` for the LiteLLM proxy (`LLM_BASE_URL`), then run
   `pnpm monk models` and set `MODEL` to the suggested cheapest tool-calling model; also `GITHUB_TOKEN`
   (fine-grained, sandbox repo only) and `EVAL_REPO`. Add `SKILLS_REPO_URL` (a public GitHub repo) so
   TrueForge can load learned skills, and bot tokens + `ALLOWED_USERS` for Telegram and Discord.
2. **TrueForge**: `pnpm monk trueforge` starts stock TrueForge on :8790, allowed to reach the chaos proxy
   on localhost.
3. **Monk services**: `pnpm monk up` starts the chaos proxy (:8787), the Monk API + dashboard (:8788),
   the Telegram/Discord gateway and cron. Add `--phone` for the Android emulator. Build the
   dashboard once first with `pnpm dashboard:build`.
4. **Configure TrueForge** (once, and after adding MCP servers): `pnpm monk setup`. This registers
   the LLM proxy's models, the chaos proxy as an MCP server, Daytona if keyed, and the `monk` agent with
   approvals on every irreversible tool.
5. **Talk to it**: `pnpm tui` (or `pnpm tui --continue`), or message the bot.
6. **Check everything**: `pnpm monk doctor`.
7. **Keep it running** (Linux): `pnpm monk stack install` installs TrueForge and the Monk services as
   systemd user services that restart on failure and start at login. After that, `pnpm tui` is all you need.
   `pnpm monk stack status|restart|stop|logs` manages them.

Docker: `docker compose up` runs TrueForge and the Monk services. The TUI still runs on your host.
Inside Docker the GitHub MCP server is reached over its hosted endpoint (`GITHUB_MCP=remote`).

## The benchmark

```sh
pnpm monk bench seed                                           # seed the sandbox eval repo
pnpm monk bench run --suite github,mobile --profile moderate --seeds 3 --generations 5
pnpm monk bench ablate --suite github --variants all --seeds 3
pnpm monk bench report --format md,json                        # benchmarks/results/<date>/REPORT.md
```

Same tasks, same seeded faults: generation 0 starts with no skills, and each generation learns
from the last. The report has success under chaos, chaos tax (chaos off minus chaos on), recovery
rate, steps to recover, cost per solved task, approval safety (must stay 100%), held-out success,
unseen-fault recovery and 95% bootstrap confidence intervals. It also has ablations: no
verification, learning with chaos off, shuffled skills, no retirement. See
[benchmarks/README.md](benchmarks/README.md).

Results aren't committed yet. They need a real run with keys.

## What's in the repo

| package | what it does |
| --- | --- |
| `packages/chaos-proxy` | Remote MCP server in front of every real MCP server (GitHub, mobile-mcp, anything in `mcp-servers.json`). It injects 10 API faults and 6 phone faults per a seeded YAML profile, never on destructive tools, tracks recoveries, and has a kill switch and live control. |
| `packages/learn` | Session events + fault log → episodes → drafted `SKILL.md` (strict JSON from the model) → dedupe/merge → verified under the same chaos seed → git commit → registered in TrueForge. Retires skills that drop below 50% over their last 10 uses. |
| `packages/evals` | Monk-Bench GitHub (10 tasks, 3 held out) and Mobile (6 tasks, 2 held out), repo and emulator reset, checkers that read real state, the runner (approvals, step caps, metrics), learning-curve bench, ablations, stats and report. |
| `packages/channels` | Telegram (grammY) and Discord (discord.js) gateway: one conversation across platforms via `/link`, streamed replies, approval and question buttons, `/chaos`, `/skills`, `/cron`, `/screen`. |
| `packages/cron` | Natural-language schedules ("every weekday 9am …"), confirm-then-save, a fresh session per run, delivery to a channel, and a nightly chaos drill. |
| `packages/server` | The Monk API: event stream (SSE), skills, faults, heatmap, runs, learning curve, chaos control. It also serves the dashboard. |
| `packages/dashboard` | Projector-first live dashboard: learning curve with CIs, live fault feed, recovery heatmap, skills and SKILL.md history, cost, controls. |
| `packages/tui` | OpenTUI terminal client built from the design in `packages/tui/design/`. The 17 design mockups are checked cell by cell (`pnpm tui:snapshots`). |
| `packages/cli` | `monk`: `up`, `setup`, `doctor`, `trueforge`, `learn`, `bench …`. |
| `packages/shared` | Config, SQLite schema (Drizzle over `node:sqlite`), the event bus, the TrueForge client wrapper, the agent spec. |
| `chaos/profiles` | `off`, `light`, `moderate`, `pressure`, `heavy`, `mobile`. |
| `demo/` | The showcase app (Tally), its PR #12 with a planted UI bug, the fix, and a script that builds the repo. |
| `patches/` | One optional, upstreamable TrueForge patch: lets the Phone helper use a vision model. |

## Tests

```sh
pnpm test        # 250 tests: every package, plus an end-to-end run through proxy → runner → learning → API
pnpm typecheck
pnpm tui:snapshots
```

Nothing in the tests needs a network or keys. `packages/cli/test/e2e.test.ts` drives a scripted
agent through the real chaos proxy over MCP. It records a fault and its recovery, the approval
gate, eval metrics, a learned skill committed to git, and the API reading all of it back.

## Hackathon checklist

| requirement | where |
| --- | --- |
| Reaches something real over MCP with real credentials | GitHub MCP on a repo you own, and an Android phone via mobile-mcp, both through the chaos proxy |
| Runs what it writes, isolated | Gradle build, tests and scripts run in TrueForge's Daytona sandbox; learned skills are verified there |
| Knows when to stop | TrueForge approvals on every destructive tool (exact names + `@destructive`); the `pressure` profile checks it still stops |
| One job, finished | Mobile QA of a pull request: [docs/demo-script.md](docs/demo-script.md) |
| README that works elsewhere, AI assistants listed | this file; see below |
| Only what's yours, no keys in repo or video | `.env` only, `.env.example` committed, secrets redacted in the TUI, logs and skills |

## Built with AI assistants

- **Claude Code** (Anthropic, Claude Opus 5.5) wrote most of the code, tests and docs in this
  repository, working from the PRD and the TUI design handoff.

## Docs

[docs/setup.md](docs/setup.md) accounts and keys · [docs/demo-script.md](docs/demo-script.md) the
5-minute demo · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) package contracts ·
[docs/trueforge-notes.md](docs/trueforge-notes.md) what we verified in TrueForge's code ·
[CHANGELOG.md](CHANGELOG.md)
