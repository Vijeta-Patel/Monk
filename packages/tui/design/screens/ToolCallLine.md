# Columns of a step line

Column anatomy of a step line in the conversation (78 columns at 120×36, 76 at 80×24).

- Text truncates with `…`; details (tool name, arguments, raw result) open with `ctrl+o`.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| spinner | 1 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |

```text
  0         1         2         3         4         5         6         7
  012345678901234567890123456789012345678901234567890123456789012345678901234567
  ✓  read PR #12 · 6 files changed                               operator   0.8s
  ⚡ GitHub said slow down · rate_limit                          operator   0.3s
     ↳ used skill github-rate-limit-recovery · waited 12s
  ⠋  running unit tests in the sandbox                              coder  00:21

    0  glyph, 2 cells (⚡ is wide)
    3  what happened, in plain words; fault type after ·
    5  ↳ skill lines indent under the text
  -18  owner, right-aligned, faint
   -1  duration; saffron + ticking while running
```
