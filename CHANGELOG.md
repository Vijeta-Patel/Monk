# Changelog

One line per milestone, with eval numbers at that point. Numbers stay "not measured" until a keyed run.

- M0 TrueForge spike: every open question answered from the code (docs/trueforge-notes.md). Live DeepSeek run pending keys.
- M1 Pass-through proxy: remote MCP proxy, stateful sessions linked to TrueForge sessions via `mcp.initialize`, every call in the event store. Tested in-process.
- M2 Faults + profiles: 10 API faults, seeded replay keyed by (seed, call index, tool), protect list ∪ destructive globs. 46 tests.
- M3 Eval runner: Monk-Bench GitHub (10 tasks, 3 held out), fixtures + reset, checkers, approvals, metrics. Gen 0: not measured (no keys).
- M4 Learning loop: extract → draft → dedupe/merge → verify → commit → register; retirement below 50% over the last 10 uses. The e2e test commits a skill from a real proxy recovery.
- M5 Mobile use: mobile-mcp behind the proxy, 6 phone faults, APK hand-off tool, Monk-Bench Mobile (6 tasks), emulator script. Not run on a device yet.
- M6 Benchmarks: learning curve, chaos-off control, stress + unseen faults, ablations, bootstrap CIs, REPORT.md + SVG charts. Not measured yet.
- M7 TUI: OpenTUI client; 17 design mockups match cell for cell (4 cells differ, and those come from the design itself); demo mode; smoke test drives the real app.
- M8 Dashboard: live SSE dashboard, learning curve, heatmap, skills + git history, controls, demo data.
- M9 Channels: Telegram + Discord, `/link` across platforms, streamed replies, approval buttons (only the requester can tap), `/screen`.
- M10 Cron: natural-language schedules with confirm, delivery, chaos drill.
- M11 Polish: `monk` CLI (up/setup/doctor/bench/learn), docker-compose, README, setup + demo docs, Tally demo app (16 Kotlin tests pass on JVM), optional TrueForge patch for per-subagent models. Demo not yet rehearsed with keys.
