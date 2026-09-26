// The sidebar: the monk and a caption, then plan / chaos / skills as plain lists. While the Phone
// helper works it becomes the phone.
import { DRAFTING, LIVE_DOT, RIPPLE, pick, shimmerBar, spinner, type Clock } from '../anim/frames.ts';
import type { Layout } from '../layout.ts';
import { Canvas, ROUNDED, drawBox, type Seg } from '../render/canvas.ts';
import { truncate, width } from '../render/text.ts';
import { PROFILE_HELP, shortSkillName } from '../state/describe.ts';
import type { AppState, PlanStep } from '../state/types.ts';
import { S, centered, drawMascot, faultCaption, heading } from './common.ts';
import type { Mood } from './mood.ts';

const NAME_W = 22;

export const PHONE_LINGER_MS = 5000;

export function phoneShown(s: AppState, clock: Clock): boolean {
  // The phone takes over the sidebar only once there is a screen to show.
  if (s.ui.phoneHidden || s.phone.frame === null) return false;
  if (s.phone.active) return true;
  return s.phone.doneAt !== null && !clock.still && clock.now - s.phone.doneAt < PHONE_LINGER_MS;
}

function captionFor(s: AppState, mood: Mood, clock: Clock): string {
  switch (mood) {
    case 'idle':
      return 'ready when you are';
    case 'fault':
      return faultCaption(clock, s.moodFaultAt);
    case 'look':
      return 'watching the tests';
    case 'gate':
      return 'needs your ok';
    default: {
      const helpers = Object.values(s.subagents).filter((a) => a.active).length;
      return helpers > 0 ? `thinking with ${helpers} helper${helpers === 1 ? '' : 's'}` : 'thinking';
    }
  }
}

function row(c: Canvas, x: number, y: number, w: number, left: readonly Seg[], right: readonly Seg[]): void {
  c.segs(x, y, left, x + w);
  if (right.length) c.segsRight(x + w - 1, y, right);
}

function planSection(c: Canvas, s: AppState, x: number, y: number, w: number, clock: Clock): number {
  const plan = s.plan;
  const done = plan.filter((p) => p.state === 'done').length;
  const running = plan.filter((p) => p.state === 'running').length;
  heading(c, x, y, w, 'plan', [[`${done} of ${plan.length}`, S.muted]]);
  const filled = Math.floor((w * (done + running / 2)) / Math.max(1, plan.length));
  c.put(x, y + 1, shimmerBar(clock, w, filled), S.saffron);
  plan.forEach((p: PlanStep, i) => {
    const glyph: Seg =
      p.state === 'done' ? ['✓', S.ok] : p.state === 'running' ? [spinner(clock), S.saffron] : p.state === 'gate' ? ['◆', S.gate] : ['○', S.faint];
    const owner: Seg = p.state === 'gate' ? ['needs you', S.gate] : [p.owner, p.state === 'running' ? S.saffron : S.faint];
    const labelW = w - 2 - width(owner[0]) - 1;
    row(c, x, y + 2 + i, w, [glyph, [' '], [truncate(p.label, labelW), p.state === 'todo' ? S.muted : S.ink]], [owner]);
  });
  return y + 2 + plan.length;
}

function chaosSection(c: Canvas, s: AppState, x: number, y: number, w: number, max: number): number {
  heading(c, x, y, w, 'chaos', [[s.status.chaosEnabled ? s.status.profile : 'off', S.fault]]);
  const faults = s.faults.slice(-max);
  faults.forEach((f, i) => {
    const outcome: Seg[] =
      f.state === 'recovered'
        ? [['✓', S.ok], [` ${f.steps ?? 1} step${f.steps === 1 ? '' : 's'}`, S.muted]]
        : f.state === 'failed'
          ? [['✗', S.fail], [' not recovered', S.fail]]
          : [['…', S.faint], [' recovering', S.faint]];
    c.segs(x, y + 1 + i, [['⚡', S.fault], [' '], [truncate(f.type, 14).padEnd(15), S.ink], ...outcome], x + w);
  });
  return y + 1 + faults.length;
}

function sessionSkillsSection(c: Canvas, s: AppState, x: number, y: number, w: number, mood: Mood): number {
  const entries = Object.entries(s.sessionSkills);
  const used = entries.filter(([, v]) => v === 'used' || v === 'using').length;
  heading(c, x, y, w, 'skills', mood === 'fault' ? [[`${used} used`, S.muted]] : [[`${s.skills.filter((k) => k.status === 'active').length} known`, S.muted]]);
  entries.slice(0, 5).forEach(([name, state], i) => {
    const tone = state === 'using' ? S.saffron : state === 'used' ? S.ok : S.faint;
    row(c, x, y + 1 + i, w, [['↳', S.skill], [' '], [truncate(shortSkillName(name), NAME_W), S.ink]], [[state, tone]]);
  });
  return y + 1 + Math.min(5, entries.length);
}

function knownSkillsSection(c: Canvas, s: AppState, x: number, y: number, w: number): number {
  const active = s.skills.filter((k) => k.status === 'active');
  heading(c, x, y, w, 'skills', [[`${active.length} known`, S.muted]]);
  const fresh = active.filter((k) => k.isNew);
  const rest = active.filter((k) => !k.isNew).sort((a, b) => (b.uses > 0 ? 1 : 0) - (a.uses > 0 ? 1 : 0));
  const shown = [...fresh, ...rest].slice(0, 4);
  shown.forEach((k, i) => {
    const left: Seg[] = k.isNew ? [['✦', S.saffron], [' '], [truncate(shortSkillName(k.name), NAME_W), S.ink]] : [['↳', S.skill], [' '], [truncate(shortSkillName(k.name), NAME_W), S.ink]];
    const right: Seg[] = k.isNew ? [['new', S.saffron]] : [[k.winRate === null ? '–' : `${Math.round(k.winRate * 100)}%`, S.muted]];
    row(c, x, y + 1 + i, w, left, right);
  });
  let yy = y + 1 + shown.length;
  if (active.length > shown.length) {
    c.put(x, yy, `· ${active.length - shown.length} more  ·  ctrl+s`, S.faint);
    yy += 1;
  }
  return yy;
}

function paintPhone(c: Canvas, s: AppState, l: Layout, clock: Clock): void {
  const x = l.sideX;
  const w = l.sideW;
  const y0 = l.bodyTop;
  const p = s.phone;
  const fresh = p.frameAt !== null && (clock.still || clock.now - p.frameAt < 10_000);
  c.segs(x, y0, [['phone', S.inkBold], [` ${p.device} · API ${p.api}`, S.muted]]);
  c.segsRight(x + w - 1, y0, fresh ? [[pick(LIVE_DOT.frames, clock, LIVE_DOT.ms), S.saffron], [' live', S.saffron]] : [['○', S.faint], [' paused', S.faint]]);
  const px = x + 4;
  const top = y0 + 2;
  const inner = 22;
  const screenRows = 24;
  const h = screenRows + 4;
  drawBox(c, px, top, inner + 2, h, ROUNDED, { fg: 'line' });
  c.segs(px + 2, top + 1, [['▂▄▆', S.muted]]);
  c.put(px + 10, top + 1, '▬▬▬', S.ghost);
  c.segsRight(px + inner - 1, top + 1, [[p.clock, S.muted]]);
  const f = p.frame;
  for (let r = 0; r < screenRows; r++) {
    for (let col = 0; col < inner; col++) {
      if (f) {
        const t = f.px[2 * r * f.w + col] ?? '#000000';
        const b = f.px[(2 * r + 1) * f.w + col] ?? '#000000';
        c.put(px + 1 + col, top + 2 + r, '▀', { fg: t as `#${string}`, bg: b as `#${string}` });
      } else {
        c.put(px + 1 + col, top + 2 + r, ' ', { bg: 'bg-sunken' });
      }
    }
  }
  if (!f) centered(c, px + 1, top + 2 + Math.floor(screenRows / 2), inner, 'waiting for a frame', S.faint);
  if (p.lastTap && f) c.put(px + 1 + p.lastTap.col - 1, top + 2 + p.lastTap.row, pick(RIPPLE.frames, clock, RIPPLE.ms), { fg: 'saffron', bold: true });
  c.put(px + 8, top + 2 + screenRows, '───────', S.muted);
}

/** Under 120 cols a phone in use is a one-line strip above the conversation. */
export function phoneStripShown(s: AppState, l: Layout, clock: Clock): boolean {
  return !l.full && phoneShown(s, clock);
}

/** One-line phone strip at 80 cols. Returns true when drawn (the conversation starts a row lower). */
export function paintPhoneStrip(c: Canvas, s: AppState, l: Layout, clock: Clock): boolean {
  if (!phoneStripShown(s, l, clock)) return false;
  const y = l.bodyTop;
  c.fill(l.convX, y, l.convW, 1, { bg: 'bg-raised' });
  const last = s.phone.lastTap ? `last tap: ${s.phone.lastTap.label}${s.phone.lastAction ? `, ${s.phone.lastAction}` : ''}` : (s.phone.lastAction ?? 'waiting');
  const right = 'ctrl+l show';
  c.segs(l.convX + 1, y, [['▣', S.saffron], [' phone ', S.inkBold], [truncate(`${s.phone.device} · ${last}`, l.convW - 6 - 8 - right.length), S.muted]]);
  c.put(l.convX + l.convW - 1 - right.length, y, right, S.faint);
  return true;
}

export function paintSidebar(c: Canvas, s: AppState, l: Layout, clock: Clock, mood: Mood, x = l.sideX, w = l.sideW): void {
  if (l.full && phoneShown(s, clock)) {
    paintPhone(c, s, l, clock);
    return;
  }
  const bodyX = x + 11;
  const top = l.bodyTop + 2;
  const shadow = drawMascot(c, bodyX, top, mood, clock, s.moodFaultAt);
  const captionY = shadow + 2;
  centered(c, x, captionY, w, captionFor(s, mood, clock), mood === 'fault' ? S.fault : S.muted, mood === 'fault');

  if (mood === 'idle' && !s.turn.running) {
    // At rest the lists sit at the bottom: what monk knows, what chaos means, the generation.
    const pct = Math.round(s.status.faultRate * 100);
    const rateLine = ['light', 'moderate', 'heavy'].includes(s.status.profile) ? `${pct}% of tool calls get a fault` : (PROFILE_HELP[s.status.profile] ?? `${pct}% of tool calls get a fault`);
    const chaosLines = [s.status.chaosEnabled ? rateLine : 'off · tools behave normally', `seed ${s.status.seed} · same faults every run`, 'never on delete, merge, publish'];
    const active = s.skills.filter((k) => k.status === 'active');
    const skillRows = 1 + Math.min(4, active.length) + (active.length > 4 ? 1 : 0);
    const need = skillRows + 1 + 1 + chaosLines.length + 1 + 2;
    let y = Math.max(captionY + 2, l.bodyBottom - need);
    y = knownSkillsSection(c, s, x, y, w) + 1;
    heading(c, x, y, w, 'chaos', [[s.status.chaosEnabled ? s.status.profile : 'off', S.fault]]);
    chaosLines.forEach((t, i) => c.put(x, y + 1 + i, truncate(t, w), S.muted));
    y += 1 + chaosLines.length + 1;
    c.put(x, y, `generation ${s.status.generation}`, S.inkBold);
    c.put(x, y + 1, 'each run teaches the next one', S.muted);
    return;
  }

  let y = captionY + 2;
  const limit = l.bodyBottom;
  if (mood === 'fault' && s.faults.length > 0) {
    const rec = s.faults.filter((f) => f.state === 'recovered').length;
    heading(c, x, y, w, 'recovered', [[`${rec} of ${s.faults.length}`, S.muted]]);
    // Half-cell steps; a full bar ends on ▌ so it never touches the sidebar edge.
    const halves = Math.round(((2 * w - 1) * rec) / s.faults.length);
    c.put(x, y + 1, '█'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '▌' : ''), S.ok);
    y += 3;
  } else if (s.plan.length > 0 && y + s.plan.length + 2 <= limit) {
    y = planSection(c, s, x, y, w, clock) + 1;
  }
  if (y + 2 <= limit && s.faults.length > 0) {
    const max = Math.max(1, Math.min(5, limit - y - 6));
    y = chaosSection(c, s, x, y, w, max) + 1;
  }
  if (y + 2 <= limit && Object.keys(s.sessionSkills).length > 0) y = sessionSkillsSection(c, s, x, y, w, mood) + 1;
  if (s.learning && y + 1 <= limit) {
    c.segs(x, y, [['✦', S.saffron], [' learning: ', S.muted], [truncate(s.learning, w - 12), S.ink]]);
    c.put(x + 2, y + 1, pick(DRAFTING.frames, clock, DRAFTING.ms), S.saffron);
  }
}
