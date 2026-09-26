# Main view, working

Mid-task: your message on a soft raised strip, monk's replies after a saffron `•`, each step in plain words with who did it and how long it took, and the sidebar showing the plan, chaos and skills.

## Focus

The input keeps focus so you can queue a follow-up. `esc` stops the turn from anywhere. `tab` to the conversation, then `↑↓` picks a step and `ctrl+o` opens its details (the tool name, arguments and raw result).

## Live

- Steps appear as they start with a spinner and a saffron timer, then settle to `✓`, `✗` or `⚡` with the final time.
- A step that has progress shows a shimmering bar under it (`31/38 passed`).
- Monk's reply streams in with a blinking `▌`.
- Sidebar: the plan bar fills and shimmers; the running step spins and its owner turns saffron; chaos lists each fault and how it was recovered; skills flip from `loaded` to `using`.
- The top bar shows the working face, `⚡2 ✓2`, a spinner, what monk is doing and the elapsed time.

## 80×24

Same conversation at 76 columns; the sidebar is one `ctrl+l` away.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 500 ms | 5 | `(o o)` → `(- -)` |
| top bar spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| spinner | 3 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| test progress | 2 | 70 ms | 30 | `▓███████████████████████░░░░░░` → `▓▓██████████████████████░░░░░░` → `█▓▓█████████████████████░░░░░░` |
| streaming cursor | 2 | 300 ms | 3 | `▌` → `(blank)` |
| mascot · work | 2 | 450 ms | 6 | `   (o o)` → `   (- -)` |
| plan progress | 1 | 70 ms | 14 | `▓███████░░░░░░░░░░░░░░░░░░░░░░░░░` → `▓▓██████░░░░░░░░░░░░░░░░░░░░░░░░░` → `█▓▓█████░░░░░░░░░░░░░░░░░░░░░░░░░` |
| caret | 2 | 530 ms | 2 | `█` → `(blank)` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `MainWorking.frames.json`.

### 120 × 36

```text
 (o o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.18                  ⚡2 ✓2   ⠋ testing PR #12  01:12
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │
   › Test PR #12 on the phone before we ship                                      │                    .
                                                                                  │                 ___
  • On it. Six steps: read the PR, build and test it in the sandbox, try it on    │                (o o)
    the phone, report back. I'll stop and ask before merging or publishing.       │               __) (__
                                                                                  │              /  \_/  \
  ✓  read PR #12 · 6 files changed                               operator   0.8s  │             (____|____)
  ⚡ GitHub said slow down · rate_limit                          operator   0.3s  │             ~~~~~~~~~~~
     ↳ used skill github-rate-limit-recovery · waited 12s, batched reads          │
  ✓  got the changed files · recovered                           operator  12.6s  │       thinking with 2 helpers
  ✓  built the app in the sandbox · 4.2 MB apk                      coder  48.2s  │
  ⠋  running unit tests in the sandbox                              coder  00:21  │  plan                       1 of 6
     ▓███████████████████████░░░░░░ 31/38 passed                                  │  ▓███████░░░░░░░░░░░░░░░░░░░░░░░░░
                                                                                  │  ✓ read the PR            operator
  • Build is green. 31 of 38 tests passed so far; next I'll install the app on    │  ⠋ build + test              coder
    the phone and try the new swipe-to-archive.▌                                  │  ○ try it on the phone       phone
                                                                                  │  ○ report back            operator
                                                                                  │  ○ re-test the fix           phone
                                                                                  │  ◆ merge + publish       needs you
                                                                                  │
                                                                                  │  chaos                    moderate
                                                                                  │  ⚡ rate_limit     ✓ 2 steps
                                                                                  │  ⚡ latency_spike  ✓ 1 step
                                                                                  │
                                                                                  │  skills                   14 known
                                                                                  │  ↳ github-rate-limit         using
                                                                                  │  ↳ gradle-offline-cache     loaded
                                                                                  │  ↳ android-emulator-inst…   loaded
                                                                                  │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › █type to queue a message for after this                                                                   esc stop │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+o details   tab move around   ctrl+l sidebar   ctrl+p everything   ? help
```

### 80 × 24

```text
 (o o) monk · chaos moderate · gen 3 · $0.18           ⠋ testing PR #12  01:12
────────────────────────────────────────────────────────────────────────────────

   › Test PR #12 on the phone before we ship

  • On it. Six steps: read the PR, build and test it in the sandbox, try it
    on the phone, report back. I'll stop and ask before merging or
    publishing.

  ✓  read PR #12 · 6 files changed                             operator   0.8s
  ⚡ GitHub said slow down · rate_limit                        operator   0.3s
     ↳ used skill github-rate-limit-recovery · waited 12s, batched reads
  ✓  got the changed files · recovered                         operator  12.6s
  ✓  built the app in the sandbox · 4.2 MB apk                    coder  48.2s
  ⠋  running unit tests in the sandbox                            coder  00:21
     ▓███████████████████████░░░░░░ 31/38 passed

  • Build is green. 31 of 38 tests passed so far; next I'll install the app
    on the phone and try the new swipe-to-archive.▌

╭──────────────────────────────────────────────────────────────────────────────╮
│ › █queue a message                                                  esc stop │
╰──────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+o details   ctrl+l sidebar   ? help
```

