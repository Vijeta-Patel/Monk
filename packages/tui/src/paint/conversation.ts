// The conversation column: messages, steps, chaos cards, the sandbox well and diagrams.
import {
  ARROW,
  BOLT,
  BOLT_COLORS,
  BOLT_MS,
  CRATE,
  SPARKLE,
  STEAM,
  pick,
  shimmerBar,
  spinner,
  streamCursor,
  type Clock,
} from '../anim/frames.ts';
import { replyWrapWidth, type Layout } from '../layout.ts';
import { Canvas, DASHED, ROUNDED, drawBox, type Seg, type Style } from '../render/canvas.ts';
import { fmtClock, fmtSeconds, truncate, width, wrap } from '../render/text.ts';
import type { AppState, CardItem, DiagramItem, Item, MonkItem, NoteItem, SandboxRun, StepItem } from '../state/types.ts';
import { S } from './common.ts';

type Group = 'text' | 'steps';
type Block = { h: number; group: Group; draw: (c: Canvas, y: number) => void };

type Ctx = { s: AppState; l: Layout; clock: Clock; x: number; w: number };

function glyphFor(st: StepItem, clock: Clock): Seg {
  switch (st.state) {
    case 'running':
      return [spinner(clock), S.saffron];
    case 'done':
      return ['✓', S.ok];
    case 'failed':
      return ['✗', S.fail];
    case 'fault':
      return ['⚡', S.fault];
  }
}

function stepBlock(ctx: Ctx, st: StepItem): Block[] {
  const { x, w, clock } = ctx;
  const blocks: Block[] = [];
  const ownerRight = x + w - 8;
  const durRight = x + w - 1;
  const wellOpen = ctx.s.ui.wellOpen === st.id && st.run !== null;
  blocks.push({
    h: 1,
    group: 'steps',
    draw: (c, y) => {
      const selected = ctx.s.ui.focus === 'conversation' && ctx.s.ui.selectedStep === st.id;
      if (selected) c.paintBg(x, y, w, 1, 'bg-select');
      c.segs(x, y, [glyphFor(st, clock)]);
      const ownerX = ownerRight - width(st.owner) + 1;
      const room = ownerX - 2 - (x + 3);
      const segs: Seg[] = [];
      const detailStyle: Style = st.state === 'fault' ? S.fault : st.detailTone === 'ok' ? S.ok : st.detailTone === 'muted' ? S.muted : S.muted;
      const main = st.text;
      const detail = st.detail && st.detail !== main ? ` · ${st.detail}` : '';
      const arrow = wellOpen && st.state === 'running' ? '  ▾' : '';
      const full = `${main}${detail}${arrow}`;
      if (width(full) <= room) {
        segs.push([main, S.ink]);
        if (detail) segs.push([' · ', S.faint], [st.detail ?? '', detailStyle]);
        if (arrow) segs.push([arrow, S.faint]);
      } else {
        segs.push([truncate(full, room), S.ink]);
      }
      c.segs(x + 3, y, segs);
      c.put(ownerX, y, st.owner, st.state === 'running' ? S.faint : S.faint);
      const dur =
        st.state === 'running'
          ? fmtClock(clock.now - st.startedAt)
          : fmtSeconds(Math.max(0, (st.endedAt ?? st.startedAt) - st.startedAt));
      c.segsRight(durRight, y, [[dur, st.state === 'running' ? S.saffron : S.faint]]);
    },
  });
  if (st.progress && st.state === 'running' && !wellOpen) {
    const p = st.progress;
    blocks.push({
      h: 1,
      group: 'steps',
      draw: (c, y) => {
        const filled = Math.floor((30 * p.done) / Math.max(1, p.total));
        const end = c.put(x + 3, y, shimmerBar(clock, 30, filled), S.saffron);
        c.put(end + 1, y, `${p.done}/${p.total} ${p.label}`, S.muted);
      },
    });
  }
  if (wellOpen && st.run) blocks.push(wellBlock(ctx, st, st.run));
  return blocks;
}

const WELL_LINES = 9;

function wellBlock(ctx: Ctx, st: StepItem, run: SandboxRun): Block {
  const { x, w, clock, l } = ctx;
  const wx = x + 2;
  const ww = w - 2;
  const h = WELL_LINES + (l.full ? 5 : 6);
  return {
    h,
    group: 'steps',
    draw: (c, y) => {
      c.fill(wx + 1, y + 1, ww - 2, h - 2, { bg: 'bg-sunken' });
      const title: Seg[] = [[' ', DASHED_STYLE], ['▣ sandbox', { fg: 'bg', bg: 'ink-muted', bold: true }], [`  ${run.where} `, S.muted]];
      const right: Seg[] = [[l.full ? " isolated · can't touch your machine " : ' isolated ', S.faint]];
      const bottomLeft: Seg[] = [[run.following ? ' following ' : ' paused ', S.faint]];
      const bottomRight: Seg[] = [[' ↑↓ scroll · ctrl+o fold ', S.faint]];
      drawBox(c, wx, y, ww, h, DASHED, DASHED_STYLE, { title, right, bottomLeft, bottomRight });
      const lines = run.lines.slice(Math.max(0, run.lines.length - WELL_LINES - run.scroll), run.lines.length - run.scroll);
      const textW = ww - 6 - 18;
      lines.forEach((ln, i) => {
        const style = ln.tone === 'ok' ? S.ok : ln.tone === 'fail' ? S.fail : ln.tone === 'cmd' ? S.ink : ln.tone === 'ink' ? S.ink : S.muted;
        const text = ln.tone === 'ok' && !ln.text.startsWith('✓') ? `✓ ${ln.text}` : ln.tone === 'fail' && !ln.text.startsWith('✗') ? `✗ ${ln.text} FAILED` : ln.text;
        if (text.startsWith('✓ ') || text.startsWith('✗ ')) {
          c.put(wx + 3, y + 1 + i, text.slice(0, 1), style);
          c.put(wx + 5, y + 1 + i, truncate(text.slice(2), textW - 2), ln.tone === 'fail' ? S.fail : S.ink);
        } else {
          c.put(wx + 3, y + 1 + i, truncate(text, textW), style);
        }
      });
      // The crate with steam while the command runs.
      const cx = wx + ww - 18;
      if (!run.exited) c.put(cx + 5, y + 1, pick(STEAM.frames, clock, STEAM.ms), S.faint);
      CRATE.forEach((row, i) => c.put(cx + 1, y + 2 + i, row, S.muted));
      const total = run.testsTotal ?? 0;
      if (total > 0) {
        const ticks = '✓'.repeat(Math.min(total, run.testsPassed)) + '✗'.repeat(Math.min(run.testsFailed, total)) + '·'.repeat(Math.max(0, total - run.testsPassed - run.testsFailed));
        const tickRow = y + WELL_LINES + 2;
        const end = c.put(wx + 3, tickRow, ticks.slice(0, run.testsPassed), S.ok);
        const end2 = c.put(end, tickRow, ticks.slice(run.testsPassed, run.testsPassed + run.testsFailed), S.fail);
        const end3 = c.put(end2, tickRow, ticks.slice(run.testsPassed + run.testsFailed), S.ghost);
        c.put(end3 + 2, tickRow, `${run.testsPassed}/${total}`, S.ink);
      }
      const statsRow = y + WELL_LINES + 3;
      const elapsed = fmtClock((st.endedAt ?? clock.now) - st.startedAt);
      if (run.exited) {
        c.segs(wx + 3, statsRow, run.exitCode === 0 ? [['✓', S.ok], [`  exited 0 · ${elapsed}`, S.muted]] : [['✗', S.fail], [`  exited ${run.exitCode ?? '?'} · ${elapsed}`, S.fail]]);
      } else {
        c.segs(wx + 3, statsRow, [[spinner(clock), S.saffron], [`  ${run.cpu || '2 cpu · 4 GB'} · ${elapsed}`, S.muted]]);
      }
    },
  };
}

const DASHED_STYLE: Style = { fg: 'line' };

function userBlock(ctx: Ctx, text: string): Block {
  const lines = wrap(text, ctx.w - 5);
  return {
    h: lines.length,
    group: 'text',
    draw: (c, y) => {
      lines.forEach((ln, i) => {
        c.paintBg(ctx.x, y + i, ctx.w, 1, 'bg-raised');
        if (i === 0) c.put(ctx.x + 1, y, '›', S.saffron);
        c.put(ctx.x + 3, y + i, ln, S.ink);
      });
    },
  };
}

function monkBlock(ctx: Ctx, m: MonkItem): Block {
  const lines = wrap(m.text.trim(), replyWrapWidth(ctx.l));
  return {
    h: lines.length,
    group: 'text',
    draw: (c, y) => {
      c.put(ctx.x, y, '•', S.saffron);
      lines.forEach((ln, i) => {
        const end = c.put(ctx.x + 2, y + i, ln, S.ink);
        if (m.streaming && i === lines.length - 1) c.put(end, y + i, streamCursor(ctx.clock), S.saffron);
      });
    },
  };
}

function noteBlock(ctx: Ctx, n: NoteItem): Block {
  const style = n.tone === 'ok' ? S.ok : n.tone === 'fail' ? S.fail : n.tone === 'gate' ? S.gate : n.tone === 'muted' ? S.muted : S.faint;
  return { h: 1, group: 'text', draw: (c, y) => c.segs(ctx.x, y, [[n.glyph, style], [`  ${truncate(n.text, ctx.w - 4)}`, n.tone === 'fail' ? S.fail : S.muted]]) };
}

function cardBlock(ctx: Ctx, card: CardItem): Block {
  const { x, w, l, clock } = ctx;
  const full = l.full;
  const h = full ? 8 : 7;
  return {
    h,
    group: 'steps',
    draw: (c, y) => {
      drawBox(c, x, y, w, h, ROUNDED, S.fault, {
        title: [[' ⚡ chaos ', S.fault]],
        right: [[` ${card.faultId} · seed ${card.seed} `, S.faint]],
      });
      const tx = full ? x + 13 : x + 3;
      const room = x + w - 2 - tx;
      if (full) {
        const failed = card.outcome === 'failed';
        const color = failed ? 'fault' : pick(BOLT_COLORS, clock, BOLT_MS);
        BOLT.forEach((row, i) => c.put(x + 3, y + 1 + i, row, { fg: color }));
      }
      c.put(tx, y + 1, truncate(card.title, room), S.inkBold);
      const [type, ...rest] = card.saw.split(' · ');
      c.segs(tx, y + 2, [[type ?? card.faultType, S.fault], ...(rest.length ? ([[' · ', S.faint], [truncate(rest.join(' · '), room - width(type ?? '') - 3), S.muted]] as Seg[]) : [])]);
      if (card.skill) c.segs(tx, y + 3, [['↳', S.skill], [' used skill ', S.muted], [truncate(card.skill, room - 13), S.skill]]);
      const steps: Seg[] = [];
      card.steps.forEach((st, i) => {
        if (i > 0) steps.push(['  ›  ', S.faint]);
        steps.push([`${i + 1} `, S.saffron], [st, S.muted]);
      });
      const stepsText = steps.map(([t]) => t).join('');
      if (width(stepsText) <= room) c.segs(tx, y + (card.skill ? 4 : 3), steps);
      else c.put(tx, y + (card.skill ? 4 : 3), truncate(stepsText, room), S.muted);
      const oy = y + (card.skill ? 5 : 4);
      if (card.outcome === 'recovered') {
        const text = `✓ recovered in ${card.steps.length} step${card.steps.length === 1 ? '' : 's'}${card.ms !== null ? ` · ${fmtSeconds(card.ms)}` : ''}`;
        const end = c.segs(tx, oy, [['✓', S.ok], [text.slice(1), S.ok]]);
        c.put(end + 1, oy, pick(SPARKLE.frames, clock, SPARKLE.ms, card.doneAt ?? 0), S.ok);
      } else if (card.outcome === 'failed') {
        c.segs(tx, oy, [['✗', S.fail], [` gave up after ${card.steps.length || 3} tries`, S.fail]]);
      } else {
        c.segs(tx, oy, [[spinner(clock), S.saffron], [' recovering…', S.muted]]);
      }
    },
  };
}

function diagramBlock(ctx: Ctx, d: DiagramItem): Block {
  const { x, clock } = ctx;
  const data = d.data;
  return {
    h: 4,
    group: 'text',
    draw: (c, y) => {
      const bx = x + 4;
      const bw = 50;
      const button = `[ ${data.button} ]`;
      const top = `┌─ ${data.label} ${'─'.repeat(Math.max(1, bw - 7 - width(data.label) - width(button)))}${button} ─┐`;
      c.put(bx, y, top, S.muted);
      c.put(bx + width(top) - width(button) - 3, y, button, S.saffronBold);
      c.put(bx + bw + 2, y, `y ${data.topY}`, S.faint);
      c.put(bx, y + 1, '│', S.muted);
      c.put(bx + 3, y + 1, data.text, S.ink);
      c.put(bx + bw - 1, y + 1, '│', S.muted);
      const bar = `════╪══ nav bar · y ${data.barY} `;
      const line = `${bar}${'═'.repeat(Math.max(0, bw + 7 - width(bar) - 4))}`;
      c.put(x, y + 2, line, S.fail);
      c.put(bx + bw - 1, y + 2, '╪', S.fail);
      c.put(bx + bw, y + 2, '════', S.fail);
      const shift = pick([0, 1, 2], clock, ARROW.ms);
      c.put(bx + bw + 6 + shift, y + 2, `← ${data.hiddenPx} px hidden`, S.fail);
      c.put(bx, y + 3, `└${'─'.repeat(bw - 2)}┘`, S.muted);
      c.put(bx + bw + 2, y + 3, `y ${data.bottomY}`, S.faint);
    },
  };
}

function blocksFor(ctx: Ctx, items: readonly Item[]): Block[] {
  const out: Block[] = [];
  for (const it of items) {
    switch (it.kind) {
      case 'user':
        out.push(userBlock(ctx, it.text));
        break;
      case 'monk':
        if (it.text.trim()) out.push(monkBlock(ctx, it));
        break;
      case 'step':
        if (!it.folded) out.push(...stepBlock(ctx, it));
        break;
      case 'skill':
        out.push({
          h: 1,
          group: 'steps',
          draw: (c, y) => {
            const segs: Seg[] = [['↳', S.skill], [' used skill ', S.muted], [it.name, S.skill]];
            if (it.detail) segs.push([' · ', S.faint], [it.detail, S.muted]);
            const text = segs.map(([t]) => t).join('');
            const room = ctx.w - 4;
            if (width(text) <= room) c.segs(ctx.x + 3, y, segs);
            else c.segs(ctx.x + 3, y, [['↳', S.skill], [truncate(text.slice(1), room - 1), S.muted]]);
          },
        });
        break;
      case 'card':
        out.push(cardBlock(ctx, it));
        break;
      case 'note':
        out.push(noteBlock(ctx, it));
        break;
      case 'milestone':
        out.push({ h: 1, group: 'text', draw: (c, y) => c.put(ctx.x, y, truncate(`↑ earlier: ${it.text}`, ctx.w), S.faint) });
        break;
      case 'diagram':
        out.push(diagramBlock(ctx, it));
        break;
    }
  }
  return out;
}

/** Lays blocks out top-down with one blank row between groups. */
function layOut(ctx: Ctx): { blocks: Block[]; ys: number[]; total: number } {
  const items = ctx.s.items;
  // A milestone summarizes everything before it ("↑ earlier: …"), so older items stay hidden.
  const cut = items.findLastIndex((it) => it.kind === 'milestone');
  const blocks = blocksFor(ctx, cut >= 0 ? items.slice(cut) : items);
  const ys: number[] = [];
  let y = 1; // leading blank row
  let prev: Group | null = null;
  for (const b of blocks) {
    if (prev !== null && (b.group !== prev || b.group === 'text')) y += 1;
    ys.push(y);
    y += b.h;
    prev = b.group;
  }
  return { blocks, ys, total: y };
}

export type ConvView = {
  /** First screen row and how many rows the conversation gets. */
  top: number;
  avail: number;
  /** Rows the whole conversation takes. */
  total: number;
  /** Rows below the view, after new content and clamping; 0 is following. */
  up: number;
  /** The most `up` can be: the oldest row at the top of the view. */
  max: number;
  /** Rows that arrived below the view since following stopped. */
  fresh: number;
};

function viewOf(s: AppState, l: Layout, top: number, total: number): ConvView {
  const avail = Math.max(0, l.bodyBottom - top + 1);
  const max = Math.max(0, total - avail);
  const sc = s.ui.scroll;
  // Rows added since the view was placed push it along, so reading history isn't yanked down.
  const up = sc.up > 0 ? Math.min(max, Math.max(0, sc.up + total - sc.base)) : 0;
  const fresh = up > 0 ? Math.min(up, Math.max(0, total - sc.from)) : 0;
  return { top, avail, total, up, max, fresh };
}

/** Where the conversation sits on screen for this state, without drawing it. */
export function conversationView(s: AppState, l: Layout, clock: Clock, top = l.bodyTop): ConvView {
  return viewOf(s, l, top, layOut({ s, l, clock, x: l.convX, w: l.convW }).total);
}

/** Shows the tail when it overflows, or wherever `ui.scroll` holds the view. */
export function paintConversation(c: Canvas, s: AppState, l: Layout, clock: Clock, opts: { top?: number } = {}): void {
  const ctx: Ctx = { s, l, clock, x: l.convX, w: l.convW };
  const { blocks, ys, total } = layOut(ctx);
  const v = viewOf(s, l, opts.top ?? l.bodyTop, total);
  if (blocks.length === 0 || v.avail <= 0) return;
  const rows = Math.min(v.avail, total);
  const skip = Math.max(0, total - v.avail - v.up);
  // Only blocks in view are drawn; the canvas clips the ones its edges cut through.
  const tmp = new Canvas(l.convX + l.convW, rows);
  blocks.forEach((b, i) => {
    const y = ys[i]! - skip;
    if (y + b.h > 0 && y < rows) b.draw(tmp, y);
  });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < tmp.w; col++) {
      const cell = tmp.cell(col, row);
      c.put(col, v.top + row, cell.ch === '' ? '' : cell.ch, { ...(cell.fg ? { fg: cell.fg } : {}), ...(cell.bg ? { bg: cell.bg } : {}), bold: cell.bold, underline: cell.underline });
    }
  }
  if (v.up > 0) paintScrollHint(c, l, v);
}

/** `↓ 3 new · end to follow`, right-aligned in the blank row under the conversation while scrolled back. */
function paintScrollHint(c: Canvas, l: Layout, v: ConvView): void {
  const what: Seg = v.fresh > 0 ? [`${v.fresh} new`, S.muted] : [`${v.up} more`, S.faint];
  c.segsRight(l.convX + l.convW - 1, l.bodyBottom + 1, [['↓ ', S.faint], what, [' · ', S.faint], ['end', S.muted], [' to follow', S.faint]]);
}
