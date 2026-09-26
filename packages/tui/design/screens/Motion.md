# Every animation, live

Every animation in the UI, running live. Each is a list of frames and one interval, driven by a single ticker.

- Only 1-cell characters inside animations; `⚡` never animates.
- Reduced motion freezes all of them on frame 1.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| spinner | 1 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| caret | 1 | 530 ms | 2 | `█` → `(blank)` |
| streaming cursor | 1 | 300 ms | 3 | `▌` → `(blank)` |
| progress shimmer | 1 | 70 ms | 26 | `▓███████████████████░░░░` → `▓▓██████████████████░░░░` → `█▓▓█████████████████░░░░` |
| typewriter placeholder | 1 | 90 ms | 15 | `Test PR #12…█` → `Test PR #12…` → `█` |
| twinkle | 6 | 220 ms | 8 | `.` → `+` → `*` |
| sparkle | 1 | 220 ms | 5 | `*` → ` +` → `  *` |
| gate pulse | 1 | 400 ms | 3 | `◆` → `◇` |
| hazard stripes | 1 | 160 ms | 5 | ` ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱` → `  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱` → `╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱` |
| tap ripple | 1 | 260 ms | 5 | ` +` → `(+)` → `( )` |
| arrow | 1 | 300 ms | 3 | `← here` → ` ← here` → `  ← here` |
| wordmark shimmer | 36 | 70 ms | 34 | `█` in `ink` → `saffron` |
| bolt flash | 6 | 110 ms | 12 | `   /|` in `fault` → `ink` → `ink-ghost` |

```text

  spinner     running, 80 ms                        ⠋
  caret       input focus, 530 ms                   █
  stream      reply still arriving, 300 ms          ▌
  progress    shimmer runs along the filled part    ▓███████████████████░░░░
  typewriter  suggestion in an empty input          Test PR #12…█
  twinkle     aura around the idle monk             . . . . . .
  sparkle     after a recovery                      *
  pulse       approval diamond, 400 ms              ◆
  hazard      approval band stripes march            ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱  ╱╱╱           /|
  ripple      last tap on the phone                  +                                / |
  arrow       points at the problem                 ← here                           /  |_
  bolt        chaos card flashes (6 rows)                                           /__   /
  wordmark    a light sweeps the logo               █▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀               | /
                                                    █ ▀ █ █  █ █  █ █▀▄                |/
                                                    ▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀
  all motion stops with
  MONK_REDUCED_MOTION=1
```
