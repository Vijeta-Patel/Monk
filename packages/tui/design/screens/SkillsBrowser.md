# Skills browser

`ctrl+s` or `/skills`: a bookshelf where every skill is a book whose height is its win rate, a clean list, and the selected skill's `SKILL.md` on the right with a sparkline of how it improved.

## Layout

- Shelf: blue books are active skills, the selected one is saffron with a bobbing `▲` under it, new skills are thin saffron books that grow as they're written, retired ones are red and hatched.
- List: `name · type · v · win rate · ok?`. Win rate is a number and a 5-cell bar (1 block = 20%); new skills say `new`. `✓` verified, spinning when being checked, `✗` retired. New skills twinkle `✦`.
- Preview: name, type, version, verified, wins; when to use it; the steps; a sparkline of win rate over time that draws itself; where it was learned from; git history; what it saved.

## Focus and live

- The list has focus: `↑↓` pick, `enter` open, `/` filter, `v` check it again in the sandbox, `r` retire (asks first; it's a git commit), `g` git log, `esc` back.
- A skill being checked shows a spinner until the sandbox run finishes, then `✓` or it leaves the list.
- Win rates update at the end of each session; rows don't reorder under your selection.

## 80×24

Shorter shelf and the first 7 rows; `enter` opens the preview full-width.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| top bar face | 2 | 900 ms | 4 | `(- -)` → `(o o)` |
| new skill book growing | 20 | 260 ms | 9 | `(blank)` → `▐▌` |
| selected book | 2 | 500 ms | 3 | `▲` → `(blank)` |
| new skill twinkle | 4 | 300 ms | 4 | `✦` → `✧` |
| spinner | 2 | 80 ms | 10 | `⠋` → `⠙` → `⠹` |
| win-rate sparkline draw | 1 | 180 ms | 14 | `▁▂▃▅▆▇▇█` → `▁` → `▁▂` |

## Mockups

Character-accurate, frame 1 of every animation. ⚡ fills 2 cells. Exact animation frames and positions are in `SkillsBrowser.frames.json`.

### 120 × 36

```text
 (- -) monk  ·  deepseek-v3.2  ·  chaos moderate  ·  gen 3  ·  $0.52                                     ⚡5 ✓5   ready
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  skills what monk has learned           14 active · 2 retired
                                                                ╭─ SKILL.md ──────────────────────────────────────────╮
             ██                   ██ ██                         │                                                     │
    ██       ██ ██ ██ ██          ██ ██                         │  github-rate-limit-recovery                         │
    ██       ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██        each book  │  recovery · v2 · verified ✓ · wins 9 of 10          │
    ██       ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██    ▒▒  is a skill │                                                     │
    ██       ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ▒▒ ▒▒  taller =   │  use when a GitHub tool returns 429                 │
    ██ ▐▌ ▐▌ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ▒▒ ▒▒  wins more  │  or "rate limit exceeded"                           │
   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀            │                                                     │
    ▲                                                           │  1  read retry_after from the error;                │
                                                                │     if it is missing, wait 20s                      │
    name                        type      v   win rate   ok?    │  2  never retry more than 3 times                   │
  › github-rate-limit-recovery  recovery  v2   90% ████▌ ✓      │  3  batch the remaining reads into                  │
  ✦ android-dismiss-rating-pop… recovery  v1    new      ✓      │     one search call when you can                    │
  ✦ android-relaunch-after-cra… recovery  v1    new      ⠋      │                                                     │
    android-emulator-install    procedure v3   93% ████▌ ✓      │  win rate over time                                 │
    gradle-offline-cache        procedure v1   88% ████░ ✓      │  ▁▂▃▅▆▇▇█  40% → 90% over 10 uses                   │
    mobile-permission-grant     recovery  v1   83% ████░ ✓      │                                                     │
    github-pr-qa-report         procedure v2   80% ████░ ✓      │  learned from                                       │
    mobile-wait-for-spinner     recovery  v2   75% ███▌░ ✓      │  sessions s_812, s_847 · fault rate_limit           │
    github-partial-list-cursor  recovery  v2   71% ███▌░ ✓      │                                                     │
    auth-expired-refresh        recovery  v1   70% ███▌░ ✓      │  history                                            │
    github-search-needs-repo    quirk     v1  100% █████ ✓      │  4e1a9d0  v2 · merged in batched reads          3d  │
    sandbox-apk-handoff         procedure v1  100% █████ ✓      │  b72c310  v1 · verified, 3.1 fewer steps        6d  │
    github-schema-drift-files   recovery  v1   67% ███░░ ✓      │  19fe0a2  v1 · drafted from s_812               6d  │
    android-rotation-recoords   recovery  v1   60% ███░░ ✓      │                                                     │
                                                                │  saves 3.1 steps per rate_limit on average          │
  retired · won less than half of their last 10 uses            │                                                     │
    github-retry-immediately    recovery  v1   40% ██░░░ ✗      ╰─────────────────────────────────────────────────────╯
    popup-press-back            recovery  v2   45% ██░░░ ✗
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ›  press / to filter skills                                                                                 esc back │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ↑↓ pick   enter open   / filter   v check it again   r retire   g git log   esc back
```

### 80 × 24

```text
 (- -) monk · chaos moderate · gen 3 · $0.52                              ready
────────────────────────────────────────────────────────────────────────────────
  skills what monk has learned                           14 active · 2 retired
    ██       ██ ██                ██ ██
    ██       ██ ██ ██ ██ ██ ██ ██ ██ ██ ██              each book is a skill
    ██       ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ▒▒ ▒▒     taller = wins more
    ██ ▐▌ ▐▌ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ▒▒ ▒▒
   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    ▲

    name                          type       v    win rate   verified
  › github-rate-limit-recovery    recovery   v2    90% ████▌ ✓ yes
  ✦ android-dismiss-rating-pop…   recovery   v1     new      ✓ yes
  ✦ android-relaunch-after-cra…   recovery   v1     new      ⠋ checking
    android-emulator-install      procedure  v3    93% ████▌ ✓ yes
    gradle-offline-cache          procedure  v1    88% ████░ ✓ yes
    mobile-permission-grant       recovery   v1    83% ████░ ✓ yes
    github-pr-qa-report           procedure  v2    80% ████░ ✓ yes
    + 7 more · ↓ to scroll · enter to read one

╭──────────────────────────────────────────────────────────────────────────────╮
│ ›  press / to filter skills                                         esc back │
╰──────────────────────────────────────────────────────────────────────────────╯
  ↑↓ pick   enter read   / filter   esc back
```

