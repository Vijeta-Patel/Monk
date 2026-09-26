# Everything (ctrl+p) and slash commands

`ctrl+p` opens "everything": a rounded popup over the dimmed screen with fuzzy search. Typing `/` in the input opens the command list just above it.

## Everything (ctrl+p)

- Rounded saffron box on the raised background; the rest of the screen dims but keeps moving.
- Matching letters are saffron, bold and underlined. Groups (`chaos`, `bench`, `recent`) in faint lowercase, current values in the middle column, shortcuts on the right.
- The selected row has a `›` and a slightly lighter background.
- `↑↓` move, `enter` go, `esc` close and return focus.

## Slash commands

- A rounded list anchored to the left edge just above the input, with plain-language descriptions ("break something on purpose").
- Matches stay bright with the typed part underlined; the rest stay listed but dim so nothing jumps around while you type.
- After a command that takes arguments, the list switches to its values: `/chaos p` offers `pressure` and the faults starting with `p`.
- `tab` completes, `enter` runs.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 3 | 500 ms | 5 | `(o o)` → `(- -)` |
| top bar spinner | 1 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| caret | 3 | 530 ms | 2 | `█` → `(blank)` |
| wordmark shimmer | 72 | 70 ms | 34 | `█` in `ink` → `saffron` |
| mascot · calm | 13 | 700 ms | 4 | `(blank)` → `    ___` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `CommandPalette.frames.json`.

### 120 × 36

```text
 (o o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.18                  ⚡2 ✓2   ⠋ testing PR #12  01:12
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │
   › Test PR #12 on the phone before we ship                                      │                    .
                                                                                  │                 ___
  • On it. Six steps: re╭─ everything ──────────────────────────────────────────────── ctrl+p ─╮   (o o)
    the phone, report ba│                                                                      │  __) (__
                        │  › chaos█                                                   6 of 31  │ /  \_/  \
  ✓  read PR #12 · 6 fil│ ──────────────────────────────────────────────────────────────────── │(____|____)
  ⚡ GitHub said slow do│  chaos                                                               │~~~~~~~~~~~
     ↳ used skill github│ ›  switch chaos profile                 moderate             ctrl+k  │
  ✓  got the changed fil│    throw a fault right now              api or phone                 │ng with 2 helpers
  ✓  built the app in th│    set how often faults happen          30%                          │
  ⠋  running unit tests │    turn chaos off for a bit                                          │                1 of 6
     ▓██████████████████│                                                                      │░░░░░░░░░░░░░░░░░░░░░░
                        │  bench                                                               │PR            operator
  • Build is green. 31 o│    run the benchmark under chaos        /bench                       │est              coder
    the phone and try th│                                                                      │ the phone       phone
                        │  recent                                                              │ck            operator
                        │    open skills                          14 known             ctrl+s  │he fix           phone
                        │    resume a telegram chat               /resume                      │ublish       needs you
                        │    start fresh                          /new                         │
                        │                                                                      │              moderate
                        │                                                                      │it     ✓ 2 steps
                        │                                                                      │spike  ✓ 1 step
                        │                                                                      │
                        │  ↑↓ move   enter go   esc close                                      │              14 known
                        ╰──────────────────────────────────────────────────────────────────────╯te-limit         using
                                                                                  │  ↳ gradle-offline-cache     loaded
                                                                                  │  ↳ android-emulator-inst…   loaded
                                                                                  │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › █type to queue a message for after this                                                                   esc stop │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+o details   tab move around   ctrl+l sidebar   ctrl+p everything   ? help
```

### 120 × 36, slash commands

```text
 (- -) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.00                                              ready
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │
                                                                                  │
                               █▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀                               │           .
                               █ ▀ █ █  █ █  █ █▀▄                                │                 ___     .
                               ▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀                               │          .     (- -)
                                                                                  │               __) (__    .
              an agent that gets better every time something breaks               │           .  /  \_/  \
                                                                                  │             (____|____)  .
                                                                                  │             ~~~~~~~~~~~
            ╭─ try ──────────────────────────────────────────────────╮            │
            │ › Test PR #12 on the phone before we ship              │            │         ready when you are
            │ › /resume  pick up where Telegram left off             │            │
            │ › /chaos   break something on purpose                  │            │
            │ › /skills  see what monk has learned                   │            │
            ╰────────────────────────────────────────────────────────╯            │  skills                   14 known
  ╭─ commands ──────────────────────────────────── 2 match ─╮                     │  ✦ android-dismiss-popup       new
  │   /new      start fresh                                 │                     │  ✦ android-relaunch-crash      new
  │   /agent    talk to a different agent                   │                     │  ↳ github-rate-limit           90%
  │   /link     join from Telegram or Discord               │                     │  ↳ android-emulator-inst…      93%
  │   /stop     stop what monk is doing                     │                     │  · 10 more  ·  ctrl+s
  │ › /chaos    break something on purpose                  │                     │
  │   /skills   see what monk has learned                   │                     │  chaos                    moderate
  │   /cron     schedule a task                             │                     │  30% of tool calls get a fault
  │   /status   what's connected right now                  │                     │  seed 42 · same faults every run
  │   /bench    run the benchmark, watch it live            │                     │  never on delete, merge, publish
  │   /resume   pick up a Telegram or Discord chat          │                     │
  │                                                         │                     │  generation 3
  │   the rest stay listed, dimmed                          │                     │  each run teaches the next one
  ╰─────────────────────────────────────────────────────────╯                     │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › /ch█                                                                                       tab complete · enter go │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  enter send   / commands   ctrl+p everything   tab move around   ? help
```

### 80 × 24, slash arguments

```text
 (- -) monk · chaos moderate · gen 3 · $0.00                              ready
────────────────────────────────────────────────────────────────────────────────

                              █▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀
                              █ ▀ █ █  █ █  █ █▀▄
                              ▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀

             an agent that gets better every time something breaks


  ╭─ /chaos · pick a profile or a fault ────────────────────────╮
  │   profile                                                   │
  │ › pressure            scary errors near risky steps         │
  │   fault                                                     │
  │   popup               a dialog over the app                 │
  │   permission_dialog   a surprise permission prompt          │
  │   permission_denied   403 on one thing                      │
  │   partial_result      a list cut short                      │
  ╰─────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────────────────────╮
│ › /chaos p█                                                     tab complete │
╰──────────────────────────────────────────────────────────────────────────────╯
  enter send   / commands   ctrl+p everything   ? help
```

