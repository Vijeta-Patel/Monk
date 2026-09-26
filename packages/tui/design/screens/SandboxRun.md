# Sandbox run

Opening a sandbox step shows a dashed, darker well with an inverse `▣ sandbox` chip, a little ASCII crate with steam, the streaming test output and a row of ticks filling up to 38/38.

## Labelling

Three signals, all required: the `▣ sandbox` chip, the dashed rounded border and the sunken background. The header says where (`daytona · /work/tally`) and the right side says "isolated · can't touch your machine". Nothing that ran anywhere else uses a dashed border.

## Focus and live

- Opening it (`ctrl+o`) moves focus into the well: `↑↓` scroll, `end` follows again, `c` copies, `ctrl+o` folds it.
- Output streams line by line: passing tests in green with `✓`, failures in red with `✗` and the word FAILED.
- The tick row fills one `✓` per passing test and shows `31/38`; a spinner line shows CPU, memory and time.
- The crate puffs steam while the command runs and stops when it exits. On success the well folds itself after 3 s; on failure it stays open.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 500 ms | 5 | `(o o)` → `(- -)` |
| top bar spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| spinner | 5 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| tests filling | 2 | 450 ms | 12 | `✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓·······  31/38` → `✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓······  32/38` → `✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓·····  33/38` |
| crate steam | 2 | 350 ms | 4 | ` ~` → `~ ~` → `(blank)` |
| mascot · look | 2 | 450 ms | 4 | `   (o o)` → `   (- -)` |
| plan progress | 1 | 70 ms | 14 | `▓███████░░░░░░░░░░░░░░░░░░░░░░░░░` → `▓▓██████░░░░░░░░░░░░░░░░░░░░░░░░░` → `█▓▓█████░░░░░░░░░░░░░░░░░░░░░░░░░` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `SandboxRun.frames.json`.

### 120 × 36

```text
 (o o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.18                  ⚡2 ✓2   ⠋ testing PR #12  01:12
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │
   › Test PR #12 on the phone before we ship                                      │                    .
                                                                                  │                 ___
  • Building and testing it in the sandbox first, so nothing runs on your         │                (o o)
    machine.                                                                      │               __) (__
                                                                                  │              /  \_/  \
  ✓  built the app in the sandbox · 4.2 MB apk                      coder  48.2s  │             (____|____)
  ⠋  running unit tests in the sandbox  ▾                           coder  00:21  │             ~~~~~~~~~~~
    ╭┄ ▣ sandbox  daytona · /work/tally ┄ isolated · can't touch your machine ┄╮  │
    ┆  $ ./gradlew testDebugUnitTest                                ~          ┆  │         watching the tests
    ┆  > Task :app:compileDebugKotlin  UP-TO-DATE                 +-------+    ┆  │
    ┆  > Task :app:testDebugUnitTest                             /       /|    ┆  │  plan                       1 of 6
    ┆  ✓ archive_removesFromActive                              +-------+ |    ┆  │  ▓███████░░░░░░░░░░░░░░░░░░░░░░░░░
    ┆  ✓ archive_keepsHistory                                   | ▣ box | +    ┆  │  ✓ read the PR            operator
    ┆  ✓ undoArchive_restoresOrder                              |       |/     ┆  │  ⠋ build + test              coder
    ┆  ✓ swipe_emitsArchiveEvent                                +-------+      ┆  │  ○ try it on the phone       phone
    ┆  ✓ undo_withinWindow                                                     ┆  │  ○ report back            operator
    ┆  ✓ dailyStreak_acrossMidnight                                            ┆  │  ○ re-test the fix           phone
    ┆                                                                          ┆  │  ◆ merge + publish       needs you
    ┆  ✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓·······  31/38                           ┆  │
    ┆  ⠋  2 cpu · 4 GB · 00:21                                                 ┆  │  skills                   14 known
    ╰┄ following ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ↑↓ scroll · ctrl+o fold ┄╯  │  ↳ gradle-offline-cache      using
                                                                                  │  ↳ android-emulator-inst…   loaded
                                                                                  │
                                                                                  │
                                                                                  │
                                                                                  │
                                                                                  │
                                                                                  │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ›  type to queue a message for after this                                                                   esc stop │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ↑↓ scroll   end follow   ctrl+o fold   c copy   tab move around   esc stop
```

### 80 × 24

```text
 (o o) monk · chaos moderate · gen 3 · $0.18           ⠋ testing PR #12  01:12
────────────────────────────────────────────────────────────────────────────────
  ✓  built the app in the sandbox · 4.2 MB apk                    coder  48.2s
  ⠋  running unit tests in the sandbox  ▾                         coder  00:21
    ╭┄ ▣ sandbox  daytona · /work/tally ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ isolated ┄╮
    ┆  $ ./gradlew testDebugUnitTest                              ~          ┆
    ┆  > Task :app:compileDebugKotlin  UP-TO-DATE               +-------+    ┆
    ┆  > Task :app:testDebugUnitTest                           /       /|    ┆
    ┆  ✓ archive_removesFromActive                            +-------+ |    ┆
    ┆  ✓ archive_keepsHistory                                 | ▣ box | +    ┆
    ┆  ✓ undoArchive_restoresOrder                            |       |/     ┆
    ┆  ✓ swipe_emitsArchiveEvent                              +-------+      ┆
    ┆  ✓ undo_withinWindow                                                   ┆
    ┆  ✓ dailyStreak_acrossMidnight                                          ┆
    ┆                                                                        ┆
    ┆  ✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓✓·······  31/38                         ┆
    ┆  ⠋  2 cpu · 4 GB · 00:21                                               ┆
    ┆                                                                        ┆
    ╰┄ following ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ↑↓ scroll · ctrl+o fold ┄╯

╭──────────────────────────────────────────────────────────────────────────────╮
│ ›  queue a message                                                  esc stop │
╰──────────────────────────────────────────────────────────────────────────────╯
  ↑↓ scroll   end follow   ctrl+o fold   esc stop
```

