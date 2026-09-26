Build the Monk terminal UI in `packages/tui` with OpenTUI (`@opentui/react` on Bun), following the design in `packages/tui/design/`.

1. Read `design/README.md`, then `design/DESIGN.md`, then every file in `design/screens/`.
2. Use `design/src/theme.ts` for all colors and `design/src/art.ts` for all ASCII art and animation frames. Never hard-code a hex value or re-draw the art.
3. Match the mockups cell for cell at 120×36 and 80×24. Measure text with `string-width` (⚡ is 2 cells). Open `design/previews/*.html` in a browser to see how things move.
4. Drive every animation from a single ticker; freeze on frame 0 when `MONK_REDUCED_MOTION=1`.
5. Keep the approval screen exactly as specified: full screen, double yellow border, keys arm after 600 ms, `esc` does not close it.
6. Start with the layout shell (top bar, conversation, sidebar, input, hints) and the idle screen with the mascot; show me a screenshot at 120×36 and 80×24 before building the other screens.

Use the OpenTUI agent skill (`npx skills add msmps/opentui-skill`) so you use its real APIs. If something in the design can't be done in OpenTUI, stop and tell me instead of improvising.
