// The one loud screen: full-screen double yellow frame, hazard band, the monk with its sign.
import { APPROVAL_SIGN, ARM_MS, PULSE, SIGN_MS, hazard, pick, type Clock } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, DOUBLE, ROUNDED, drawBox, type Seg } from '../render/canvas.ts';
import { truncate, width } from '../render/text.ts';
import type { ApprovalState } from '../state/types.ts';
import { S, drawMascot } from './common.ts';

export function isArmed(a: ApprovalState, now: number): boolean {
  return now - a.openedAt >= ARM_MS;
}

function irreversibleReason(a: ApprovalState): { long: string; short: string; verb: string } {
  const names = a.calls.map((c) => c.name.toLowerCase());
  const parts: string[] = [];
  if (names.some((n) => n.includes('merge'))) parts.push('a merge needs a revert PR');
  if (names.some((n) => n.includes('release') || n.includes('publish'))) parts.push('release emails stay sent');
  if (names.some((n) => n.includes('delete') || n.includes('remove'))) parts.push("deleted things don't come back");
  if (names.some((n) => n.includes('uninstall'))) parts.push('the app data goes with it');
  if (parts.length === 0) parts.push("there's no undo button for it");
  const ships = names.some((n) => /merge|release|publish/.test(n));
  return {
    long: `This can't be undone: ${parts.join(', and ')}.`,
    short: "this can't be undone",
    verb: ships ? 'Before I ship this, I need your ok.' : 'Before I do this, I need your ok.',
  };
}

const BUTTONS: { key: string; label: string; tone: 'ok' | 'fail' | 'line'; full: number; narrow: number }[] = [
  { key: 'y', label: 'yes, ship it', tone: 'ok', full: 24, narrow: 22 },
  { key: 'n', label: 'not now', tone: 'fail', full: 20, narrow: 18 },
  { key: 'e', label: 'edit first', tone: 'line', full: 22, narrow: 20 },
];

function buttons(c: Canvas, x: number, y: number, full: boolean, armed: boolean): void {
  let bx = x;
  for (const b of BUTTONS) {
    const w = full ? b.full : b.narrow;
    drawBox(c, bx, y, w, 3, ROUNDED, { fg: armed ? b.tone : 'line' });
    c.put(bx + 3, y + 1, b.key, armed ? { fg: b.tone, bold: true } : S.faint);
    c.put(bx + 6, y + 1, b.label, armed ? S.ink : S.muted);
    bx += w + 3;
  }
}

function armLine(a: ApprovalState, clock: Clock, dots: boolean): Seg {
  if (clock.still || !isArmed(a, clock.now)) {
    const n = clock.still ? 1 : Math.min(3, 1 + Math.floor(((clock.now - a.openedAt) / ARM_MS) * 3));
    return [`keys wake up in 0.6s${dots ? '...' : '.'.repeat(n).padEnd(3)}`, S.faint];
  }
  return ['✓ keys are live', S.ok];
}

export function paintApproval(c: Canvas, a: ApprovalState, l: Layout, clock: Clock): void {
  const w = l.w;
  const h = l.h;
  c.fill(0, 1, w, h - 1, { bg: 'bg' });
  drawBox(c, 0, 1, w, h - 1, DOUBLE, S.gate);
  // Band.
  c.fill(1, 2, w - 2, 1, { bg: 'gate-fill' });
  c.put(3, 2, pick(PULSE.frames, clock, PULSE.ms), { fg: 'on-gate', bg: 'gate-fill', bold: true });
  c.put(5, 2, "HOLD ON · I need your ok · this can't be undone", { fg: 'on-gate', bg: 'gate-fill', bold: true });
  const stripeW = l.full ? 22 : 12;
  c.put(w - 2 - stripeW, 2, hazard(clock, stripeW), { fg: 'on-gate', bg: 'gate-fill' });

  const why = irreversibleReason(a);
  const armed = !clock.still && isArmed(a, clock.now);
  if (l.full) {
    const x = 32;
    const room = w - 2 - x - 2;
    // The monk holding its sign.
    const sign = APPROVAL_SIGN[Math.floor((clock.still ? 0 : clock.now) / (SIGN_MS * 4)) % 2]!;
    sign.forEach((row, i) => c.put(5, 5 + i, row, i === 1 || i === 2 ? S.gateBold : S.gate));
    for (let r = 9; r <= 12; r++) c.put(13, r, '|', S.gate);
    drawMascot(c, 14, 10, 'gate', clock, null);

    c.put(x, 4, why.verb, S.inkBold);
    c.segs(x, 5, [['✗', S.fail], [` ${truncate(why.long, room - 2)}`, S.fail]]);
    let y = 7;
    a.actions.forEach((act, i) => {
      c.put(x, y, String(i + 1), S.gateBold);
      c.put(x + 3, y, truncate(act.title, room - 3), S.inkBold);
      act.details.forEach((d, j) => c.put(x + 3, y + 1 + j, truncate(d, room - 3), S.muted));
      y += 2 + act.details.length;
    });
    y = Math.max(y, 15);
    c.put(x, y, "why it's safe", S.inkBold);
    a.evidence.slice(0, 4).forEach((e, i) => {
      const ex = x + (i % 2) * 42;
      const ey = y + 1 + Math.floor(i / 2);
      c.segs(ex, ey, [['✓', S.ok], [` ${truncate(e, 38)}`, S.ink]]);
    });
    y += 1 + Math.ceil(Math.min(4, a.evidence.length) / 2) + 1;
    if (a.alsoOn) c.put(x, y, `also asked on ${a.alsoOn} · whoever answers first wins`, S.muted);
    y += 2;
    buttons(c, x, y, true, armed);
    y += 4;
    if (a.stage === 'reason') {
      c.segs(x, y, [['›', S.saffron], [' why not? ', S.muted], [a.reason, S.ink], ['█', S.saffron], ['   enter send · esc skip', S.faint]]);
    } else {
      c.segs(x, y, [armLine(a, clock, false), ['   '], ["esc won't close this, pick one", S.faint]]);
    }
    y += 3;
    c.put(x, y, 'exact calls', S.inkBold);
    a.actions.forEach((act, i) => {
      c.fill(x, y + 1 + i, room + 2, 1, { bg: 'bg-sunken' });
      c.put(x + 1, y + 1 + i, truncate(act.call, room), { fg: 'ink-muted', bg: 'bg-sunken' });
    });
    y += 2 + a.actions.length;
    c.put(x, y, `d full diff  ·  ${a.actions.map((_, i) => i + 1).join(' / ')} look at one call  ·  n lets you say why`, S.faint);
    return;
  }

  const x = 3;
  const room = w - 2 - x - 2;
  c.put(x, 4, why.verb, S.inkBold);
  c.segs(x, 5, [['✗', S.fail], [` ${why.short}`, S.fail]]);
  let y = 7;
  a.actions.forEach((act, i) => {
    c.put(x, y, String(i + 1), S.gateBold);
    c.put(x + 2, y, truncate(act.title, room - 2), S.inkBold);
    c.put(x + 2, y + 1, truncate(act.compact, room - 2), S.muted);
    y += 2;
  });
  y += 1;
  c.put(x, y, "why it's safe", S.inkBold);
  const ev: Seg[] = [];
  a.evidenceShort.slice(0, 4).forEach((e, i) => {
    if (i > 0) ev.push(['   ']);
    ev.push(['✓', S.ok], [` ${e}`, S.ink]);
  });
  c.segs(x, y + 1, ev, w - 3);
  y += 3;
  if (a.alsoOn) c.put(x, y, `also asked on ${a.alsoOn} · first answer wins`, S.muted);
  y += 2;
  buttons(c, x, y, false, armed);
  y += 4;
  if (a.stage === 'reason') c.segs(x, y, [['›', S.saffron], [' why not? ', S.muted], [a.reason, S.ink], ['█', S.saffron]], w - 3);
  else c.segs(x, y, [armLine(a, clock, true), ['   '], ['a exact calls · d diff', S.faint]]);
}
