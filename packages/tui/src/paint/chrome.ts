// Top bar, the rule under it, the input box and the hints row.
import { CARET, PULSE, face, pick, spinner, type Clock } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, segsWidth, type Seg } from '../render/canvas.ts';
import { fmtClock, fmtCost, truncate, width } from '../render/text.ts';
import type { AppState } from '../state/types.ts';
import { S, hints } from './common.ts';
import { faceMood, type Mood } from './mood.ts';

export function paintTopBar(c: Canvas, s: AppState, l: Layout, clock: Clock, mood: Mood): void {
  c.fill(0, 0, l.w, 1, { bg: 'bg-raised' });
  const st = s.status;
  const sep: Seg = l.full ? ['  ·  ', S.faint] : [' · ', S.faint];
  const left: Seg[] = [
    [face(clock, faceMood(mood), s.moodFaultAt ?? 0), S.saffronBold],
    [' '],
    ['monk', S.inkBold],
  ];
  if (l.full) left.push(sep, [st.model, S.muted]);
  left.push(sep, ['chaos ', S.muted], [st.chaosEnabled ? st.profile : 'off', S.fault]);
  left.push(sep, [`gen ${st.generation}`, S.muted], sep, [fmtCost(st.costUsd), S.muted]);
  c.segs(1, 0, left);

  const right: Seg[] = [];
  if (st.faults > 0 && l.full) right.push(['⚡', S.fault], [`${st.faults} `, S.muted], ['✓', S.ok], [`${st.recovered}`, S.muted], ['   ']);
  let rightEdge = l.w - 2;
  if (s.approval) {
    right.push([pick(PULSE.frames, clock, PULSE.ms), S.gate], [' waiting for you', S.gate]);
  } else if (s.turn.running) {
    rightEdge = l.w - 3;
    const goal = s.turn.goal ?? 'working';
    const elapsed = s.turn.startedAt === null ? 0 : clock.now - s.turn.startedAt;
    right.push([spinner(clock), S.saffron], [` ${goal}  `, S.ink], [fmtClock(elapsed), S.saffron]);
  } else {
    right.push(['ready', S.muted]);
  }
  // Never let the right side run into the left.
  const leftEnd = 1 + segsWidth(left) + 2;
  if (rightEdge - segsWidth(right) + 1 < leftEnd) {
    const text = right.map(([t]) => t).join('');
    c.put(leftEnd, 0, truncate(text, rightEdge - leftEnd + 1), S.muted);
  } else {
    c.segsRight(rightEdge, 0, right);
  }
  c.put(0, 1, '─'.repeat(l.w), S.ghost);
}

export type InputView = {
  text: string;
  cursor: number;
  focused: boolean;
  placeholder: string;
  /** Placeholder already drawn by an animation (the idle typewriter). */
  placeholderOverride?: string | null;
  right: string;
  caretSince: number;
};

export function paintInput(c: Canvas, l: Layout, v: InputView, clock: Clock): void {
  const y = l.inputTop;
  const border = v.focused ? S.saffron : { fg: 'line' as const };
  drawBox(c, 0, y, l.w, l.inputH, ROUNDED, border);
  const inner = l.w - 4;
  const rightW = width(v.right);
  const textW = inner - 2 - rightW - 2;
  const caret = v.focused ? pick(CARET.frames, clock, CARET.ms, v.caretSince) : ' ';
  c.put(2, y + 1, '›', S.saffron);
  const lines = v.text.split('\n');
  if (v.text === '') {
    if (v.placeholderOverride != null) {
      c.put(4, y + 1, truncate(v.placeholderOverride, textW), S.ink);
    } else {
      c.put(4, y + 1, caret, S.saffron);
      c.put(5, y + 1, truncate(v.placeholder, textW - 1), S.faint);
    }
  } else {
    // Show the last lines that fit; the caret sits at the end of the text being edited.
    const visible = lines.slice(-(l.inputH - 2));
    visible.forEach((line, i) => {
      const shown = width(line) > textW - 1 ? `…${line.slice(-(textW - 2))}` : line;
      const end = c.put(4, y + 1 + i, shown, S.ink);
      if (i === visible.length - 1) c.put(end, y + 1 + i, caret, S.saffron);
    });
  }
  if (rightW) c.put(l.w - 2 - rightW, y + 1, v.right, S.faint);
}

export function paintHints(c: Canvas, l: Layout, pairs: readonly (readonly [string, string])[]): void {
  hints(c, l.hintsY, pairs, l.w - 1);
}
