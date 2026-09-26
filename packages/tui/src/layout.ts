// Screen geometry. 120×36 is the reference: conversation 78 cols from x=2, one faint rule at
// column 83 (x=82), sidebar 33 cols from x=85. Under 120 cols the sidebar hides.

export const FULL_MIN_COLS = 120;
export const SIDEBAR_W = 33;

export type Layout = {
  w: number;
  h: number;
  /** Sidebar shown in place (>= 120 cols). */
  full: boolean;
  /** Conversation column and width. */
  convX: number;
  convW: number;
  /** Body rows [bodyTop, bodyBottom] inclusive; one blank row separates it from the input. */
  bodyTop: number;
  bodyBottom: number;
  /** Faint rule column when the sidebar is in place, else -1. */
  ruleX: number;
  sideX: number;
  sideW: number;
  /** Input box top row (3 rows by default) and the hints row. */
  inputTop: number;
  inputH: number;
  hintsY: number;
};

export function computeLayout(w: number, h: number, inputLines = 1): Layout {
  const full = w >= FULL_MIN_COLS;
  const inputH = Math.min(Math.max(1, inputLines), 6) + 2;
  const hintsY = h - 1;
  const inputTop = hintsY - inputH;
  const bodyTop = 2;
  const bodyBottom = inputTop - 2;
  if (full) {
    const convW = w - 42;
    const ruleX = convW + 4;
    return { w, h, full, convX: 2, convW, bodyTop, bodyBottom, ruleX, sideX: ruleX + 3, sideW: SIDEBAR_W, inputTop, inputH, hintsY };
  }
  // Narrow: the sidebar slides over the right half on ctrl+l.
  const sideW = Math.min(SIDEBAR_W, Math.max(20, Math.floor(w / 2) - 4));
  return { w, h, full, convX: 2, convW: w - 4, bodyTop, bodyBottom, ruleX: -1, sideX: w - sideW - 2, sideW, inputTop, inputH, hintsY };
}

/** Width monk's replies wrap at: the text starts after `• ` and keeps a 2-cell right margin. */
export function replyWrapWidth(l: Layout): number {
  return l.convW - 4;
}

/** Right edge (inclusive) of the owner column and of the duration column in a step line. */
export function stepColumns(l: Layout): { textX: number; ownerRight: number; durRight: number } {
  return { textX: l.convX + 3, ownerRight: l.convX + l.convW - 8, durRight: l.convX + l.convW - 1 };
}
