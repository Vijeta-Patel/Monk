// One reducer over TurnEvents (from runTurn), Monk events (from the API's SSE) and backend extras.
// Pure: (state, action) → state, so every screen can be reproduced from an event sequence.
import type { TurnEvent } from '@monk/shared/trueforge';
import type { StoredEvent } from '@monk/shared/events';
import type { Action, Extra } from './actions.ts';
import type {
  AppState,
  CardItem,
  ConvScroll,
  Item,
  MonkItem,
  PlanStep,
  SandboxRun,
  StepItem,
  Status,
} from './types.ts';
import { answeredNote, describeApproval, describeCall, faultPhrase, goalFromMessage, parsePlan, roleOf } from './describe.ts';

/** The conversation view pinned to the newest row. */
export const FOLLOW: ConvScroll = { up: 0, base: 0, from: 0 };

export function initialStatus(): Status {
  return {
    model: 'deepseek-v3.2',
    agent: 'monk',
    chaosEnabled: true,
    profile: 'moderate',
    faultRate: 0.3,
    seed: 42,
    profiles: ['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile'],
    generation: 0,
    costUsd: 0,
    faults: 0,
    recovered: 0,
    connections: { github: 'unknown', sandbox: 'unknown', phone: 'unknown' },
    api: 'unknown',
    trueforge: 'unknown',
    channel: null,
  };
}

export function initialState(now = 0): AppState {
  return {
    sessionId: null,
    items: [],
    plan: [],
    faults: [],
    skills: [],
    sessionSkills: {},
    skillNotes: {},
    skillPreviews: {},
    learning: null,
    faultNotes: {},
    subagents: {},
    status: initialStatus(),
    turn: { running: false, startedAt: null, turnId: null, goal: null, inputTokens: 0, outputTokens: 0 },
    phone: {
      active: false,
      threadId: null,
      device: 'Pixel 7',
      api: 34,
      clock: '12:06',
      lastTap: null,
      lastAction: null,
      frame: null,
      frameAt: null,
      doneAt: null,
      screenW: 1080,
      screenH: 2400,
    },
    approval: null,
    question: null,
    moodFaultAt: null,
    sessions: [],
    error: null,
    ui: {
      focus: 'input',
      popup: null,
      input: { text: '', cursor: 0 },
      history: [],
      sidebarOverlay: false,
      phoneHidden: false,
      selectedStep: null,
      wellOpen: null,
      scroll: FOLLOW,
      inputSince: now,
      bootAt: now,
    },
    seq: 0,
  };
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'turn':
      return onTurn(state, action.ev, action.at);
    case 'monk':
      return onMonk(state, action.ev, action.at);
    case 'extra':
      return onExtra(state, action.ev, action.at);
    case 'send':
      return onSend(state, action.text, action.at);
  }
}

export function reduceAll(state: AppState, actions: readonly Action[]): AppState {
  return actions.reduce(reduce, state);
}

// ---------------------------------------------------------------------------------------------

function nextId(s: AppState, prefix: string): string {
  s.seq += 1;
  return `${prefix}${s.seq}`;
}

function clone(state: AppState): AppState {
  return { ...state, items: state.items.slice(), status: { ...state.status }, turn: { ...state.turn } };
}

function stepIndexByCall(s: AppState, callId: string): number {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i]!;
    if (it.kind === 'step' && it.callId === callId) return i;
  }
  return -1;
}

function patchStep(s: AppState, idx: number, patch: Partial<StepItem>): StepItem {
  const next = { ...(s.items[idx] as StepItem), ...patch };
  s.items[idx] = next;
  return next;
}

function ownerOf(s: AppState, threadId: string): string {
  if (threadId === 'main') return 'monk';
  return s.subagents[threadId]?.role ?? 'helper';
}

function onSend(state: AppState, text: string, at: number): AppState {
  const s = clone(state);
  s.items.push({ kind: 'user', id: nextId(s, 'u'), text, at });
  if (!s.turn.running) {
    s.turn.startedAt = at;
    s.turn.goal = s.turn.goal ?? goalFromMessage(text);
  }
  s.turn.running = true;
  s.error = null;
  return s;
}

function planAdvance(plan: PlanStep[], role: string, to: 'running' | 'done'): PlanStep[] {
  const out = plan.map((p) => ({ ...p }));
  if (to === 'running') {
    const i = out.findIndex((p) => p.owner === role && p.state === 'todo');
    if (i >= 0) out[i]!.state = 'running';
  } else {
    const i = out.findIndex((p) => p.owner === role && p.state === 'running');
    if (i >= 0) out[i]!.state = 'done';
  }
  return out;
}

function detailFromResult(tool: string, content: string): string | null {
  try {
    const v = JSON.parse(content) as Record<string, unknown>;
    if (typeof v.changed_files === 'number') return `${v.changed_files} files changed`;
    if (Array.isArray(v) && /files/.test(tool)) return `${v.length} files`;
  } catch {
    /* plain text results carry no detail */
  }
  return null;
}

function runFromOutput(content: string, where: string): SandboxRun {
  const lines = content.split('\n').filter((l) => l.trim() !== '').slice(-200);
  let passed = 0;
  let failed = 0;
  const out = lines.map((text) => {
    if (/\bPASSED\b|^\s*✓/.test(text)) {
      passed++;
      return { text: text.replace(/\s*PASSED\s*$/, ''), tone: 'ok' as const };
    }
    if (/\bFAILED\b|^\s*✗/.test(text)) {
      failed++;
      return { text, tone: 'fail' as const };
    }
    if (text.startsWith('$')) return { text, tone: 'cmd' as const };
    return { text, tone: 'muted' as const };
  });
  return {
    where,
    lines: out,
    testsTotal: passed + failed > 0 ? passed + failed : null,
    testsPassed: passed,
    testsFailed: failed,
    cpu: '',
    exited: true,
    exitCode: failed > 0 ? 1 : 0,
    scroll: 0,
    following: true,
  };
}

function onTurn(state: AppState, ev: TurnEvent, at: number): AppState {
  const s = clone(state);
  switch (ev.type) {
    case 'turn.started':
      // A later turn only starts once the asking one was answered (here, on Telegram, or before a resume).
      if (s.question && s.question.turnId !== ev.turnId) s.question = null;
      s.turn.turnId = ev.turnId;
      s.turn.running = true;
      if (s.turn.startedAt === null) s.turn.startedAt = at;
      return s;
    case 'text': {
      if (ev.threadId !== 'main') return state;
      const last = s.items[s.items.length - 1];
      if (last && last.kind === 'monk' && last.streaming && last.threadId === ev.threadId) {
        s.items[s.items.length - 1] = { ...last, text: last.text + ev.delta };
      } else {
        s.items.push({ kind: 'monk', id: nextId(s, 'm'), threadId: ev.threadId, text: ev.delta, streaming: true, at });
      }
      return s;
    }
    case 'reasoning':
    case 'usage':
    case 'mcp.initialize':
      return state;
    case 'message': {
      if (ev.threadId !== 'main') return state;
      const idx = s.items.findLastIndex((it) => it.kind === 'monk' && it.streaming && it.threadId === 'main');
      if (idx >= 0) s.items[idx] = { ...(s.items[idx] as MonkItem), text: ev.content, streaming: false };
      else s.items.push({ kind: 'monk', id: nextId(s, 'm'), threadId: 'main', text: ev.content, streaming: false, at });
      if (s.plan.length === 0) {
        const parsed = parsePlan(ev.content);
        if (parsed.length >= 2) s.plan = parsed.map((p) => ({ ...p, state: 'todo' as const }));
      }
      return s;
    }
    case 'tool.call': {
      if (ev.name === 'create_sub_agent' || ev.name === 'ask_user_question') return state;
      const d = describeCall(ev.name, ev.args);
      const step: StepItem = {
        kind: 'step',
        id: nextId(s, 's'),
        callId: ev.callId,
        threadId: ev.threadId,
        tool: ev.name,
        server: ev.server,
        args: ev.args,
        text: d.doing,
        doneLabel: null,
        detail: null,
        detailTone: 'ink',
        sandbox: d.sandbox,
        owner: d.owner ?? ownerOf(s, ev.threadId),
        state: 'running',
        startedAt: at,
        endedAt: null,
        faultType: null,
        faultId: null,
        result: null,
        progress: null,
        evidence: null,
        folded: false,
        run: null,
      };
      s.items.push(step);
      if (ev.name.startsWith('mobile_')) {
        s.phone = { ...s.phone, active: true, lastAction: d.doing, doneAt: null };
      }
      return s;
    }
    case 'tool.result': {
      // The answer to an open question, given somewhere else or replayed on resume.
      const asked = s.question?.calls.find((c) => c.callId === ev.callId);
      if (asked) {
        s.question = null;
        if (!ev.isError && ev.content.trim()) s.items.push({ kind: 'note', id: nextId(s, 'n'), ...answeredNote(asked.question, ev.content), at });
      }
      const idx = stepIndexByCall(s, ev.callId);
      if (idx < 0) return asked ? s : state;
      const step = s.items[idx] as StepItem;
      const d = describeCall(step.tool, step.args);
      const patch: Partial<StepItem> = {
        endedAt: at,
        result: ev.content,
        state: step.state === 'fault' ? 'fault' : ev.isError ? 'failed' : 'done',
      };
      if (step.state !== 'fault') patch.text = step.doneLabel ?? d.done;
      if (step.detail === null && !ev.isError) patch.detail = detailFromResult(step.tool, ev.content);
      if (step.sandbox && !step.run && ev.content) patch.run = runFromOutput(ev.content, 'sandbox');
      if (step.run) patch.run = { ...step.run, exited: true };
      patchStep(s, idx, patch);
      if (step.tool.startsWith('mobile_')) s.phone = { ...s.phone, lastAction: patch.text ?? step.text };
      return s;
    }
    case 'approval.required': {
      const actions = ev.calls.map((c) => describeApproval(c.name, c.args));
      const evidence = s.items
        .filter((it): it is StepItem => it.kind === 'step' && it.state === 'done' && it.evidence !== null)
        .map((it) => it.evidence!);
      s.approval = {
        calls: ev.calls,
        actions,
        evidence,
        evidenceShort: evidence,
        alsoOn: s.status.channel,
        openedAt: at,
        stage: 'ask',
        reason: '',
        sent: false,
      };
      s.plan = s.plan.map((p) => (/merge|publish|ship|release|delete/i.test(p.label) ? { ...p, state: 'gate' as const } : p));
      return s;
    }
    case 'question':
      if (ev.calls.length === 0) return state;
      s.question = { calls: ev.calls, answered: [], selected: 0, openedAt: at, turnId: s.turn.turnId };
      // The card's keys work from the input; focus left in a sandbox well or on a step keeps ↑↓, digits and enter.
      if (s.ui.focus !== 'input') s.ui = { ...s.ui, focus: 'input', selectedStep: null };
      return s;
    case 'subagent.started': {
      const role = roleOf(ev.name, ev.input);
      s.subagents = { ...s.subagents, [ev.threadId]: { name: ev.name, role, active: true } };
      s.plan = planAdvance(s.plan, role, 'running');
      if (role === 'phone') s.phone = { ...s.phone, active: true, threadId: ev.threadId, doneAt: null };
      return s;
    }
    case 'subagent.done': {
      const sub = s.subagents[ev.threadId];
      if (!sub) return state;
      s.subagents = { ...s.subagents, [ev.threadId]: { ...sub, active: false } };
      s.plan = planAdvance(s.plan, sub.role, 'done');
      if (sub.role === 'phone') s.phone = { ...s.phone, active: false, doneAt: at };
      return s;
    }
    case 'turn.done': {
      s.turn.inputTokens += ev.inputTokens;
      s.turn.outputTokens += ev.outputTokens;
      const paused = ev.status === 'paused';
      s.turn.running = paused;
      if (!paused) {
        s.turn.startedAt = null;
        s.turn.goal = null;
        // Only a paused turn is still waiting for an answer.
        s.question = null;
      }
      s.items = s.items.map((it) => {
        if (it.kind === 'monk' && it.streaming) return { ...it, streaming: false };
        if (it.kind === 'step' && it.state === 'running' && !paused)
          return { ...it, state: ev.status === 'done' ? ('done' as const) : ('failed' as const), endedAt: at };
        return it;
      });
      if (ev.status === 'cancelled') s.items.push({ kind: 'note', id: nextId(s, 'n'), glyph: '✗', text: 'stopped', tone: 'faint', at });
      if (ev.status === 'error')
        s.items.push({ kind: 'note', id: nextId(s, 'n'), glyph: '✗', text: `that turn failed · ${ev.error ?? 'unknown error'}`, tone: 'fail', at });
      if (ev.status === 'done') s.plan = s.plan.map((p) => (p.state === 'running' ? { ...p, state: 'done' as const } : p));
      return s;
    }
  }
}

// ---------------------------------------------------------------------------------------------

function lastStepIndex(s: AppState, pred: (st: StepItem) => boolean): number {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i]!;
    if (it.kind === 'step' && pred(it)) return i;
  }
  return -1;
}

function onMonk(state: AppState, ev: StoredEvent, at: number): AppState {
  const s = clone(state);
  switch (ev.kind) {
    case 'fault.injected': {
      const d = ev.data;
      if (s.faults.some((f) => f.id === d.faultId)) return state;
      const idx = lastStepIndex(s, (st) => st.tool === d.tool && st.faultId === null && !st.folded);
      s.faults = [...s.faults, { id: d.faultId, type: d.faultType, tool: d.tool, state: 'pending', steps: null, ms: null, at, stepId: idx >= 0 ? s.items[idx]!.id : null }];
      s.status.faults += 1;
      s.moodFaultAt = at;
      if (idx >= 0) {
        patchStep(s, idx, { state: 'fault', faultType: d.faultType, faultId: d.faultId, text: faultPhrase(d.faultType, d.tool), detail: d.faultType, detailTone: 'ink' });
      }
      return s;
    }
    case 'fault.recovered': {
      const d = ev.data;
      const fi = s.faults.findIndex((f) => f.id === d.faultId);
      if (fi < 0) return state;
      const f = { ...s.faults[fi]!, state: 'recovered' as const, steps: d.steps, ms: d.ms };
      s.faults = s.faults.map((x, i) => (i === fi ? f : x));
      s.status.recovered += 1;
      const faultIdx = s.items.findIndex((it) => it.id === f.stepId);
      if (faultIdx < 0) return s;
      if (d.steps >= 3) return foldIntoCard(s, faultIdx, f.type, d.faultId, d.steps, d.ms, at, 'recovered');
      // Mark the step that got things going again.
      for (let i = s.items.length - 1; i > faultIdx; i--) {
        const it = s.items[i]!;
        if (it.kind === 'step' && it.state === 'done') {
          patchStep(s, i, { detail: 'recovered', detailTone: 'ok' });
          break;
        }
      }
      return s;
    }
    case 'fault.unrecovered': {
      const d = ev.data;
      const fi = s.faults.findIndex((f) => f.id === d.faultId);
      if (fi < 0) return state;
      const f = { ...s.faults[fi]!, state: 'failed' as const };
      s.faults = s.faults.map((x, i) => (i === fi ? f : x));
      const faultIdx = s.items.findIndex((it) => it.id === f.stepId);
      if (faultIdx >= 0) return foldIntoCard(s, faultIdx, f.type, d.faultId, 3, null, at, 'failed');
      return s;
    }
    case 'skill.used': {
      const name = ev.data.name;
      s.sessionSkills = { ...s.sessionSkills, [name]: 'using' };
      // Earlier "using" skills are done now.
      for (const [k, v] of Object.entries(s.sessionSkills)) if (k !== name && v === 'using') s.sessionSkills[k] = 'used';
      // The ↳ line explains a recovery, so it only appears under a fault that has none yet.
      const faultIdx = lastStepIndex(s, (st) => st.state === 'fault');
      if (faultIdx < 0) return s;
      const faultId = s.items[faultIdx]!.id;
      if (s.items.some((it) => it.kind === 'skill' && it.stepId === faultId)) return s;
      const line: Item = { kind: 'skill', id: nextId(s, 'k'), name, detail: s.skillNotes[name] ?? null, stepId: faultId };
      s.items.splice(faultIdx + 1, 0, line);
      return s;
    }
    case 'skill.drafted':
      s.learning = ev.data.name;
      return s;
    case 'skill.committed': {
      if (s.learning === ev.data.name) s.learning = null;
      const exists = s.skills.find((k) => k.name === ev.data.name);
      if (exists) s.skills = s.skills.map((k) => (k.name === ev.data.name ? { ...k, version: ev.data.version } : k));
      else
        s.skills = [
          { name: ev.data.name, type: 'recovery', version: ev.data.version, verified: false, checking: true, status: 'active', winRate: null, uses: 0, wins: 0, isNew: true, description: '', generation: s.status.generation },
          ...s.skills,
        ];
      return s;
    }
    case 'skill.verified':
      s.skills = s.skills.map((k) => (k.name === ev.data.name ? { ...k, verified: ev.data.kept, checking: false } : k));
      return s;
    case 'skill.discarded':
      if (s.learning === ev.data.name) s.learning = null;
      s.skills = s.skills.filter((k) => k.name !== ev.data.name);
      return s;
    case 'skill.retired':
      s.skills = s.skills.map((k) => (k.name === ev.data.name ? { ...k, status: 'retired' as const, winRate: ev.data.winRate } : k));
      return s;
    case 'chaos.config':
      s.status.chaosEnabled = ev.data.enabled;
      s.status.profile = ev.data.profile;
      s.status.faultRate = ev.data.faultRate;
      return s;
    case 'session.cost':
      if (ev.data.tfSessionId !== s.sessionId) return state;
      s.status.costUsd += ev.data.costUsd;
      return s;
    default:
      return state;
  }
}

function foldIntoCard(s: AppState, faultIdx: number, type: string, faultId: string, steps: number, ms: number | null, at: number, outcome: 'recovered' | 'failed'): AppState {
  const fault = s.items[faultIdx] as StepItem;
  const note = s.faultNotes[type];
  let skill: string | null = null;
  const recovery: string[] = [];
  let lastFolded = faultIdx;
  for (let i = faultIdx + 1; i < s.items.length; i++) {
    const it = s.items[i]!;
    if (it.kind === 'skill' && it.stepId === fault.id) {
      skill = it.name;
      lastFolded = i;
    } else if (it.kind === 'step' && !it.folded && it.threadId === fault.threadId) {
      recovery.push(it.text);
      lastFolded = i;
      if (recovery.length >= steps) break;
    }
  }
  const card: CardItem = {
    kind: 'card',
    id: nextId(s, 'c'),
    faultId,
    faultType: type,
    seed: s.status.seed,
    title: fault.text,
    saw: note?.saw ?? `${type}${fault.result ? ` · ${fault.result.slice(0, 50)}` : ''}`,
    skill,
    steps: note?.steps ?? recovery,
    outcome,
    ms,
    at,
    doneAt: at,
  };
  // Replace the fault step and its recovery run with the card.
  s.items.splice(faultIdx, lastFolded - faultIdx + 1, card);
  return s;
}

// ---------------------------------------------------------------------------------------------

function onExtra(state: AppState, ev: Extra, at: number): AppState {
  const s = clone(state);
  switch (ev.kind) {
    case 'session':
      s.sessionId = ev.id;
      return s;
    case 'reset': {
      const fresh = initialState(at);
      return { ...fresh, status: { ...s.status, costUsd: 0, faults: 0, recovered: 0 }, skills: s.skills, skillPreviews: s.skillPreviews, sessions: s.sessions, ui: { ...fresh.ui, history: s.ui.history } };
    }
    case 'status':
      s.status = { ...s.status, ...ev.patch, connections: { ...s.status.connections, ...(ev.patch.connections ?? {}) } };
      return s;
    case 'skills':
      s.skills = ev.skills;
      return s;
    case 'skill.preview':
      s.skillPreviews = { ...s.skillPreviews, [ev.preview.name]: ev.preview };
      return s;
    case 'sessions':
      s.sessions = ev.sessions;
      return s;
    case 'plan':
      s.plan = ev.steps;
      return s;
    case 'step.label': {
      const idx = stepIndexByCall(s, ev.callId);
      if (idx < 0) return state;
      const st = s.items[idx] as StepItem;
      const patch: Partial<StepItem> = {};
      if (st.state === 'running' && ev.doing) patch.text = ev.doing;
      if (st.state !== 'running' && st.state !== 'fault' && ev.done) patch.text = ev.done;
      if (ev.done) patch.doneLabel = ev.done;
      if (ev.detail !== undefined) patch.detail = ev.detail;
      if (ev.detailTone) patch.detailTone = ev.detailTone;
      if (ev.owner) patch.owner = ev.owner;
      if (ev.evidence) patch.evidence = ev.evidence;
      patchStep(s, idx, patch);
      return s;
    }
    case 'sandbox.start': {
      const idx = stepIndexByCall(s, ev.callId);
      if (idx < 0) return state;
      patchStep(s, idx, {
        sandbox: true,
        run: {
          where: ev.where,
          lines: [{ text: `$ ${ev.command}`, tone: 'cmd' }],
          testsTotal: ev.testsTotal ?? null,
          testsPassed: 0,
          testsFailed: 0,
          cpu: '',
          exited: false,
          exitCode: null,
          scroll: 0,
          following: true,
        },
      });
      return s;
    }
    case 'sandbox.line': {
      const idx = stepIndexByCall(s, ev.callId);
      const st = idx >= 0 ? (s.items[idx] as StepItem) : null;
      if (!st?.run) return state;
      const run = { ...st.run, lines: [...st.run.lines, ev.line] };
      if (ev.line.tone === 'ok') run.testsPassed += 1;
      if (ev.line.tone === 'fail') run.testsFailed += 1;
      const progress = run.testsTotal ? { done: run.testsPassed, total: run.testsTotal, label: 'passed' } : st.progress;
      patchStep(s, idx, { run, progress });
      return s;
    }
    case 'sandbox.stats': {
      const idx = stepIndexByCall(s, ev.callId);
      const st = idx >= 0 ? (s.items[idx] as StepItem) : null;
      if (!st?.run) return state;
      patchStep(s, idx, { run: { ...st.run, cpu: ev.cpu } });
      return s;
    }
    case 'sandbox.exit': {
      const idx = stepIndexByCall(s, ev.callId);
      const st = idx >= 0 ? (s.items[idx] as StepItem) : null;
      if (!st?.run) return state;
      patchStep(s, idx, { run: { ...st.run, exited: true, exitCode: ev.code } });
      return s;
    }
    case 'progress': {
      const idx = stepIndexByCall(s, ev.callId);
      if (idx < 0) return state;
      patchStep(s, idx, { progress: { done: ev.done, total: ev.total, label: ev.label } });
      return s;
    }
    case 'phone.frame':
      s.phone = { ...s.phone, frame: ev.frame, frameAt: at, clock: ev.clock ?? s.phone.clock };
      return s;
    case 'phone.tap':
      s.phone = { ...s.phone, lastTap: { col: ev.col, row: ev.row, label: ev.label } };
      return s;
    case 'phone.device':
      s.phone = { ...s.phone, device: ev.device, api: ev.api, screenW: ev.screenW, screenH: ev.screenH };
      return s;
    case 'diagram':
      s.items.push({ kind: 'diagram', id: nextId(s, 'd'), data: ev.data, at });
      return s;
    case 'milestone':
      s.items.push({ kind: 'milestone', id: nextId(s, 'ms'), text: ev.text });
      // It hides everything above it, so a place held back in that history is gone: follow again.
      s.ui = { ...s.ui, scroll: FOLLOW };
      return s;
    case 'skill.note':
      s.skillNotes = { ...s.skillNotes, [ev.name]: ev.detail };
      s.items = s.items.map((it) => (it.kind === 'skill' && it.name === ev.name && it.detail === null ? { ...it, detail: ev.detail } : it));
      return s;
    case 'skill.loaded':
      if (s.sessionSkills[ev.name]) return state;
      s.sessionSkills = { ...s.sessionSkills, [ev.name]: 'loaded' };
      return s;
    case 'fault.note':
      s.faultNotes = { ...s.faultNotes, [ev.faultType]: { saw: ev.saw, ...(ev.steps ? { steps: ev.steps } : {}) } };
      return s;
    case 'approval.context':
      if (!s.approval) return state;
      s.approval = {
        ...s.approval,
        ...(ev.alsoOn !== undefined ? { alsoOn: ev.alsoOn } : {}),
        ...(ev.evidence ? { evidence: ev.evidence } : {}),
        ...(ev.evidenceShort ? { evidenceShort: ev.evidenceShort } : {}),
        ...(ev.actions ? { actions: ev.actions } : {}),
      };
      return s;
    case 'approved.remote':
      if (!s.approval) return state;
      s.approval = null;
      s.items.push({ kind: 'note', id: nextId(s, 'n'), glyph: '◆', text: `${ev.allowed ? 'approved' : 'declined'} on ${ev.platform}`, tone: 'gate', at });
      return s;
    case 'error':
      s.error = ev.message;
      return s;
    case 'note':
      s.items.push({ kind: 'note', id: nextId(s, 'n'), glyph: ev.glyph, text: ev.text, tone: ev.tone, at });
      return s;
  }
}
