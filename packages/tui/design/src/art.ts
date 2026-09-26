// Monk TUI ASCII art and animation frames. All characters are 1 cell wide.
// Timings in ms. Drive every animation from one ticker (25 fps) and freeze on frame 0
// when MONK_REDUCED_MOTION=1.

export const SPINNER = { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], ms: 80 };
export const CARET = { frames: ["█", " "], ms: 530 };
export const STREAM_CURSOR = { frames: ["▌", "▌", " "], ms: 300 };
export const PULSE = { frames: ["◆", "◆", "◇"], ms: 400 };
export const SPARKLE = { frames: ["*  ", " + ", "  *", " + ", "   "], ms: 220 };
export const RIPPLE = { frames: [" + ", "(+)", "( )", "   ", "   "], ms: 260 };
export const THOUGHT_DOTS = { frames: [".  ", ".. ", "...", " ..", "  .", "   "], ms: 260 };
export const TWINKLE = { frames: [".", "+", "*", "+", ".", " ", " ", " "], ms: 220, phaseMs: 380 };
export const HAZARD = { pattern: "╱╱╱  ", ms: 160 }; // shift one cell per frame, right to left

// Top-bar face per state
export const FACE = {"idle": {"frames": ["(- -)", "(- -)", "(- -)", "(o o)"], "ms": 900}, "work": {"frames": ["(o o)", "(o o)", "(o o)", "(o o)", "(- -)"], "ms": 500}, "fault": {"frames": ["(O o)", "(o O)", "(o o)", "(^ ^)", "(^ ^)"], "ms": 450}, "gate": {"frames": ["(o o)", "(o o)", "(- -)"], "ms": 700}, "phone": {"frames": ["(o o)", "(o o)", "(- -)"], "ms": 600}};

// Mascot body (11 x 5). Shadow "~~~~~~~~~~~" under it in ink-ghost.
export const MONK_BODY = {"calm": ["    ___    ", "   (- -)   ", "  __) (__  ", " /  \\_/  \\ ", "(____|____)"], "work": ["    ___    ", "   (o o)   ", "  __) (__  ", " /  \\_/  \\ ", "(____|____)"], "shock": ["    ___    ", "   (O o)   ", "  __) (__  ", " /  \\_/  \\ ", "(____|____)"], "shock2": ["    ___    ", "   (o O)   ", "  __) (__  ", " /  \\_/  \\ ", "(____|____)"], "happy": ["    ___    ", "   (^ ^)   ", "  __) (__  ", " /  \\_/  \\ ", "(____|____)"]};
// idle: body floats up one row and back, 700 ms per frame, offsets [1,1,0,0]; shadow shrinks when up
// fault: faces shock, shock2, shock, shock2, work, work, happy x3 at 420 ms; sparks in fault, then "* + *" in ok
export const MONK_FAULT_SEQUENCE = ["shock", "shock2", "shock", "shock2", "work", "work", "happy", "happy", "happy"];
export const MONK_SPARKS = ["\\ | /", " \\|/ ", "\\ | /", " \\|/ ", "     ", "     ", "* + *", "+ * +", "* + *"];

// Wordmark (3 rows). Shimmer: a 2-column band of `ink` sweeps across `saffron`, 70 ms per step, gap of 14 steps.
export const WORDMARK = ["█▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀", "█ ▀ █ █  █ █  █ █▀▄ ", "▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀"];

// Chaos bolt (6 rows). Color cycle at 110 ms: ["fault", "fault", "fault", "fault", "ink", "fault", "ink", "fault", "fault", "ink-ghost", "ink-ghost", "fault"]
export const BOLT = ["   /|  ", "  / |  ", " /  |_ ", "/__   /", "   | / ", "   |/  "];

// Sandbox crate with steam " ~ " / "~ ~" above it at 350 ms
export const CRATE = ["   +-------+", "  /       /|", " +-------+ |", " | ▣ box | +", " |       |/ ", " +-------+  "];

// Approval sign, alternates every 4 frames at 700 ms
export const APPROVAL_SIGN = [[" .-------------. ", " |  need your  | ", " |     ok!     | ", " '------.------' "], [" .-------------. ", " | this one's  | ", " |   forever   | ", " '------.------' "]];
