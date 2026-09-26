# Approval

The one screen that shouts: a full-screen double yellow frame, a yellow band with a pulsing `◆` and marching hazard stripes, and the monk holding a "need your ok!" sign, around a calm, readable summary of exactly what will happen.

## What it says, in order

1. "Before I ship this, I need your ok." and, in red, why it can't be undone.
2. Each action, numbered in yellow, with every identifier: repo, PR and title, head SHA and branch, base SHA; tag, file, size and hash; who gets told.
3. "why it's safe": the evidence as `✓` lines (sandbox build, sandbox tests, phone re-test, issue fixed).
4. That the same question is open on Telegram and the first answer wins.
5. Three rounded buttons with words: `y yes, ship it` (green), `n not now` (red), `e edit first`.
6. The exact calls on a darker strip.

## Focus and keys

- Focus is trapped. `y`, `n`, `e`, `d` (diff), `1`/`2` (inspect one call) and `a` (exact calls, 80×24) are the only keys.
- Keys wake up after 0.6 s ("keys wake up in 0.6s..." then "✓ keys are live") so a keystroke already in flight can't approve.
- `esc` does not close it. `n` lets you type a reason that goes back to monk. `e` opens the calls in your editor and shows the screen again with changes marked.
- One terminal bell when it opens.

## Motion and live

- `◆` pulses, the stripes march right to left, the monk blinks and the sign flips between its two lines. Nothing else on screen moves.
- If you answer on Telegram first, the screen closes and the conversation logs `◆ approved on Telegram`.

## 80×24

Same order, tighter: no monk, reasons on one line, three buttons across.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 700 ms | 3 | `(o o)` → `(- -)` |
| gate pulse | 2 | 400 ms | 3 | `◆` → `◇` |
| hazard stripes | 2 | 160 ms | 5 | ` ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱` → `  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱` → `╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱` |
| approval sign | 2 | 700 ms | 8 | ` ¦  need your  ¦` → ` ¦ this one's  ¦` |
| mascot · hold | 1 | 600 ms | 4 | `   (o o)` → `   (- -)` |
| key arming | 2 | 300 ms | 7 | `keys wake up in 0.6s.` → `keys wake up in 0.6s..` → `keys wake up in 0.6s...` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `ApprovalModal.frames.json`.

### 120 × 36

```text
 (o o) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.52                         ⚡5 ✓5   ◆ waiting for you
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║  ◆ HOLD ON · I need your ok · this can't be undone                                             ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱ ║
║                                                                                                                      ║
║                               Before I ship this, I need your ok.                                                    ║
║     .-------------.           ✗ This can't be undone: a merge needs a revert PR, and release emails stay sent.       ║
║     |  need your  |                                                                                                  ║
║     |     ok!     |           1  merge PR #12 into main                                                              ║
║     '------.------'              monk-demo/tally · #12 "Add swipe-to-archive on habit list" · 3 commits              ║
║            |                     squash a3f9c1e (fix/undo-insets) → main at 7d20b44                                  ║
║            |    ___                                                                                                  ║
║            |   (o o)          2  publish release v1.3.0                                                              ║
║            |  __) (__            app-release.apk · 4.2 MB · sha256 9c1e07…4b07                                       ║
║              /  \_/  \           public · 38 watchers get an email                                                   ║
║             (____|____)                                                                                              ║
║             ~~~~~~~~~~~       why it's safe                                                                          ║
║                               ✓ build passed in the sandbox             ✓ tests 38/38 in the sandbox                 ║
║                               ✓ re-tested on the phone after the fix    ✓ issue #13 fixed by a3f9c1e                 ║
║                                                                                                                      ║
║                               also asked on Telegram · whoever answers first wins                                    ║
║                                                                                                                      ║
║                               ╭──────────────────────╮   ╭──────────────────╮   ╭────────────────────╮               ║
║                               │  y  yes, ship it     │   │  n  not now      │   │  e  edit first     │               ║
║                               ╰──────────────────────╯   ╰──────────────────╯   ╰────────────────────╯               ║
║                                                                                                                      ║
║                               keys wake up in 0.6s.     esc won't close this, pick one                               ║
║                                                                                                                      ║
║                                                                                                                      ║
║                               exact calls                                                                            ║
║                                merge_pull_request owner=monk-demo repo=tally pull_number=12 merge_method=squash      ║
║                                create_release tag_name=v1.3.0 target_commitish=main name="Tally 1.3.0" draft=false   ║
║                                                                                                                      ║
║                               d full diff  ·  1 / 2 look at one call  ·  n lets you say why                          ║
║                                                                                                                      ║
║                                                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

### 80 × 24

```text
 (o o) monk · chaos moderate · gen 3 · $0.52                  ◆ waiting for you
╔══════════════════════════════════════════════════════════════════════════════╗
║  ◆ HOLD ON · I need your ok · this can't be undone               ╱╱╱  ╱╱╱  ╱ ║
║                                                                              ║
║  Before I ship this, I need your ok.                                         ║
║  ✗ this can't be undone                                                      ║
║                                                                              ║
║  1 merge PR #12 into main                                                    ║
║    monk-demo/tally · squash a3f9c1e → main 7d20b44                           ║
║  2 publish release v1.3.0                                                    ║
║    app-release.apk 4.2 MB · public · 38 watchers emailed                     ║
║                                                                              ║
║  why it's safe                                                               ║
║  ✓ sandbox build   ✓ 38/38 tests   ✓ phone re-test   ✓ #13 fixed             ║
║                                                                              ║
║  also asked on Telegram · first answer wins                                  ║
║                                                                              ║
║  ╭────────────────────╮   ╭────────────────╮   ╭──────────────────╮          ║
║  │  y  yes, ship it   │   │  n  not now    │   │  e  edit first   │          ║
║  ╰────────────────────╯   ╰────────────────╯   ╰──────────────────╯          ║
║                                                                              ║
║  keys wake up in 0.6s...   a exact calls · d diff                            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

