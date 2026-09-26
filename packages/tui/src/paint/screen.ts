// Paints one whole frame from state. Pure: (state, clock, size) → Canvas, so the live renderer,
// the snapshot harness and tests all share it.
import type { Clock } from '../anim/frames.ts';
import { computeLayout, type Layout } from '../layout.ts';
import { Canvas } from '../render/canvas.ts';
import type { AppState, StepItem } from '../state/types.ts';
import { paintApproval } from './approval.ts';
import { paintHints, paintInput, paintTopBar, type InputView } from './chrome.ts';
import { S } from './common.ts';
import { conversationView, paintConversation, type ConvView } from './conversation.ts';
import { idlePlaceholder, paintIdle } from './idle.ts';
import { moodOf, type Mood } from './mood.ts';
import { paintChaosPicker, paintDetails, paintHelp, paintPalette, paintResume, paintSlash, slashView } from './popups.ts';
import { currentCall, isOther, paintQuestion, questionHeight } from './question.ts';
import { paintPhoneStrip, paintSidebar, phoneShown, phoneStripShown } from './sidebar.ts';
import { paintSkillsBrowser } from './skills.ts';

type Pairs = (readonly [string, string])[];

function hintsFor(s: AppState, l: Layout, mood: Mood, clock: Clock): Pairs {
  const full = l.full;
  if (s.ui.popup?.kind === 'skills') {
    return full
      ? [['↑↓', 'pick'], ['enter', 'open'], ['/', 'filter'], ['v', 'check it again'], ['r', 'retire'], ['g', 'git log'], ['esc', 'back']]
      : [['↑↓', 'pick'], ['enter', 'read'], ['/', 'filter'], ['esc', 'back']];
  }
  if (s.ui.focus === 'well') {
    return full
      ? [['↑↓', 'scroll'], ['end', 'follow'], ['ctrl+o', 'fold'], ['c', 'copy'], ['tab', 'move around'], ['esc', 'stop']]
      : [['↑↓', 'scroll'], ['end', 'follow'], ['ctrl+o', 'fold'], ['esc', 'stop']];
  }
  if (!s.turn.running) {
    return full
      ? [['enter', 'send'], ['/', 'commands'], ['ctrl+p', 'everything'], ['tab', 'move around'], ['?', 'help']]
      : [['enter', 'send'], ['/', 'commands'], ['ctrl+p', 'everything'], ['?', 'help']];
  }
  if (phoneShown(s, clock)) {
    return full
      ? [['esc', 'stop'], ['f', 'phone full screen'], ['s', 'save screenshot'], ['ctrl+l', 'hide phone'], ['tab', 'move around'], ['?', 'help']]
      : [['esc', 'stop'], ['ctrl+l', 'show phone'], ['?', 'help']];
  }
  if (mood === 'fault' && full) return [['esc', 'stop'], ['ctrl+o', 'details'], ['enter on ⚡', 'jumps to chaos'], ['tab', 'move around'], ['?', 'help']];
  return full
    ? [['esc', 'stop'], ['ctrl+o', 'details'], ['tab', 'move around'], ['ctrl+l', 'sidebar'], ['ctrl+p', 'everything'], ['?', 'help']]
    : [['esc', 'stop'], ['ctrl+o', 'details'], ['ctrl+l', 'sidebar'], ['?', 'help']];
}

function inputFor(s: AppState, l: Layout, clock: Clock): InputView {
  const ui = s.ui;
  const pop = ui.popup;
  const focused = ui.focus === 'input' && (pop === null || pop.kind === 'palette' || pop.kind === 'slash');
  const base = { text: ui.input.text, cursor: ui.input.cursor, focused, caretSince: ui.inputSince };
  if (pop?.kind === 'skills') {
    const f = pop.filtering || pop.filter ? pop.filter : '';
    return { ...base, text: f, focused: pop.filtering, placeholder: 'press / to filter skills', right: 'esc back' };
  }
  if (slashView(ui.input.text, 0)) return { ...base, placeholder: '', right: l.full ? 'tab complete · enter go' : 'tab complete' };
  const q = s.question;
  const call = q ? currentCall(q) : undefined;
  if (q && call) {
    const own = call.options.length === 0 || isOther(call.options[q.selected] ?? '');
    return { ...base, placeholder: own ? 'type your answer' : 'or type your own answer', right: 'enter ↵' };
  }
  if (s.turn.running) return { ...base, placeholder: l.full ? 'type to queue a message for after this' : 'queue a message', right: 'esc stop' };
  const idle = s.items.length === 0;
  return {
    ...base,
    placeholder: 'message monk',
    placeholderOverride: idle && focused && ui.input.text === '' ? idlePlaceholder(clock, ui.inputSince) : null,
    right: 'enter ↵',
  };
}

/** The layout a frame of this state uses; the input grows with its lines. */
export function screenLayout(s: AppState, w: number, h: number): Layout {
  return computeLayout(w, h, Math.min(4, s.ui.input.text.split('\n').length));
}

/** The conversation's share of the body: an open question's card takes the rows above the input. */
function conversationLayout(s: AppState, l: Layout): Layout {
  const card = questionHeight(s, l);
  return card === 0 ? l : { ...l, bodyBottom: l.bodyBottom - card - 1 };
}

/** The conversation's view as paintScreen draws it at this size, for scrolling by keys and wheel. */
export function screenConversation(s: AppState, clock: Clock, w: number, h: number): ConvView {
  const l = screenLayout(s, w, h);
  return conversationView(s, conversationLayout(s, l), clock, phoneStripShown(s, l, clock) ? l.bodyTop + 1 : l.bodyTop);
}

export function paintScreen(s: AppState, clock: Clock, w: number, h: number): Canvas {
  const c = new Canvas(w, h, { bg: 'bg' });
  const l = screenLayout(s, w, h);
  const mood = moodOf(s, clock);

  if (s.approval) {
    paintTopBar(c, s, l, clock, mood);
    paintApproval(c, s.approval, l, clock);
    return c;
  }

  const pop = s.ui.popup;
  if (pop?.kind === 'skills') {
    paintSkillsBrowser(c, s, l, clock, pop);
  } else {
    const strip = paintPhoneStrip(c, s, l, clock);
    // The welcome screen doesn't fit under a question's card.
    if (s.items.length === 0 && !s.question) paintIdle(c, s, l, clock);
    else paintConversation(c, s, conversationLayout(s, l), clock, strip ? { top: l.bodyTop + 1 } : {});
    paintQuestion(c, s, l);
    if (l.full) {
      for (let y = l.bodyTop; y <= l.bodyBottom; y++) c.put(l.ruleX, y, '│', S.ghost);
      paintSidebar(c, s, l, clock, mood);
    } else if (s.ui.sidebarOverlay) {
      const x = l.w - l.sideW - 3;
      c.fill(x - 2, l.bodyTop, l.w - x + 2, l.bodyBottom - l.bodyTop + 1, { bg: 'bg' });
      for (let y = l.bodyTop; y <= l.bodyBottom; y++) c.put(x - 2, y, '│', S.ghost);
      paintSidebar(c, s, { ...l, full: true }, clock, mood, x, l.sideW);
    }
  }
  paintTopBar(c, s, l, clock, mood);
  paintInput(c, l, inputFor(s, l, clock), clock);
  paintHints(c, l, hintsFor(s, l, mood, clock));

  if (s.error) {
    const msg = ` ${s.error} `;
    c.put(Math.max(0, l.w - msg.length - 2), l.bodyTop, msg, { fg: 'fail', bg: 'bg-raised' });
  }

  const sv = pop === null || pop.kind === 'slash' ? slashView(s.ui.input.text, pop?.kind === 'slash' ? pop.selected : 0) : null;
  if (sv) paintSlash(c, s, l, sv);
  if (pop) {
    switch (pop.kind) {
      case 'palette':
        paintPalette(c, s, l, clock, pop.query, pop.selected);
        break;
      case 'chaos':
        paintChaosPicker(c, s, l, pop.selected);
        break;
      case 'resume':
        paintResume(c, s, l, pop.selected);
        break;
      case 'help':
        paintHelp(c, l);
        break;
      case 'details': {
        const st = s.items.find((it): it is StepItem => it.kind === 'step' && it.id === pop.stepId);
        if (st) paintDetails(c, l, st);
        break;
      }
      default:
        break;
    }
  }
  return c;
}
