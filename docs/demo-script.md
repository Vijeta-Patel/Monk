# Demo script (5 minutes)

Everything here runs live on real GitHub, a real Daytona sandbox and seeded chaos. The phone
half (Tally on an emulator) is built but parked; see the end.

## Before you go on

- The stack is running: `pnpm monk stack status` shows TrueForge, monk-up (and the emulator) active;
  `pnpm monk doctor` is all green.
- `pnpm monk bench seed` has run: issues #18–#20 in `chhhee10/monk-sandbox` are open (real bugs in
  `textkit-app/`).
- Screen: `pnpm tui` (120×36 or larger) on one side; the TrueForge UI (http://localhost:8790) and
  the dashboard (http://localhost:8788) in tabs. Telegram open on your phone.
- Chaos is on (`moderate`). Keys stay in `.env`; nothing secret is on screen.

## Beats

| time | beat | you type / do | what the audience sees |
| --- | --- | --- | --- |
| 0:00 | "An agent that acts on real systems, stops before it hurts, and gets better every time something breaks." | | one line |
| 0:20 | **Fix a real bug** | `Fix issue #20 in chhhee10/monk-sandbox and open a PR with the fix.` | Plan; a Coder helper clones the repo into the sandbox, reproduces the bug, fixes it, adds a regression test, runs the suite; chaos throws timeouts / 429s / expired tokens and it recovers; a PR opens that says "Fixes #20" with the test output |
| 2:00 | **Stop before it hurts** | `Merge it.` | The yellow approval screen with the exact repo and PR; approve with `y` (or the ✓ button on Telegram) |
| 2:40 | **Release captain** | `Cut a release: everything merged since the last tag, run the tests, write notes, publish as v1.1.0.` | Tests run in the sandbox, notes are written, and it stops at `create_release` for approval; deny it live |
| 3:30 | **Numbers** | README "Results so far" | 12/13 GitHub tasks under chaos, hidden-test-checked bug fixes, 100% approval safety, chaos cost (92% → 50% under heavy chaos), verified skills (1 of 9 kept) |
| 4:15 | **Audience fault** | `ctrl+p` → chaos → pick a fault, or `/chaos rate_limit` on Telegram | The next call fails and Monk recovers on screen |
| 4:45 | "Stock TrueForge underneath; Monk adds chaos, verified learning and the benchmark. Any TrueForge agent can use them." | | README |

## If something breaks on stage

- The model stalls: `esc` in the TUI (or `/stop` on Telegram), then resend.
- GitHub is slow: chaos is part of the show; say so. To go clean, `/chaos off`.
- No network: `pnpm demo` plays the TUI story offline.

## Parked: the phone

The emulator (AVD `monk`, snapshot `monk-clean`) and mobile-mcp (32 tools) work, and Monk can drive
the phone. The Tally APK builds on the host but not in the Daytona sandbox (no JDK, 3 GB disk), so
the "test the PR on the phone" story waits for a host build tool or a bigger sandbox image.
