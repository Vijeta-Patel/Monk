// The "monk asks" card: an open ask_user_question, just above the input. ↑↓ and enter or an
// option's number pick one; typing answers in your own words.
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, segsWidth, type Seg } from '../render/canvas.ts';
import { truncate, wrap } from '../render/text.ts';
import type { AppState, QuestionCall, QuestionState } from '../state/types.ts';
import { S } from './common.ts';

const RECOMMENDED = /\s*\(recommended\)/i;

/** The call on screen: a batch is asked one question at a time. */
export function currentCall(q: QuestionState): QuestionCall | undefined {
  return q.calls[q.answered.length] ?? q.calls.at(-1);
}

/** "Other" means "let me type it", so picking it waits for the typed answer. */
export function isOther(option: string): boolean {
  return /^other\b/i.test(option.replace(RECOMMENDED, '').trim());
}

type Card = { x: number; y: number; w: number; h: number; lines: string[]; options: string[]; first: number; shown: number; gap: number };

/** Where the card goes and what fits: it keeps at least three conversation rows above it. */
function cardFor(s: AppState, l: Layout): Card | null {
  const q = s.question;
  const call = q ? currentCall(q) : undefined;
  if (!q || !call) return null;
  const x = l.convX;
  const w = l.convW;
  const maxH = Math.max(3, l.bodyBottom - l.bodyTop + 1 - 4);
  const options = call.options.map((o) => o.replace(/\s+/g, ' ').trim());
  const n = options.length;
  const gap = n > 0 ? 1 : 0;
  const shown = n > 0 ? Math.max(1, Math.min(n, maxH - 3 - gap)) : 0;
  const room = w - 6;
  let lines = wrap(call.question.trim() || 'monk has a question', room);
  const most = Math.max(1, maxH - 2 - gap - shown);
  if (lines.length > most) lines = [...lines.slice(0, most - 1), truncate(lines.slice(most - 1).join(' '), room)];
  const first = Math.max(0, Math.min(q.selected - shown + 1, n - shown));
  const h = 2 + lines.length + gap + shown;
  return { x, y: l.bodyBottom - h + 1, w, h, lines, options, first, shown, gap };
}

/** Rows the card takes above the input, 0 with no question open. */
export function questionHeight(s: AppState, l: Layout): number {
  return cardFor(s, l)?.h ?? 0;
}

/** `↑↓ choose · 1–3 pick · enter answer · or type your own`, shortened until it fits the border. */
function keyLine(n: number, room: number): Seg[] {
  const sep: Seg = [' · ', S.faint];
  const choices: Seg[][] =
    n === 0
      ? [[['type your answer', S.faint], sep, ['enter', S.muted], [' to send', S.faint]], [['enter', S.muted], [' to send', S.faint]]]
      : [
          [['↑↓', S.muted], [' choose', S.faint], sep, [n > 1 ? `1–${n}` : '1', S.muted], [' pick', S.faint], sep, ['enter', S.muted], [' answer', S.faint], sep, ['or type your own', S.faint]],
          [['↑↓', S.muted], [' choose', S.faint], sep, [n > 1 ? `1–${n}` : '1', S.muted], [' pick', S.faint], sep, ['enter', S.muted], [' answer', S.faint]],
          [[n > 1 ? `1–${n}` : '1', S.muted], [' pick', S.faint], sep, ['enter', S.muted], [' answer', S.faint]],
        ];
  for (const segs of choices) {
    const line: Seg[] = [[' '], ...segs, [' ']];
    if (segsWidth(line) <= room) return line;
  }
  return [];
}

export function paintQuestion(c: Canvas, s: AppState, l: Layout): void {
  const card = cardFor(s, l);
  const q = s.question;
  if (!card || !q) return;
  const { x, y, w, h, options } = card;
  const n = options.length;
  const step = q.calls.length > 1 ? `${Math.min(q.answered.length + 1, q.calls.length)} of ${q.calls.length}` : '';
  c.fill(x, y, w, h, { bg: 'bg' });
  drawBox(c, x, y, w, h, ROUNDED, S.saffron, {
    title: [[' '], ['•', S.saffron], [' monk asks ', S.ink]],
    right: step ? [[` ${step} `, S.faint]] : [],
    bottomRight: keyLine(n, w - 4),
  });
  card.lines.forEach((ln, i) => c.put(x + 4, y + 1 + i, ln, S.inkBold));
  const top = y + 1 + card.lines.length + card.gap;
  const room = w - 9;
  for (let r = 0; r < card.shown; r++) {
    const i = card.first + r;
    const opt = options[i] ?? '';
    const ry = top + r;
    const sel = i === q.selected;
    if (sel) {
      c.paintBg(x + 1, ry, w - 2, 1, 'bg-select');
      c.put(x + 2, ry, '›', S.saffron);
    }
    c.put(x + 4, ry, String(i + 1), sel ? S.saffronBold : S.muted);
    // "(Recommended)" reads as a hint; faint isn't legible on bg-select, so the selected row uses muted.
    const hint = RECOMMENDED.exec(opt)?.[0]?.trim() ?? '';
    const label = hint ? opt.replace(RECOMMENDED, '').trim() : opt;
    const after: Seg[] = [];
    if (hint) after.push([` ${hint}`, sel ? S.muted : S.faint]);
    if (sel && isOther(opt) && s.ui.input.text.trim() === '') after.push(['  type it below', S.muted]);
    // A long label is cut, not the hint after it.
    c.segs(x + 7, ry, [[truncate(label, Math.max(1, room - segsWidth(after))), sel ? S.ink : S.muted], ...after], x + 7 + room);
  }
}
