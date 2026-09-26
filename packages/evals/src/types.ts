import type { MonkConfig, MonkDb, TrueForge, TurnEvent, ToolCallInfo } from '@monk/shared';
import type { GitHubApi } from './github/api.ts';
import type { Adb } from './mobile/adb.ts';

export type Suite = 'github' | 'mobile';
export type Split = 'learn' | 'heldout';

/** Ids of seeded fixtures, so prompts and checkers never hard-code issue numbers. */
export type FixtureIds = {
  issues: Record<string, number>;
  pulls: Record<string, number>;
  branches: Record<string, string>;
  tag: string | null;
  defaultBranch: string;
  seededAt: string;
};

export type PromptContext = {
  repo: { owner: string; name: string };
  fixtures: FixtureIds;
};

export type TaskContext = PromptContext & {
  gh: GitHubApi | null;
  adb: Adb | null;
  /** Final answer text of the last completed turn. */
  answer: string;
  events: TurnEvent[];
  startedAt: Date;
};

export type CheckResult = { passed: boolean; detail: string };

export type Task = {
  id: string;
  suite: Suite;
  split: Split;
  title: string;
  prompt(ctx: PromptContext): string;
  /** Must pause for approval before its irreversible step. */
  destructive: boolean;
  /** Extra globs (beyond DESTRUCTIVE_TOOL_GLOBS) that count as destructive for this task. */
  expectedApprovalTools?: string[];
  /** Finer destructive test for tools whose effect depends on args (e.g. update_issue with state=closed). */
  isDestructiveCall?(call: ToolCallInfo): boolean;
  check(ctx: TaskContext): Promise<CheckResult>;
};

/** Minimal slice of @monk/chaos-proxy's ChaosControl the runner needs. */
export type ChaosSetter = {
  set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }): Promise<unknown>;
};

export type LearnVariant = 'full' | 'no_verify' | 'random' | 'no_retire';

/** Same shape as @monk/learn's `runLearning`, plus the fault types held back for the stress test. */
export type Learner = (opts: {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  tfSessionIds: string[];
  generation: number;
  variant?: LearnVariant;
  verifier?: Verifier;
  excludeFaultTypes?: string[];
}) => Promise<unknown>;

/** The fields of @monk/learn's DraftSkill the verifier reads. */
export type DraftSkillLike = { name: string; sourceSessions: string[] };

export type VerificationResult = {
  kept: boolean;
  baselinePass: number;
  withSkillPass: number;
  baselineSteps: number;
  withSkillSteps: number;
};

export type Verifier = (skill: DraftSkillLike) => Promise<VerificationResult>;

/**
 * Runs `fn` with `names` added to the agent's skills[] (registered with TrueForge), then restores
 * the previous set. Provided by the CLI, which owns skill registration.
 */
export type WithSkills = <T>(names: string[], fn: () => Promise<T>) => Promise<T>;

export type TaskResult = {
  taskId: string;
  split: Split;
  passed: boolean;
  detail: string;
  tfSessionId: string | null;
  steps: number;
  faultsInjected: number;
  faultsRecovered: number;
  meanRecoverySteps: number | null;
  meanRecoveryMs: number | null;
  approvalsRequested: number;
  approvalsRequired: number;
  destructiveUnapproved: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wallMs: number;
  skillsLoaded: string[];
  error: string | null;
};

export type EvalRunSummary = {
  runId: string;
  benchId: string | null;
  suite: Suite;
  profile: string;
  seed: number;
  generation: number;
  variant: string;
  results: TaskResult[];
  summary: Record<string, number>;
};
