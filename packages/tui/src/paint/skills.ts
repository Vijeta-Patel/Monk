// Skills browser (ctrl+s): a bookshelf where each book's height is its win rate, a list, and the
// selected skill's SKILL.md.
import { BOOK_GROW_MS, NEW_TWINKLE, SELECTED_BOOK, SPARKLINE_MS, onceIndex, pick, spinner, type Clock } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, type Seg } from '../render/canvas.ts';
import { padEnd, padStart, truncate, wrap } from '../render/text.ts';
import type { AppState, SkillInfo } from '../state/types.ts';
import { S } from './common.ts';

const TYPE_LABEL: Record<SkillInfo['type'], string> = { recovery: 'recovery', procedure: 'procedure', tool_quirk: 'quirk' };
const SPARK = '▁▂▃▄▅▆▇█';

/** Active first (as the list shows them), then retired. */
export function orderedSkills(s: AppState): { active: SkillInfo[]; retired: SkillInfo[] } {
  const active = s.skills.filter((k) => k.status === 'active' || k.status === 'draft');
  const retired = s.skills.filter((k) => k.status === 'retired');
  return { active, retired };
}

function bar(rate: number): string {
  const halves = Math.floor(rate * 10 + 1e-9);
  return '█'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '▌' : '') + '░'.repeat(5 - Math.ceil(halves / 2));
}

/** Rows a book stands tall: rounds halves down, so 75% of 6 is 4. */
export function bookHeight(rate: number, max: number): number {
  return Math.max(1, Math.ceil(rate * max - 0.5));
}

/** Normalized to the series' own range, so small improvements still read as a climb. */
export function sparkline(points: number[]): string {
  if (points.length === 0) return '';
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  return points.map((p) => SPARK[Math.max(0, Math.min(7, Math.round(((p - lo) / span) * 7)))]).join('');
}

function paintShelf(c: Canvas, s: AppState, l: Layout, clock: Clock, top: number, maxH: number, selected: number, openedAt: number): number {
  const { active, retired } = orderedSkills(s);
  const books = [...active, ...retired];
  const base = top + maxH;
  books.forEach((k, i) => {
    const x = 4 + i * 3;
    if (x + 2 >= (l.full ? 60 : l.w - 2)) return;
    if (k.status === 'retired') {
      const hgt = bookHeight(k.winRate ?? 0, maxH);
      for (let r = 0; r < hgt; r++) c.put(x, base - 1 - r, '▒▒', S.fail);
    } else if (k.isNew) {
      // New books grow into place as they are written.
      const grow = onceIndex(clock, 9, BOOK_GROW_MS, openedAt);
      if (clock.still || grow > 0) c.put(x, base - 1, '▐▌', i === selected ? S.saffron : S.saffron);
    } else {
      const hgt = bookHeight(k.winRate ?? 0, maxH);
      for (let r = 0; r < hgt; r++) c.put(x, base - 1 - r, '██', i === selected ? S.saffron : S.skill);
    }
  });
  const shelfW = Math.min(49, Math.max(0, books.length * 3 + 1));
  c.put(3, base, '▀'.repeat(shelfW), S.muted);
  if (selected >= 0 && selected < books.length) c.put(4 + selected * 3, base + 1, pick(SELECTED_BOOK.frames, clock, SELECTED_BOOK.ms), S.saffron);
  return base;
}

function listRow(c: Canvas, l: Layout, k: SkillInfo, y: number, sel: boolean, clock: Clock): void {
  const full = l.full;
  const nameW = 27;
  const cols = full ? { type: 32, v: 42, rate: 46, ok: 57 } : { type: 34, v: 45, rate: 50, ok: 61 };
  if (sel) {
    c.paintBg(2, y, full ? 60 : l.w - 4, 1, 'bg-select');
    c.put(2, y, '›', S.saffron);
  } else if (k.isNew) {
    c.put(2, y, pick(NEW_TWINKLE.frames, clock, NEW_TWINKLE.ms), S.saffron);
  }
  c.put(4, y, truncate(k.name, nameW), k.status === 'retired' ? S.muted : S.ink);
  c.put(cols.type, y, TYPE_LABEL[k.type], S.muted);
  c.put(cols.v, y, `v${k.version}`, S.muted);
  if (k.isNew && k.winRate === null) c.put(cols.rate + 2, y, 'new', S.saffron);
  else if (k.winRate !== null) {
    c.put(cols.rate, y, padStart(`${Math.round(k.winRate * 100)}%`, 4), S.ink);
    c.put(cols.rate + 5, y, bar(k.winRate), k.status === 'retired' ? S.fail : S.skill);
  }
  const ok: Seg[] =
    k.status === 'retired'
      ? [['✗', S.fail]]
      : k.checking
        ? [[spinner(clock), S.skill]]
        : k.verified
          ? [['✓', S.ok]]
          : [['○', S.faint]];
  if (!full) ok.push([k.status === 'retired' ? ' retired' : k.checking ? ' checking' : k.verified ? ' yes' : ' not yet', S.muted]);
  c.segs(cols.ok, y, ok);
}

function paintPreview(c: Canvas, s: AppState, k: SkillInfo | undefined, x: number, y: number, w: number, h: number, clock: Clock, openedAt: number): void {
  drawBox(c, x, y, w, h, ROUNDED, { fg: 'line' }, { title: [[' SKILL.md ', S.ink]] });
  if (!k) return;
  const tx = x + 3;
  const room = w - 6;
  const p = s.skillPreviews[k.name];
  let row = y + 2;
  const put = (segs: Seg[]) => {
    if (row < y + h - 1) c.segs(tx, row, segs, x + w - 2);
    row++;
  };
  put([[truncate(k.name, room), S.inkBold]]);
  const wins = k.uses ? `wins ${k.wins} of ${Math.min(10, k.uses)}` : 'no uses yet';
  put([[`${TYPE_LABEL[k.type]} · v${k.version} · `, S.muted], ['verified ', S.muted], k.verified ? ['✓', S.ok] : ['○', S.faint], [` · ${wins}`, S.muted]]);
  row++;
  const when = p?.whenToUse ?? wrap(k.description.replace(/^Use when /i, 'use when '), room);
  for (const ln of when) put([[ln, S.ink]]);
  row++;
  (p?.steps ?? []).forEach((st, i) => {
    const lines = wrap(st, room - 3);
    lines.forEach((ln, j) => put(j === 0 ? [[`${i + 1}`, S.saffron], ['  '], [ln, S.ink]] : [['   '], [ln, S.ink]]));
  });
  if (p) {
    row++;
    put([['win rate over time', S.inkBold]]);
    const spark = sparkline(p.winHistory);
    const shown = clock.still ? spark : spark.slice(0, onceIndex(clock, spark.length + 6, SPARKLINE_MS, openedAt) + 1);
    const first = p.winHistory[0] ?? 0;
    const last = p.winHistory.at(-1) ?? 0;
    put([[padEnd(shown, spark.length), S.skill], [`  ${Math.round(first * 100)}% → ${Math.round(last * 100)}% over ${k.uses || p.winHistory.length} uses`, S.muted]]);
    row++;
    put([['learned from', S.inkBold]]);
    put([[truncate(p.learnedFrom, room), S.muted]]);
    row++;
    put([['history', S.inkBold]]);
    for (const hst of p.history) {
      const left = `${hst.sha.slice(0, 7)}  ${hst.message}`;
      put([[padEnd(truncate(left, room - 5), room - 3), S.muted], [padStart(hst.age, 3), S.faint]]);
    }
    if (p.saves) {
      row++;
      put([[p.saves, S.ok]]);
    }
  }
}

export function paintSkillsBrowser(c: Canvas, s: AppState, l: Layout, clock: Clock, pop: { selected: number; filter: string; openedAt: number; reading: boolean }): void {
  c.fill(0, l.bodyTop, l.w, l.bodyBottom - l.bodyTop + 2, { bg: 'bg' });
  const { active, retired } = orderedSkills(s);
  const filterFn = (k: SkillInfo) => !pop.filter || k.name.includes(pop.filter);
  const act = active.filter(filterFn);
  const ret = retired.filter(filterFn);
  const all = [...act, ...ret];
  const sel = Math.min(pop.selected, Math.max(0, all.length - 1));
  const selSkill = all[sel];
  c.segs(2, l.bodyTop, [['skills', S.inkBold], [' what monk has learned', S.muted]]);
  const counts = `${active.length} active · ${retired.length} retired`;
  if (l.full) c.put(41, l.bodyTop, counts, S.muted);
  else c.segsRight(l.w - 3, l.bodyTop, [[counts, S.muted]]);

  if (!l.full && pop.reading) {
    paintPreview(c, s, selSkill, 2, l.bodyTop + 1, l.w - 4, l.bodyBottom - l.bodyTop + 1, clock, pop.openedAt);
    return;
  }

  const shelfTop = l.full ? l.bodyTop + 2 : l.bodyTop + 1;
  const maxH = l.full ? 6 : 4;
  const base = paintShelf(c, s, l, clock, shelfTop, maxH, sel, pop.openedAt);
  const legend = l.full ? ['each book', 'is a skill', 'taller =', 'wins more'] : ['each book is a skill', 'taller = wins more'];
  legend.forEach((t, i) => c.put(l.full ? 53 : 56, base - legend.length + i - (l.full ? 0 : 1), t, S.faint));

  let y = base + 3;
  const cols = l.full ? { type: 32, v: 42, rate: 46, ok: 57 } : { type: 34, v: 45, rate: 50, ok: 61 };
  c.put(4, y, 'name', S.faint);
  c.put(cols.type, y, 'type', S.faint);
  c.put(cols.v, y, 'v', S.faint);
  c.put(cols.rate, y, 'win rate', S.faint);
  c.put(cols.ok, y, l.full ? 'ok?' : 'verified', S.faint);
  y++;
  // The browser uses the spare row above the input too.
  const bottom = l.bodyBottom + 1;
  const maxRows = l.full ? bottom - y + 1 - (ret.length ? ret.length + 2 : 0) : bottom - y - 1;
  const visibleActive = act.slice(0, Math.max(0, maxRows));
  visibleActive.forEach((k, i) => listRow(c, l, k, y + i, i === sel, clock));
  y += visibleActive.length;
  if (!l.full) {
    const more = act.length - visibleActive.length;
    if (more > 0) c.put(4, y, `+ ${more} more · ↓ to scroll · enter to read one`, S.faint);
  } else if (ret.length) {
    y += 1;
    c.put(2, y, 'retired · won less than half of their last 10 uses', S.faint);
    ret.forEach((k, i) => listRow(c, l, k, y + 1 + i, act.length + i === sel, clock));
  }
  if (l.full) paintPreview(c, s, selSkill, 64, l.bodyTop + 1, 55, l.bodyBottom - l.bodyTop, clock, pop.openedAt);
}
