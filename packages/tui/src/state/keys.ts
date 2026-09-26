// Keys → state changes plus effects for the backend. Pure, so every binding is unit-testable.
import { isArmed } from '../paint/approval.ts';
import { chaosArgOptions, COMMANDS, filterPalette, paletteItems, slashMatches, slashView } from '../paint/popups.ts';
import { SHOWCASE } from '../paint/idle.ts';
import { currentCall, isOther } from '../paint/question.ts';
import { screenConversation } from '../paint/screen.ts';
import { orderedSkills } from '../paint/skills.ts';
import { phoneShown } from '../paint/sidebar.ts';
import { FOLLOW } from './reducer.ts';
import type { AppState, StepItem } from './types.ts';

export type Key = { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string };

/** Terminal size in cells; scrolling needs it to know a page and where history ends. */
export type Screen = { w: number; h: number };

/** The reference size, for callers (tests) that don't pass one. */
const REFERENCE: Screen = { w: 120, h: 36 };

/** Rows one wheel notch moves the conversation. */
export const WHEEL_ROWS = 3;

export type Effect =
  | { kind: 'send'; text: string }
  | { kind: 'cancel' }
  | { kind: 'approve'; allow: boolean; reason?: string }
  | { kind: 'answer'; answers: Answer[] }
  | { kind: 'chaos'; profile?: string; enabled?: boolean; fault?: string }
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'agent'; name: string }
  | { kind: 'bench' }
  | { kind: 'sessions' }
  | { kind: 'skills' }
  | { kind: 'verifySkill'; name: string }
  | { kind: 'retireSkill'; name: string }
  | { kind: 'editCalls' }
  | { kind: 'copy'; text: string }
  | { kind: 'bell' }
  | { kind: 'quit' }
  | { kind: 'notice'; text: string };

/** One answered question call; the backend sends them together once the whole batch is answered. */
export type Answer = { threadId: string; callId: string; question: string; content: string };

export type KeyResult = { state: AppState; effects: Effect[] };

const NONE: Effect[] = [];

function ui(s: AppState, patch: Partial<AppState['ui']>): AppState {
  return { ...s, ui: { ...s.ui, ...patch } };
}

function setInput(s: AppState, text: string, now: number): AppState {
  return ui(s, { input: { text, cursor: text.length }, inputSince: now });
}

function stepIds(s: AppState): string[] {
  return s.items.filter((it): it is StepItem => it.kind === 'step' && !it.folded).map((it) => it.id);
}

function note(s: AppState, text: string): Effect[] {
  return [{ kind: 'notice', text }];
}

/** Runs a slash command typed in the input. */
export function runCommand(s: AppState, line: string, now: number): KeyResult {
  const [cmd = '', ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  const cleared = setInput(s, '', now);
  const next = { ...cleared, ui: { ...cleared.ui, popup: null, history: [line, ...s.ui.history].slice(0, 50), scroll: FOLLOW } };
  switch (cmd) {
    case '/new':
      return { state: next, effects: [{ kind: 'new' }] };
    case '/stop':
      return { state: next, effects: [{ kind: 'cancel' }] };
    case '/skills':
      return { state: ui(next, { popup: { kind: 'skills', selected: 0, filter: '', filtering: false, openedAt: now, reading: false } }), effects: [{ kind: 'skills' }] };
    case '/resume':
      return { state: ui(next, { popup: { kind: 'resume', selected: 0 } }), effects: [{ kind: 'sessions' }] };
    case '/chaos': {
      if (!arg) return { state: ui(next, { popup: { kind: 'chaos', selected: Math.max(0, s.status.profiles.indexOf(s.status.profile)) } }), effects: NONE };
      if (arg === 'off') return { state: next, effects: [{ kind: 'chaos', enabled: false }] };
      if (arg === 'on') return { state: next, effects: [{ kind: 'chaos', enabled: true }] };
      if (s.status.profiles.includes(arg)) return { state: next, effects: [{ kind: 'chaos', profile: arg, enabled: true }] };
      return { state: next, effects: [{ kind: 'chaos', fault: arg }] };
    }
    case '/agent':
      return arg ? { state: next, effects: [{ kind: 'agent', name: arg }] } : { state: next, effects: note(s, 'usage: /agent <name>') };
    case '/bench':
      return { state: next, effects: [{ kind: 'bench' }] };
    case '/status': {
      const c = s.status.connections;
      const text = `github ${c.github} · sandbox ${c.sandbox} · phone ${c.phone} · trueforge ${s.status.trueforge} · monk api ${s.status.api} · chaos ${s.status.chaosEnabled ? s.status.profile : 'off'}`;
      return { state: next, effects: note(s, text) };
    }
    case '/link':
      return { state: next, effects: note(s, 'send /link to the Telegram or Discord bot, then /link <code> here or there to join the same chat') };
    case '/cron':
      return { state: next, effects: note(s, 'schedules live in chat: /cron add every weekday 9am, … on Telegram or Discord') };
    default:
      return { state: next, effects: note(s, `unknown command ${cmd}`) };
  }
}

function approvalKeys(s: AppState, k: Key, now: number): KeyResult {
  const a = s.approval!;
  if (a.stage === 'reason') {
    if (k.name === 'return') return { state: { ...s, approval: { ...a, sent: true } }, effects: [{ kind: 'approve', allow: false, reason: a.reason.trim() || 'not now' }] };
    if (k.name === 'escape') return { state: { ...s, approval: { ...a, sent: true } }, effects: [{ kind: 'approve', allow: false, reason: 'not now' }] };
    if (k.name === 'backspace') return { state: { ...s, approval: { ...a, reason: a.reason.slice(0, -1) } }, effects: NONE };
    if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && k.sequence >= ' ') return { state: { ...s, approval: { ...a, reason: a.reason + k.sequence } }, effects: NONE };
    return { state: s, effects: NONE };
  }
  // Keys stay dead for the first 600 ms so a keystroke already in flight can't approve. esc never closes.
  if (!isArmed(a, now) || a.sent) return { state: s, effects: NONE };
  switch (k.name) {
    case 'y':
      return { state: { ...s, approval: { ...a, sent: true } }, effects: [{ kind: 'approve', allow: true }] };
    case 'n':
      return { state: { ...s, approval: { ...a, stage: 'reason' } }, effects: NONE };
    case 'e':
      return { state: s, effects: [{ kind: 'editCalls' }] };
    default:
      return { state: s, effects: NONE };
  }
}

/** Answers the question on screen; the last one of a batch sends them all and closes the card. */
function answerQuestion(s: AppState, content: string, now: number): KeyResult {
  const q = s.question!;
  const answered = [...q.answered, content];
  const cleared = ui(setInput(s, '', now), { scroll: FOLLOW });
  if (answered.length < q.calls.length) return { state: { ...cleared, question: { ...q, answered, selected: 0 } }, effects: NONE };
  const answers = q.calls.map((c, i) => ({ threadId: c.threadId, callId: c.callId, question: c.question, content: answered[i] ?? content }));
  return { state: { ...cleared, question: null }, effects: [{ kind: 'answer', answers }] };
}

/** The option a lone number stands for: `2` with three options is the second one. */
function optionNumbered(text: string, n: number): number | null {
  return /^[1-9]$/.test(text) && Number(text) <= n ? Number(text) - 1 : null;
}

/**
 * An open question takes ↑↓ (with options), 1–N on an empty input and enter before the input does.
 * A digit picks its option and stays in the input: enter answers it, and typing on makes it an
 * answer in your own words ("2 days please"). A slash command being typed keeps its own keys.
 */
function questionKeys(s: AppState, k: Key, now: number): KeyResult | null {
  const q = s.question!;
  const opts = currentCall(q)?.options ?? [];
  const text = s.ui.input.text;
  const sv = slashView(text, 0);
  if (sv && (sv.mode === 'args' || slashMatches(sv.query).some((m) => m.hits !== null))) return null;
  const plain = !k.ctrl && !k.meta && !k.shift;
  const select = (st: AppState, i: number): AppState => ({ ...st, question: { ...q, selected: i } });
  if (plain && opts.length > 0 && (k.name === 'up' || k.name === 'down')) {
    const i = k.name === 'up' ? Math.max(0, q.selected - 1) : Math.min(opts.length - 1, q.selected + 1);
    // The arrows take over from a digit typed to pick, so the digit goes.
    return { state: select(optionNumbered(text, opts.length) === null ? s : setInput(s, '', now), i), effects: NONE };
  }
  if (!k.ctrl && !k.meta && text === '' && optionNumbered(k.sequence, opts.length) !== null) {
    const i = Number(k.sequence) - 1;
    // "Other" waits for the typed answer.
    return { state: select(isOther(opts[i]!) ? s : setInput(s, k.sequence, now), i), effects: NONE };
  }
  if (k.name === 'return' && !k.shift && !k.meta) {
    const typed = text.trim();
    const i = optionNumbered(typed, opts.length) ?? (typed ? null : q.selected);
    if (i === null) return answerQuestion(s, typed, now);
    const picked = opts[i];
    if (picked === undefined) return { state: s, effects: NONE };
    if (isOther(picked)) return { state: typed ? select(setInput(s, '', now), i) : s, effects: NONE };
    return answerQuestion(s, picked, now);
  }
  return null;
}

function editInput(s: AppState, k: Key, now: number): KeyResult | null {
  const text = s.ui.input.text;
  if (k.name === 'backspace') return { state: setInput(s, text.slice(0, -1), now), effects: NONE };
  if (k.ctrl && k.name === 'u') return { state: setInput(s, '', now), effects: NONE };
  if (k.ctrl && k.name === 'w') return { state: setInput(s, text.replace(/\s*\S+\s*$/, ''), now), effects: NONE };
  if (k.name === 'return' && (k.shift || k.meta)) return { state: setInput(s, `${text}\n`, now), effects: NONE };
  if (!k.ctrl && !k.meta && k.sequence && [...k.sequence].length === 1 && k.sequence >= ' ' && k.name !== 'return' && k.name !== 'tab' && k.name !== 'escape') {
    return { state: setInput(s, text + k.sequence, now), effects: NONE };
  }
  return null;
}

export function handleKey(s: AppState, k: Key, now: number, screen: Screen = REFERENCE): KeyResult {
  if (k.ctrl && k.name === 'c') return { state: s, effects: [{ kind: 'quit' }] };
  if (s.approval) return approvalKeys(s, k, now);

  const pop = s.ui.popup;

  // Popups trap focus.
  if (pop?.kind === 'palette') {
    const shown = filterPalette(paletteItems(s), pop.query);
    if (k.name === 'escape') return { state: ui(s, { popup: null }), effects: NONE };
    if (k.name === 'up') return { state: ui(s, { popup: { ...pop, selected: Math.max(0, pop.selected - 1) } }), effects: NONE };
    if (k.name === 'down') return { state: ui(s, { popup: { ...pop, selected: Math.min(shown.length - 1, pop.selected + 1) } }), effects: NONE };
    if (k.name === 'backspace') return { state: ui(s, { popup: { ...pop, query: pop.query.slice(0, -1), selected: 0 } }), effects: NONE };
    if (k.name === 'return') {
      const item = shown[pop.selected]?.item;
      const closed = ui(s, { popup: null });
      if (!item) return { state: closed, effects: NONE };
      return paletteAction(closed, item.action, now);
    }
    if (!k.ctrl && k.sequence && k.sequence.length === 1 && k.sequence >= ' ') return { state: ui(s, { popup: { ...pop, query: pop.query + k.sequence, selected: 0 } }), effects: NONE };
    return { state: s, effects: NONE };
  }
  if (pop?.kind === 'skills') return skillsKeys(s, pop, k, now);
  if (pop?.kind === 'chaos') {
    const profiles = s.status.profiles;
    if (k.name === 'escape') return { state: ui(s, { popup: null }), effects: NONE };
    if (k.name === 'up') return { state: ui(s, { popup: { ...pop, selected: Math.max(0, pop.selected - 1) } }), effects: NONE };
    if (k.name === 'down') return { state: ui(s, { popup: { ...pop, selected: Math.min(profiles.length - 1, pop.selected + 1) } }), effects: NONE };
    if (k.name === 'return') {
      const p = profiles[pop.selected];
      return { state: ui(s, { popup: null }), effects: p ? [{ kind: 'chaos', profile: p, enabled: p !== 'off' }] : NONE };
    }
    return { state: s, effects: NONE };
  }
  if (pop?.kind === 'resume') {
    if (k.name === 'escape') return { state: ui(s, { popup: null }), effects: NONE };
    if (k.name === 'up') return { state: ui(s, { popup: { ...pop, selected: Math.max(0, pop.selected - 1) } }), effects: NONE };
    if (k.name === 'down') return { state: ui(s, { popup: { ...pop, selected: Math.min(Math.max(0, s.sessions.length - 1), pop.selected + 1) } }), effects: NONE };
    if (k.name === 'return') {
      const target = s.sessions[pop.selected];
      return { state: ui(s, { popup: null }), effects: target ? [{ kind: 'resume', sessionId: target.id }] : NONE };
    }
    return { state: s, effects: NONE };
  }
  if (pop?.kind === 'help' || pop?.kind === 'details' || pop?.kind === 'phone') {
    if (k.name === 'escape' || k.name === 'return' || (k.ctrl && k.name === 'o') || k.sequence === '?' || k.name === 'f') return { state: ui(s, { popup: null }), effects: NONE };
    return { state: s, effects: NONE };
  }

  // Global shortcuts.
  if (k.ctrl && k.name === 'p') return { state: ui(s, { popup: { kind: 'palette', query: '', selected: 0 } }), effects: NONE };
  if (k.ctrl && k.name === 's') return { state: ui(s, { popup: { kind: 'skills', selected: 0, filter: '', filtering: false, openedAt: now, reading: false } }), effects: [{ kind: 'skills' }] };
  if (k.ctrl && k.name === 'k') return { state: ui(s, { popup: { kind: 'chaos', selected: Math.max(0, s.status.profiles.indexOf(s.status.profile)) } }), effects: NONE };
  if (k.ctrl && k.name === 'l') {
    if (phoneShown(s, { now, still: false, reduced: false }) || s.ui.phoneHidden) return { state: ui(s, { phoneHidden: !s.ui.phoneHidden }), effects: NONE };
    return { state: ui(s, { sidebarOverlay: !s.ui.sidebarOverlay }), effects: NONE };
  }
  if (k.ctrl && k.name === 'o') return toggleDetails(s);

  const scrolled = scrollKeys(s, k, screen, now);
  if (scrolled) return scrolled;

  if (s.question && s.ui.focus === 'input') {
    const asked = questionKeys(s, k, now);
    if (asked) return asked;
  }

  if (k.name === 'escape') {
    if (s.ui.sidebarOverlay) return { state: ui(s, { sidebarOverlay: false }), effects: NONE };
    if (s.ui.focus !== 'input') return { state: ui(s, { focus: 'input' }), effects: s.turn.running ? [{ kind: 'cancel' }] : NONE };
    return { state: s, effects: s.turn.running ? [{ kind: 'cancel' }] : NONE };
  }

  if (s.ui.focus === 'well') return wellKeys(s, k);
  if (s.ui.focus === 'conversation') return conversationKeys(s, k, now);

  // The input.
  const text = s.ui.input.text;
  const sv = slashView(text, pop?.kind === 'slash' ? pop.selected : 0);
  if (sv) {
    const count = sv.mode === 'commands' ? slashMatches(sv.query).length : chaosArgOptions(sv.query, s.status.profiles).length;
    const sel = pop?.kind === 'slash' ? pop.selected : 0;
    if (k.name === 'up') return { state: ui(s, { popup: { kind: 'slash', selected: Math.max(0, sel - 1) } }), effects: NONE };
    if (k.name === 'down') return { state: ui(s, { popup: { kind: 'slash', selected: Math.min(count - 1, sel + 1) } }), effects: NONE };
    if (k.name === 'tab' || (k.name === 'return' && sv.mode === 'commands' && !COMMANDS.some((c) => c.name === text.trim()))) {
      const completed = completeSlash(s, sv, sel);
      if (completed !== null && completed !== text) {
        const st = setInput(s, completed, now);
        if (k.name === 'return' && !completed.endsWith(' ')) return runCommand(st, completed, now);
        return { state: ui(st, { popup: { kind: 'slash', selected: 0 } }), effects: NONE };
      }
    }
    if (k.name === 'return' && !k.shift) {
      const line = sv.mode === 'args' ? (completeSlash(s, sv, sel) ?? text) : text;
      return runCommand(s, line.trim(), now);
    }
  }

  if (k.name === 'tab') {
    if (text === '' && s.items.length === 0) return { state: setInput(s, SHOWCASE, now), effects: NONE };
    return { state: ui(s, { focus: s.ui.wellOpen ? 'well' : 'conversation', selectedStep: stepIds(s).at(-1) ?? null }), effects: NONE };
  }
  if (k.sequence === '?' && text === '') return { state: ui(s, { popup: { kind: 'help' } }), effects: NONE };
  if (k.name === 'up' && text === '' && s.ui.history[0]) return { state: setInput(s, s.ui.history[0], now), effects: NONE };
  if (k.name === 'return' && !k.shift && !k.meta) {
    const line = text.trim();
    if (!line) return { state: s, effects: NONE };
    if (line.startsWith('/')) return runCommand(s, line, now);
    const cleared = setInput(s, '', now);
    return { state: ui(cleared, { popup: null, history: [line, ...s.ui.history].slice(0, 50), scroll: FOLLOW }), effects: [{ kind: 'send', text: line }] };
  }
  const edited = editInput(s, k, now);
  if (edited) {
    const nowText = edited.state.ui.input.text;
    const popup = nowText.startsWith('/') ? { kind: 'slash' as const, selected: 0 } : null;
    return { state: ui(edited.state, { popup }), effects: edited.effects };
  }
  return { state: s, effects: NONE };
}

function completeSlash(s: AppState, sv: NonNullable<ReturnType<typeof slashView>>, sel: number): string | null {
  if (sv.mode === 'commands') {
    const list = slashMatches(sv.query);
    const pick = list[sel]?.hits !== null ? list[sel] : list.find((m) => m.hits !== null);
    if (!pick) return null;
    return pick.cmd.args ? `${pick.cmd.name} ` : pick.cmd.name;
  }
  const opts = chaosArgOptions(sv.query, s.status.profiles);
  const o = opts[sel] ?? opts[0];
  return o ? `${sv.command} ${o.name}` : null;
}

function paletteAction(s: AppState, action: string, now: number): KeyResult {
  if (action.startsWith('cmd:')) {
    const name = action.slice(4);
    const cmd = COMMANDS.find((c) => c.name === name);
    if (cmd?.args) return { state: setInput(s, `${name} `, now), effects: NONE };
    return runCommand(s, name, now);
  }
  switch (action) {
    case 'chaos.pick':
      return { state: ui(s, { popup: { kind: 'chaos', selected: Math.max(0, s.status.profiles.indexOf(s.status.profile)) } }), effects: NONE };
    case 'chaos.inject':
      return { state: ui(setInput(s, '/chaos ', now), { popup: { kind: 'slash', selected: 0 } }), effects: NONE };
    case 'chaos.rate':
      return { state: ui(s, { popup: { kind: 'chaos', selected: 0 } }), effects: NONE };
    case 'chaos.off':
      return { state: s, effects: [{ kind: 'chaos', enabled: false }] };
    case 'bench':
      return { state: s, effects: [{ kind: 'bench' }] };
    case 'skills':
      return { state: ui(s, { popup: { kind: 'skills', selected: 0, filter: '', filtering: false, openedAt: now, reading: false } }), effects: [{ kind: 'skills' }] };
    case 'resume':
      return { state: ui(s, { popup: { kind: 'resume', selected: 0 } }), effects: [{ kind: 'sessions' }] };
    case 'new':
      return { state: s, effects: [{ kind: 'new' }] };
    case 'sidebar':
      return { state: ui(s, { sidebarOverlay: !s.ui.sidebarOverlay }), effects: NONE };
    case 'details':
      return toggleDetails(s);
    case 'stop':
      return { state: s, effects: [{ kind: 'cancel' }] };
    case 'status':
      return runCommand(s, '/status', now);
    default:
      return { state: s, effects: NONE };
  }
}

/** ctrl+o: the selected (or latest) step opens its sandbox well, or a details popup. */
function toggleDetails(s: AppState): KeyResult {
  const ids = stepIds(s);
  const id = s.ui.selectedStep ?? ids.at(-1);
  if (!id) return { state: s, effects: NONE };
  const st = s.items.find((it): it is StepItem => it.kind === 'step' && it.id === id);
  if (!st) return { state: s, effects: NONE };
  if (st.run) {
    if (s.ui.wellOpen === id) return { state: ui(s, { wellOpen: null, focus: 'input' }), effects: NONE };
    return { state: ui(s, { wellOpen: id, focus: 'well', selectedStep: id }), effects: NONE };
  }
  return { state: ui(s, { popup: { kind: 'details', stepId: id } }), effects: NONE };
}

function conversationKeys(s: AppState, k: Key, now: number): KeyResult {
  const ids = stepIds(s);
  const cur = s.ui.selectedStep ? ids.indexOf(s.ui.selectedStep) : ids.length - 1;
  if (k.name === 'up') return { state: ui(s, { selectedStep: ids[Math.max(0, cur - 1)] ?? null }), effects: NONE };
  if (k.name === 'down') return { state: ui(s, { selectedStep: ids[Math.min(ids.length - 1, cur + 1)] ?? null }), effects: NONE };
  if (k.name === 'tab') return { state: ui(s, { focus: 'input', selectedStep: null }), effects: NONE };
  if (k.name === 'return') return toggleDetails(s);
  // Typing goes back to the input.
  const edited = editInput(ui(s, { focus: 'input', selectedStep: null }), k, now);
  return edited ?? { state: s, effects: NONE };
}

/**
 * Moves the conversation view `rows` back in time (negative: forward), clamped to the oldest row.
 * Reaching the newest row follows new content again.
 */
export function scrollConversation(s: AppState, rows: number, screen: Screen, now: number): AppState {
  const v = screenConversation(s, { now, still: false, reduced: false }, screen.w, screen.h);
  const up = Math.min(v.max, Math.max(0, v.up + rows));
  if (up === v.up && (up > 0 || s.ui.scroll.up === 0)) return s;
  if (up === 0) return ui(s, { scroll: FOLLOW });
  return ui(s, { scroll: { up, base: v.total, from: v.up === 0 ? v.total : s.ui.scroll.from } });
}

/** The wheel scrolls the conversation; popups and the approval screen ignore it. */
export function handleWheel(s: AppState, direction: 'up' | 'down', screen: Screen, now: number, notches = 1): AppState {
  if (s.approval || (s.ui.popup !== null && s.ui.popup.kind !== 'slash')) return s;
  return scrollConversation(s, (direction === 'up' ? 1 : -1) * WHEEL_ROWS * notches, screen, now);
}

/**
 * pgup/pgdn a page (two rows overlap), shift+↑↓ (or ctrl+↑↓) a row, home the oldest, end the newest.
 * None of them edit the input. An open well keeps ↑↓ and end for its own output.
 */
function scrollKeys(s: AppState, k: Key, screen: Screen, now: number): KeyResult | null {
  const well = s.ui.focus === 'well';
  const byRow = (k.shift || k.ctrl) && !well;
  let rows: number;
  if (k.name === 'pageup' || k.name === 'pagedown') {
    const page = Math.max(1, screenConversation(s, { now, still: false, reduced: false }, screen.w, screen.h).avail - 2);
    rows = k.name === 'pageup' ? page : -page;
  } else if (byRow && k.name === 'up') rows = 1;
  else if (byRow && k.name === 'down') rows = -1;
  else if (k.name === 'home') rows = Infinity;
  else if (k.name === 'end' && !well) rows = -Infinity;
  else return null;
  return { state: scrollConversation(s, rows, screen, now), effects: NONE };
}

function wellKeys(s: AppState, k: Key): KeyResult {
  const id = s.ui.wellOpen;
  const idx = s.items.findIndex((it) => it.kind === 'step' && it.id === id);
  const st = idx >= 0 ? (s.items[idx] as StepItem) : null;
  if (!st?.run) return { state: ui(s, { focus: 'input', wellOpen: null }), effects: NONE };
  const run = st.run;
  const patchRun = (p: Partial<typeof run>): AppState => {
    const items = s.items.slice();
    items[idx] = { ...st, run: { ...run, ...p } };
    return { ...s, items };
  };
  if (k.name === 'up') return { state: patchRun({ scroll: Math.min(Math.max(0, run.lines.length - 9), run.scroll + 1), following: false }), effects: NONE };
  if (k.name === 'down') {
    const scroll = Math.max(0, run.scroll - 1);
    return { state: patchRun({ scroll, following: scroll === 0 }), effects: NONE };
  }
  if (k.name === 'end') return { state: patchRun({ scroll: 0, following: true }), effects: NONE };
  if (k.name === 'c') return { state: s, effects: [{ kind: 'copy', text: run.lines.map((l) => l.text).join('\n') }] };
  if (k.name === 'tab') return { state: ui(s, { focus: 'input' }), effects: NONE };
  return { state: s, effects: NONE };
}

function skillsKeys(s: AppState, pop: Extract<NonNullable<AppState['ui']['popup']>, { kind: 'skills' }>, k: Key, now: number): KeyResult {
  const { active, retired } = orderedSkills(s);
  const all = [...active, ...retired].filter((x) => !pop.filter || x.name.includes(pop.filter));
  if (pop.filtering) {
    if (k.name === 'escape' || k.name === 'return') return { state: ui(s, { popup: { ...pop, filtering: false } }), effects: NONE };
    if (k.name === 'backspace') return { state: ui(s, { popup: { ...pop, filter: pop.filter.slice(0, -1), selected: 0 } }), effects: NONE };
    if (k.sequence && k.sequence.length === 1 && k.sequence >= ' ') return { state: ui(s, { popup: { ...pop, filter: pop.filter + k.sequence, selected: 0 } }), effects: NONE };
    return { state: s, effects: NONE };
  }
  if (k.name === 'escape') return { state: ui(s, { popup: pop.reading ? { ...pop, reading: false } : null }), effects: NONE };
  if (k.name === 'up') return { state: ui(s, { popup: { ...pop, selected: Math.max(0, pop.selected - 1) } }), effects: NONE };
  if (k.name === 'down') return { state: ui(s, { popup: { ...pop, selected: Math.min(all.length - 1, pop.selected + 1) } }), effects: NONE };
  if (k.name === 'return') return { state: ui(s, { popup: { ...pop, reading: !pop.reading } }), effects: NONE };
  if (k.sequence === '/') return { state: ui(s, { popup: { ...pop, filtering: true } }), effects: NONE };
  const sel = all[pop.selected];
  if (k.name === 'v' && sel) return { state: s, effects: [{ kind: 'verifySkill', name: sel.name }] };
  if (k.name === 'r' && sel) return { state: s, effects: [{ kind: 'retireSkill', name: sel.name }] };
  if (k.name === 'g' && sel) return { state: ui(s, { popup: { ...pop, reading: true, openedAt: now } }), effects: NONE };
  return { state: s, effects: NONE };
}
