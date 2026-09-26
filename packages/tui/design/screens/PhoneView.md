# Phone view

While the Phone helper works, the sidebar turns into a phone: a rounded frame with signal bars and a clock, the live screenshot drawn in half-block cells, and a ripple where monk last tapped. The conversation explains what went wrong with a small ASCII diagram.

## Rendering

- Each screenshot cell is `▀` with the top pixel as text color and the bottom pixel as background: 22×24 cells show 22×48 pixels at the phone's shape. These are the only non-token colors in the UI.
- The ripple `+ → (+) → ( )` repeats on the last tap point.
- The overlap diagram draws the snackbar, the UNDO button and the nav bar with their y values, and an arrow pointing at "44 px hidden".
- `● live` pulses while frames are fresh; it turns into `○ paused` after 10 s without one.

## Focus and live

- The input keeps focus. `tab` reaches the phone; `f` shows it full-screen, `s` saves the screenshot, `ctrl+l` hides it.
- A new frame arrives after every tap or swipe, at most once a second.
- The phone appears when the Phone helper starts and gives the sidebar back 5 s after it finishes.

## 80×24

A one-line `▣ phone` strip at the top of the conversation says what happened last, with `ctrl+l show` for the full-screen phone. The diagram still shows in the conversation.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 600 ms | 3 | `(o o)` → `(- -)` |
| top bar spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| overlap arrow | 2 | 300 ms | 3 | `← 44 px hidden` → ` ← 44 px hidden` → `  ← 44 px hidden` |
| live dot | 1 | 500 ms | 3 | `● live` → `○ live` |
| tap ripple | 1 | 260 ms | 5 | ` +` → `(+)` → `( )` |
| caret | 2 | 530 ms | 2 | `█` → `(blank)` |
| streaming cursor | 1 | 300 ms | 3 | `▌` → `(blank)` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `PhoneView.frames.json`.

### 120 × 36

```text
 (o o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.27          ⚡3 ✓3   ⠋ trying it on the phone  02:48
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                  │  phone Pixel 7 · API 34     ● live
  ↑ earlier: read PR #12, built and tested it in the sandbox (38/38)              │
                                                                                  │      ╭──────────────────────╮
  ✓  copied the apk from the sandbox to the phone                   phone   2.4s  │      │ ▂▄▆     ▬▬▬    12:06 │
  ✓  installed Tally 1.3.0                                          phone   3.8s  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  ✓  swiped "Read 20 min" away · archived                           phone   1.4s  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  ✓  tapped UNDO                                                    phone   0.5s  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  ✗  nothing came back · row still archived                         phone   0.3s  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  ⠋  taking a screenshot for the issue                              phone  00:01  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  • Undo didn't work. On screen, the Undo button starts at y 2262 but the         │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
    navigation bar starts at y 2274, so the bar covers it. That's the bug.        │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
      ┌─ snackbar ───────────────────────────[ UNDO ] ─┐  y 2262                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
      │  Archived "Read 20 min"                        │                          │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
  ════╪══ nav bar · y 2274 ════════════════════════════╪════  ← 44 px hidden      │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
      └────────────────────────────────────────────────┘  y 2318                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ + ▀▀▀▀│
                                                                                  │      │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
                                                                                  │      │       ───────        │
                                                                                         ╰──────────────────────╯
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › █type to queue a message for after this                                                                   esc stop │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  esc stop   f phone full screen   s save screenshot   ctrl+l hide phone   tab move around   ? help
```

### 80 × 24

```text
 (o o) monk · chaos moderate · gen 3 · $0.27   ⠋ trying it on the phone  02:48
────────────────────────────────────────────────────────────────────────────────
   ▣ phone Pixel 7 · last tap: UNDO, nothing happened             ctrl+l show

  ✓  installed Tally 1.3.0                                        phone   3.8s
  ✓  swiped "Read 20 min" away · archived                         phone   1.4s
  ✓  tapped UNDO                                                  phone   0.5s
  ✗  nothing came back · row still archived                       phone   0.3s
  ⠋  taking a screenshot for the issue                            phone  00:01

  • Undo didn't work. On screen, the Undo button starts at y 2262 but the
    navigation bar starts at y 2274, so the bar covers it. That's the bug.▌

      ┌─ snackbar ───────────────────────────[ UNDO ] ─┐  y 2262
      │  Archived "Read 20 min"                        │
  ════╪══ nav bar · y 2274 ════════════════════════════╪════  ← 44 px hidden
      └────────────────────────────────────────────────┘  y 2318



╭──────────────────────────────────────────────────────────────────────────────╮
│ › █queue a message                                                  esc stop │
╰──────────────────────────────────────────────────────────────────────────────╯
  esc stop   ctrl+l show phone   ? help
```

