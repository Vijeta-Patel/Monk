import type { TurnEvent } from '@monk/shared/trueforge';
import type { StoredEvent } from '@monk/shared/events';
import type {
  ApprovalAction,
  OverlapDiagram,
  PlanStep,
  SandboxLine,
  SessionSummary,
  SkillInfo,
  SkillPreview,
  Status,
} from './types.ts';

/** Things a backend knows that TurnEvents and Monk events do not carry. */
export type Extra =
  | { kind: 'session'; id: string | null }
  | { kind: 'status'; patch: Partial<Status> }
  | { kind: 'skills'; skills: SkillInfo[] }
  | { kind: 'skill.preview'; preview: SkillPreview }
  | { kind: 'sessions'; sessions: SessionSummary[] }
  | { kind: 'plan'; steps: PlanStep[] }
  | { kind: 'step.label'; callId: string; doing?: string; done?: string; detail?: string | null; detailTone?: 'ink' | 'muted' | 'ok'; owner?: string; evidence?: string; short?: string }
  | { kind: 'sandbox.start'; callId: string; where: string; command: string; testsTotal?: number }
  | { kind: 'sandbox.line'; callId: string; line: SandboxLine }
  | { kind: 'sandbox.stats'; callId: string; cpu: string }
  | { kind: 'sandbox.exit'; callId: string; code: number }
  | { kind: 'progress'; callId: string; done: number; total: number; label: string }
  | { kind: 'phone.frame'; frame: { w: number; h: number; px: string[] }; clock?: string }
  | { kind: 'phone.tap'; col: number; row: number; label: string }
  | { kind: 'phone.device'; device: string; api: number; screenW: number; screenH: number }
  | { kind: 'diagram'; data: OverlapDiagram }
  | { kind: 'milestone'; text: string }
  | { kind: 'skill.note'; name: string; detail: string }
  | { kind: 'skill.loaded'; name: string }
  | { kind: 'fault.note'; faultType: string; saw: string; steps?: string[] }
  | { kind: 'approval.context'; alsoOn?: string | null; evidence?: string[]; evidenceShort?: string[]; actions?: ApprovalAction[] }
  | { kind: 'approved.remote'; platform: string; allowed: boolean }
  | { kind: 'error'; message: string | null }
  | { kind: 'note'; glyph: string; text: string; tone: 'faint' | 'ok' | 'fail' | 'gate' | 'muted' }
  | { kind: 'reset' };

export type Action =
  | { type: 'turn'; ev: TurnEvent; at: number }
  | { type: 'monk'; ev: StoredEvent; at: number }
  | { type: 'extra'; ev: Extra; at: number }
  | { type: 'send'; text: string; at: number };
