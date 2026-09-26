import type { schema } from '@monk/shared';

export type SkillType = (typeof schema.skills.$inferSelect)['type'];

export type Variant = 'full' | 'no_verify' | 'random' | 'no_retire';

export type EpisodeStep = {
  i: number;
  tool: string;
  /** MCP server name, or null for TrueForge built-ins (exec, web_fetch, ...). */
  server: string | null;
  args: string;
  status: 'ok' | 'error' | 'fault';
  fault?: string;
  error?: string;
  errorClass?: string;
};

export type EpisodeFault = {
  id: string;
  tool: string;
  faultType: string;
  outcome: 'pending' | 'recovered' | 'unrecovered';
  recoverySteps: number | null;
  seed: number;
  profile: string;
  /** Index into Episode.steps of the faulted call, when it could be matched. */
  stepIndex: number | null;
};

/** Compact, redacted view of one TrueForge session, sized for an LLM prompt. */
export type Episode = {
  tfSessionId: string;
  task: string;
  steps: EpisodeStep[];
  outcome: 'done' | 'error' | 'cancelled' | 'paused' | 'unknown';
  succeeded: boolean;
  finalOutput: string;
  faults: EpisodeFault[];
  mcpSessionIds: string[];
  skillsUsed: string[];
};

export type SourceRun = { tfSessionId: string; task: string; seed: number | null; profile: string | null };

export type Candidate = {
  type: SkillType;
  /** Stable grouping key, e.g. `recovery:rate_limit`, `quirk:search_issues:http_422`. */
  key: string;
  faultTypes: string[];
  tools: string[];
  sourceSessions: string[];
  sources: SourceRun[];
  /** Rendered episode excerpts that justify the candidate. */
  evidence: string[];
};

export type DraftSkill = {
  name: string;
  type: SkillType;
  description: string;
  steps: string[];
  /** Numbered markdown body written under the frontmatter. */
  body: string;
  faultTypes: string[];
  tools: string[];
  sourceSessions: string[];
  /** Source tasks with their chaos seed, so a verifier can re-run them. */
  sources: SourceRun[];
  version: number;
  generation: number;
  /** Set when this draft is a merge into an existing skill of that name. */
  mergedInto?: string;
};

export type VerificationResult = {
  baselinePass: number;
  withSkillPass: number;
  baselineSteps: number;
  withSkillSteps: number;
  runs?: number;
  reason?: string;
  [k: string]: unknown;
};

export type Verifier = (skill: DraftSkill) => Promise<VerificationResult>;

import type { Llm } from '@monk/shared';
export type { Llm };

export type SkillOutcome = {
  name: string;
  type: SkillType;
  action: 'created' | 'merged' | 'discarded' | 'invalid';
  kept: boolean;
  reason: string;
  version: number;
  commitSha: string | null;
  mergedInto?: string;
  verification?: VerificationResult | null;
};

export type LearningReport = {
  generation: number;
  variant: Variant;
  sessions: number;
  counts: {
    drafted: number;
    merged: number;
    verified_kept: number;
    discarded: number;
    committed: number;
    retired: number;
    invalid: number;
  };
  skills: SkillOutcome[];
  /** Skills kept after verification ÷ skills drafted (PRD "skill precision"). */
  precision: number | null;
  retired: string[];
  synced: string[];
  pushed: boolean;
  errors: string[];
};
