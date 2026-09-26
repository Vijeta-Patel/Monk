import type { ToolCallInfo } from '@monk/shared/trueforge';

export type Owner = string;

export type StepState = 'running' | 'done' | 'failed' | 'fault';

export type SandboxLine = { text: string; tone: 'cmd' | 'muted' | 'ok' | 'fail' | 'ink' };

export type SandboxRun = {
  where: string;
  lines: SandboxLine[];
  testsTotal: number | null;
  testsPassed: number;
  testsFailed: number;
  cpu: string;
  exited: boolean;
  exitCode: number | null;
  /** When the well folded itself (success folds 3 s after exit). */
  scroll: number;
  following: boolean;
};

export type StepItem = {
  kind: 'step';
  id: string;
  callId: string | null;
  threadId: string;
  tool: string;
  server: string | null;
  args: string;
  text: string;
  /** Past-tense label a backend supplied for when the call finishes. */
  doneLabel: string | null;
  detail: string | null;
  detailTone: 'ink' | 'muted' | 'ok';
  sandbox: boolean;
  owner: Owner;
  state: StepState;
  startedAt: number;
  endedAt: number | null;
  faultType: string | null;
  faultId: string | null;
  result: string | null;
  progress: { done: number; total: number; label: string } | null;
  evidence: string | null;
  /** Folded into a chaos card. */
  folded: boolean;
  run: SandboxRun | null;
};

export type SkillLineItem = { kind: 'skill'; id: string; name: string; detail: string | null; stepId: string | null };
export type UserItem = { kind: 'user'; id: string; text: string; at: number };
export type MonkItem = { kind: 'monk'; id: string; threadId: string; text: string; streaming: boolean; at: number };
export type CardItem = {
  kind: 'card';
  id: string;
  faultId: string;
  faultType: string;
  seed: number;
  title: string;
  saw: string;
  skill: string | null;
  steps: string[];
  outcome: 'recovering' | 'recovered' | 'failed';
  ms: number | null;
  at: number;
  doneAt: number | null;
};
export type OverlapDiagram = {
  label: string;
  topY: number;
  barY: number;
  bottomY: number;
  hiddenPx: number;
  button: string;
  text: string;
};
export type DiagramItem = { kind: 'diagram'; id: string; data: OverlapDiagram; at: number };
export type NoteItem = { kind: 'note'; id: string; glyph: string; text: string; tone: 'faint' | 'ok' | 'fail' | 'gate' | 'muted'; at: number };
export type MilestoneItem = { kind: 'milestone'; id: string; text: string };

export type Item = StepItem | SkillLineItem | UserItem | MonkItem | CardItem | DiagramItem | NoteItem | MilestoneItem;

export type PlanStep = { label: string; owner: Owner; state: 'todo' | 'running' | 'done' | 'gate' };

export type FaultEntry = {
  id: string;
  type: string;
  tool: string;
  state: 'pending' | 'recovered' | 'failed';
  steps: number | null;
  ms: number | null;
  at: number;
  stepId: string | null;
};

export type SkillInfo = {
  name: string;
  type: 'recovery' | 'procedure' | 'tool_quirk';
  version: number;
  verified: boolean;
  checking: boolean;
  status: 'draft' | 'active' | 'discarded' | 'retired';
  winRate: number | null;
  uses: number;
  wins: number;
  isNew: boolean;
  description: string;
  generation: number;
};

export type SkillPreview = {
  name: string;
  whenToUse: string[];
  steps: string[];
  history: { sha: string; message: string; age: string }[];
  winHistory: number[];
  learnedFrom: string;
  saves: string | null;
};

export type ApprovalAction = {
  title: string;
  details: string[];
  compact: string;
  call: string;
};

export type ApprovalState = {
  calls: ToolCallInfo[];
  actions: ApprovalAction[];
  evidence: string[];
  evidenceShort: string[];
  alsoOn: string | null;
  openedAt: number;
  stage: 'ask' | 'reason';
  reason: string;
  sent: boolean;
};

export type QuestionState = {
  calls: (ToolCallInfo & { question: string; options: string[] })[];
  selected: number;
  openedAt: number;
};

export type PhoneState = {
  active: boolean;
  threadId: string | null;
  device: string;
  api: number;
  clock: string;
  lastTap: { col: number; row: number; label: string } | null;
  lastAction: string | null;
  /** 22 × 48 pixels, row-major hex colors (top pixel of row r is 2r). */
  frame: { w: number; h: number; px: string[] } | null;
  frameAt: number | null;
  doneAt: number | null;
  screenW: number;
  screenH: number;
};

export type Connection = 'ok' | 'down' | 'unknown';

export type Status = {
  model: string;
  agent: string;
  chaosEnabled: boolean;
  profile: string;
  faultRate: number;
  seed: number;
  profiles: string[];
  generation: number;
  costUsd: number;
  faults: number;
  recovered: number;
  connections: { github: Connection; sandbox: Connection; phone: Connection };
  api: Connection;
  trueforge: Connection;
  channel: string | null;
};

export type SessionSummary = { id: string; title: string; updatedAt: string; platform: string };

export type Popup =
  | { kind: 'palette'; query: string; selected: number }
  | { kind: 'slash'; selected: number }
  | { kind: 'skills'; selected: number; filter: string; filtering: boolean; openedAt: number; reading: boolean }
  | { kind: 'help' }
  | { kind: 'resume'; selected: number }
  | { kind: 'chaos'; selected: number }
  | { kind: 'details'; stepId: string }
  | { kind: 'phone' };

export type Focus = 'input' | 'conversation' | 'sidebar' | 'well' | 'phone';

export type UiState = {
  focus: Focus;
  popup: Popup | null;
  input: { text: string; cursor: number };
  history: string[];
  sidebarOverlay: boolean;
  phoneHidden: boolean;
  selectedStep: string | null;
  wellOpen: string | null;
  inputSince: number;
  bootAt: number;
};

export type TurnState = {
  running: boolean;
  startedAt: number | null;
  turnId: string | null;
  goal: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type AppState = {
  sessionId: string | null;
  items: Item[];
  plan: PlanStep[];
  faults: FaultEntry[];
  skills: SkillInfo[];
  sessionSkills: Record<string, 'loaded' | 'using' | 'used'>;
  skillNotes: Record<string, string>;
  skillPreviews: Record<string, SkillPreview>;
  learning: string | null;
  faultNotes: Record<string, { saw: string; steps?: string[] }>;
  subagents: Record<string, { name: string; role: string; active: boolean }>;
  status: Status;
  turn: TurnState;
  phone: PhoneState;
  approval: ApprovalState | null;
  question: QuestionState | null;
  moodFaultAt: number | null;
  sessions: SessionSummary[];
  error: string | null;
  ui: UiState;
  seq: number;
};
