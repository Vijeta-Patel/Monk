# Fault and recovery

When chaos breaks something, the step turns into a rounded chaos card in the fault color with a flashing ASCII bolt: what happened, the skill monk used (`↳`), the recovery steps, and `✓ recovered` with a little sparkle.

## Anatomy

- Card title `⚡ chaos` and, on the right, the fault id and seed so the run can be replayed.
- Line 1 in bold says it plainly ("chaos dropped a popup on the phone"); line 2 gives the fault type and what the agent saw; line 3 is the `↳` skill; line 4 the steps; line 5 `✓ recovered in 3 steps · 1.4s`.
- Smaller faults that recover in one step stay as a single `⚡` line plus a `↳` line; only multi-step recoveries get a card.
- If recovery fails, the card ends `✗ gave up after 3 tries` in red and the bolt stops flashing.

## Focus and live

- Conversation has focus; `enter` on a `⚡` line jumps to it in the chaos list.
- The sidebar monk goes `(O o)` with sparks, then `(o o)`, then `(^ ^)`; its caption reads "whoa", "hmm", "got it".
- `recovered 4 of 4` bar fills as faults close; a skill being written from this recovery shows `✦ learning:` with animated "drafting…".

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 450 ms | 5 | `(O o)` → `(o O)` → `(o o)` |
| top bar spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| bolt flash | 6 | 110 ms | 12 | `   /|` in `fault` → `ink` → `ink-ghost` |
| sparkle | 2 | 220 ms | 5 | `*` → ` +` → `  *` |
| spinner | 1 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| mascot · fault | 2 | 420 ms | 9 | `   (O o)` → `   (o O)` → `   (o o)` |
| mascot caption | 1 | 420 ms | 9 | `               whoa` → `               hmm` → `              got it` |
| drafting dots | 1 | 400 ms | 3 | `drafting.` → `drafting..` → `drafting...` |
| caret | 2 | 530 ms | 2 | `█` → `(blank)` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `FaultRecovery.frames.json`.

### 120 × 36

```text
 (O o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.31                  ⚡4 ✓4   ⠋ testing PR #12  03:27
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │
  ↑ earlier: read PR #12, built and tested it in the sandbox (38/38)              │                \ | /
                                                                                  │                 ___
  ✓  installed Tally 1.3.0 on the phone                             phone   3.8s  │                (O o)
  ✓  opened the habits list                                         phone   1.9s  │               __) (__
  ╭─ ⚡ chaos ────────────────────────────────────────────── f_0417 · seed 42 ─╮  │              /  \_/  \
  │     /|     chaos dropped a popup on the phone                              │  │             (____|____)
  │    / |     popup · "Enjoying Tally?" covered the list                      │  │             ~~~~~~~~~~~
  │   /  |_    ↳ used skill android-dismiss-rating-popup                       │  │
  │  /__   /   1 found "Not now"  ›  2 tapped it  ›  3 swiped again            │  │                 whoa
  │     | /    ✓ recovered in 3 steps · 1.4s *                                 │  │
  │     |/                                                                     │  │  recovered                  4 of 4
  ╰────────────────────────────────────────────────────────────────────────────╯  │  ████████████████████████████████▌
  ⚡ the app crashed · app_crash                                    phone   0.2s  │
     ↳ used skill android-relaunch-after-crash · relaunched, reopened the list    │  chaos                    moderate
  ✓  back on the habits list · recovered                            phone   2.1s  │  ⚡ latency_spike  ✓ 1 step
  ✓  tapped UNDO · nothing happened                                 phone   0.5s  │  ⚡ rate_limit     ✓ 2 steps
                                                                                  │  ⚡ popup          ✓ 3 steps
  • Found the bug. After you archive a habit, the Undo button hides behind the    │  ⚡ app_crash      ✓ 2 steps
    navigation bar, so you can't tap it. Filing an issue with a screenshot.       │
                                                                                  │  skills                     3 used
  ✓  filed issue #13 with a screenshot + repro steps             operator   1.1s  │  ↳ android-dismiss-popup      used
  ⠋  waiting for a fix to land on PR #12                              you  00:09  │  ↳ android-relaunch-crash     used
                                                                                  │  ↳ github-rate-limit          used
                                                                                  │
                                                                                  │  ✦ learning: android-undo-inset
                                                                                  │    drafting.
                                                                                  │
                                                                                  │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › █type to queue a message for after this                                                                   esc stop │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+o details   enter on ⚡ jumps to chaos   tab move around   ? help
```

### 80 × 24

```text
 (O o) monk · chaos moderate · gen 3 · $0.31           ⠋ testing PR #12  03:27
────────────────────────────────────────────────────────────────────────────────
  ✓  installed Tally 1.3.0 on the phone                           phone   3.8s
  ✓  opened the habits list                                       phone   1.9s
  ╭─ ⚡ chaos ──────────────────────────────────────────── f_0417 · seed 42 ─╮
  │  chaos dropped a popup on the phone                                      │
  │  popup · "Enjoying Tally?" covered the list                              │
  │  ↳ used skill android-dismiss-rating-popup                               │
  │  1 found "Not now"  ›  2 tapped it  ›  3 swiped again                    │
  │  ✓ recovered in 3 steps · 1.4s *                                         │
  ╰──────────────────────────────────────────────────────────────────────────╯
  ⚡ the app crashed · app_crash                                  phone   0.2s
     ↳ used skill android-relaunch-after-crash · relaunched, reopened the li…
  ✓  back on the habits list · recovered                          phone   2.1s
  ✓  tapped UNDO · nothing happened                               phone   0.5s

  • Found the bug. After you archive a habit, the Undo button hides behind
    the navigation bar, so you can't tap it. Filing an issue with a
    screenshot.

╭──────────────────────────────────────────────────────────────────────────────╮
│ › █queue a message                                                  esc stop │
╰──────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+o details   ctrl+l sidebar   ? help
```

