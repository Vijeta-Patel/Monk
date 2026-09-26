# Where borders appear

Fewer borders, each with one job: rounded for things you act on, dashed for the sandbox, fault-colored for chaos cards, double yellow for approval. Panels have no boxes.

```text
 ╭──────────────────────╮     │         ╭┄ ▣ sandbox ┄┄┄┄┄┄┄┄┄┄┄┄┄╮    ╭─ ⚡ chaos ──────────────────╮
 │                      │     │         ┆                         ┆    │                             │
 │ › input, focused     │     │ sidebar ┆ul$ ./gradlew test       ┆    │  fault card                 │
 │                      │     │         ┆                         ┆    │                             │
 ╰──────────────────────╯     │         ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯    ╰─────────────────────────────╯

 rounded: input, cards        no boxes: dashed: sandbox only           fault color: chaos card
 double ═ in yellow is reserved for the approval screen

```
