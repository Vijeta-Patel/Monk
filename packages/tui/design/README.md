# Monk TUI design handoff

Drop this folder into the Monk repo (suggested: `packages/tui/design/`) and point your coding agent at it.

| file | what |
| --- | --- |
| `DESIGN.md` | the rules: feel, voice, layout, color, motion, symbols, borders, keys. Read first. |
| `tokens.json` | colors (dark + light), type, cell spacing |
| `src/theme.ts` | the colors as TypeScript, plus xterm-256 fallbacks |
| `src/art.ts` | mascot, wordmark, bolt, crate, sign, spinner and every animation's frames and timing |
| `screens/*.md` | each screen: what it shows, focus, what updates live, animation table, character-accurate mockups at 120×36 and 80×24 |
| `screens/*.frames.json` | exact position, frames, colors and timing of every animated element per mockup |
| `previews/*.html` | open in a browser to see each screen animate (follows your OS light/dark setting) |
| `PROMPT.md` | a prompt to paste into Claude Code |

Screens: Main view, idle, Main view, working, Fault and recovery, Sandbox run, Phone view, Approval, Everything (ctrl+p) and slash commands, Skills browser.
