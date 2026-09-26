# Monk TUI design system

Monk's terminal UI should feel like a calm little companion that happens to be very good at breaking and fixing things. It's quiet when nothing is happening, playful while it works, and loud exactly once: when it needs your ok for something that can't be undone. It's all monospace cells, built with OpenTUI (`@opentui/react` on Bun), sized for 120×36 and 80×24, and readable from the back of a room.

## Feel

- **Friendly first.** Plain words, not tool names: "GitHub said slow down · rate_limit", not `github.get_pr_files 429`. Tool names and raw arguments live one `ctrl+o` away.
- **Clean.** Almost no boxes. The conversation and sidebar are separated by one faint rule. Borders are kept for things you act on (the input, cards, popups) and for the three special places: chaos cards, the sandbox, the approval screen.
- **Alive.** Monk (the little figure) breathes, thinks, gets startled and relaxes. Spinners spin, progress shimmers, the logo catches the light. Motion always means something is happening; when nothing is, only the monk breathes.
- **Loud once.** The approval screen is the only place with a filled yellow band, a double border, marching hazard stripes and a raised sign. That rarity is what makes it impossible to miss.
- **Meaning is never color alone.** Every state is a glyph plus a word: `✓ recovered`, `⚡ popup`, `◆ needs you`.

## Voice

- Monk talks like a teammate: "On it.", "Found the bug.", "Before I ship this, I need your ok."
- Short lines, numbers with units (`12.6s`, `4.2 MB`, `31/38`).
- Exact where it matters: repo, PR, SHA, tag and file hash appear in full on the approval screen.
- Lowercase labels (`plan`, `chaos`, `skills`), no exclamation marks except the monk's sign, no emoji.

## The monk

A 17×7 ASCII figure (see the Mascot card). One mood per state:

- `calm` (idle): eyes closed `(- -)`, floats up and down one row every 1.4 s, a twinkling aura.
- `work` / `look`: eyes open `(o o)`, blinks, thought dots `...` above the head.
- `fault`: `(O o)` with `\ | /` sparks in the fault color, then `(o o)`, then `(^ ^)` with green sparkles once recovered.
- `hold` (approval): stands next to a sign on a pole that alternates "need your ok!" and "this one's forever".

The top bar carries a 5-cell face (`(- -)`, `(o o)`, `(O o)`, `(^ ^)`) so the mood is visible at 80×24 too.

## Layout

- **Top bar** (row 1): face, `monk`, model, `chaos moderate` in the fault color, generation, cost; on the right `⚡n ✓n` and what monk is doing with a spinner and a timer. A faint rule under it.
- **120×36:** conversation on the left (78 cols), one faint `│` rule at column 83, sidebar on the right (33 cols): the monk, a one-line caption, then `plan`, `chaos`, `skills` as plain lists with bold lowercase headings.
- **Input:** a rounded box across the full width, saffron when focused. **Hints:** one faint row of `key label` pairs.
- **80×24:** no sidebar. The face in the top bar carries the mood; `ctrl+l` slides the sidebar over the right half. The phone becomes a one-line strip.

## Color

Same tokens as before: dark first, light mirrors every one, all text at least 4.5:1. `saffron` is Monk and "happening now" (face, spinner, caret, progress, the `•` before monk's messages). `fault` is chaos, `skill` is learning, `gate` (yellow) is only for approvals, `ok` and `fail` are outcomes. `ink-ghost` draws the rules and the monk's shadow.

## Motion

See the Motion card for each one live. Rules:

- One global ticker at 25 fps; each animation is a list of frames plus an interval. Renders never wait on the network.
- Only the monk, the logo shimmer and the idle typewriter move when nothing is happening. Everything else moves only while work is in flight.
- No flashing faster than 3 times a second (the chaos bolt flashes at most twice per 1.3 s cycle).
- `MONK_REDUCED_MOTION=1`, or the terminal reporting reduced motion, freezes every animation on its first frame and swaps the spinner for `●`.
- Projector mode keeps motion but raises the font weight to 500.

## Symbols

`✓ ✗ ⠹ ○ ◆ ⚡ ↳ ✦ • › ▣`. `⚡` is 2 cells wide, so the glyph column is 2 cells. Measure strings with `string-width`, never `.length`. Animations only use 1-cell characters.

## Borders

- Rounded `╭╮╰╯`: the input, the try card, popups, the skill preview, chaos cards (in the fault color).
- Dashed rounded `╭┄╮┆` on `bg-sunken` with an inverse `▣ sandbox` chip: anything that ran in the Daytona sandbox.
- Double `╔═╗║` in yellow: the approval screen, nowhere else.
- Panels have no boxes; one faint vertical rule separates the sidebar.

## Keys

`enter` send · `esc` stop · `/` commands · `ctrl+p` everything · `tab` move around · `ctrl+o` details · `ctrl+l` sidebar · `ctrl+k` chaos · `ctrl+s` skills · `?` help. Popups trap focus; only the approval screen ignores `esc`.
