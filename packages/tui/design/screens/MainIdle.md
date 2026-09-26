# Main view, idle

The welcome screen: a shimmering `monk` logo, a friendly "try" card, what's connected, and the calm monk floating in the sidebar.

## Focus

The input has focus: saffron rounded border and a blinking caret. While it's empty, a typewriter types the showcase request as a suggestion; `tab` accepts it, any key replaces it. `tab` again moves to the sidebar.

## Live

- Connections line: `✓ github ✓ sandbox ✓ phone` from the chaos proxy's health; a lost connection turns into `✗ phone` in red with the word.
- Sidebar: newest skills first with `✦ new`; chaos profile and what it means in plain words; the current generation.
- Motion at rest: the monk breathes and floats, the aura twinkles, the logo shimmers every ~2 s, the caret blinks. Nothing else moves.

## 80×24

Logo, try card and connections stay; the sidebar hides and the top-bar face carries the monk.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 900 ms | 4 | `(- -)` → `(o o)` |
| wordmark shimmer | 72 | 70 ms | 34 | `█` in `ink` → `saffron` |
| mascot · calm | 13 | 700 ms | 4 | `(blank)` → `    ___` |
| typewriter placeholder | 2 | 90 ms | 28 | `Test PR #12 on the phone before we ship█` → `Test PR #12 on the phone before we ship` → `█` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `MainIdle.frames.json`.

### 120 × 36

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
                                                                                  │  ✦ android-dismiss-popup       new
                                                                                  │  ✦ android-relaunch-crash      new
       ✓ github    ✓ sandbox    ✓ phone    ⚡ chaos moderate    ↳ 14 skills       │  ↳ github-rate-limit           90%
                                                                                  │  ↳ android-emulator-inst…      93%
                                                                                  │  · 10 more  ·  ctrl+s
                                                                                  │
                                                                                  │  chaos                    moderate
                                                                                  │  30% of tool calls get a fault
                                                                                  │  seed 42 · same faults every run
                                                                                  │  never on delete, merge, publish
                                                                                  │
                                                                                  │  generation 3
                                                                                  │  each run teaches the next one
                                                                                  │

╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › Test PR #12 on the phone before we ship█                                                                   enter ↵ │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  enter send   / commands   ctrl+p everything   tab move around   ? help
```

### 80 × 24

```text
 (- -) monk · chaos moderate · gen 3 · $0.00                              ready
────────────────────────────────────────────────────────────────────────────────

                              █▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀
                              █ ▀ █ █  █ █  █ █▀▄
                              ▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀

             an agent that gets better every time something breaks


          ╭─ try ────────────────────────────────────────────────────╮
          │ › Test PR #12 on the phone before we ship                │
          │ › /resume  pick up where Telegram left off               │
          │ › /chaos   break something on purpose                    │
          │ › /skills  see what monk has learned                     │
          ╰──────────────────────────────────────────────────────────╯


      ✓ github    ✓ sandbox    ✓ phone    ⚡ chaos moderate    ↳ 14 skills

╭──────────────────────────────────────────────────────────────────────────────╮
│ › Test PR #12 on the phone before we ship█                           enter ↵ │
╰──────────────────────────────────────────────────────────────────────────────╯
  enter send   / commands   ctrl+p everything   ? help
```

