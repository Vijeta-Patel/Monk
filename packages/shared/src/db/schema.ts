import { sql } from 'drizzle-orm';
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

/** Append-only bus every process tails (dashboard, TUI, channels). */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: text('ts').notNull().default(now),
  kind: text('kind').notNull(),
  sessionId: text('session_id'),
  data: json<Record<string, unknown>>('data').notNull(),
});

/** Chaos proxy MCP session <-> TrueForge session, learned from `mcp.initialize`. */
export const mcpSessions = sqliteTable('mcp_sessions', {
  mcpSessionId: text('mcp_session_id').primaryKey(),
  tfSessionId: text('tf_session_id'),
  createdAt: text('created_at').notNull().default(now),
});

export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  mcpSessionId: text('mcp_session_id').notNull(),
  upstream: text('upstream').notNull(),
  tool: text('tool').notNull(),
  argsHash: text('args_hash').notNull(),
  startedAt: text('started_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  status: text('status', { enum: ['ok', 'error', 'fault'] }).notNull(),
  faultId: text('fault_id'),
  /** 0-based position of this call in its MCP session; drives seeded replay and step counts. */
  callIndex: integer('call_index'),
  /** errorClass() of a real upstream error, so tool quirks can be matched across sessions. */
  errorClass: text('error_class'),
});

export const faults = sqliteTable('faults', {
  id: text('id').primaryKey(),
  mcpSessionId: text('mcp_session_id').notNull(),
  upstream: text('upstream').notNull(),
  tool: text('tool').notNull(),
  faultType: text('fault_type').notNull(),
  profile: text('profile').notNull(),
  seed: integer('seed').notNull(),
  injectedAt: text('injected_at').notNull(),
  recoveredAt: text('recovered_at'),
  /** Tool calls in the session between the fault and the next successful call of the same tool. */
  recoverySteps: integer('recovery_steps'),
  outcome: text('outcome', { enum: ['pending', 'recovered', 'unrecovered'] }).notNull().default('pending'),
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
});

export type SkillType = 'recovery' | 'procedure' | 'tool_quirk';
export type SkillStatus = 'draft' | 'active' | 'discarded' | 'retired';

export const skills = sqliteTable('skills', {
  name: text('name').primaryKey(),
  type: text('type').$type<SkillType>().notNull(),
  description: text('description').notNull(),
  body: text('body').notNull(),
  faultTypes: json<string[]>('fault_types').notNull().default([]),
  tools: json<string[]>('tools').notNull().default([]),
  sourceSessions: json<string[]>('source_sessions').notNull().default([]),
  version: integer('version').notNull().default(1),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  status: text('status').$type<SkillStatus>().notNull().default('draft'),
  generation: integer('generation').notNull().default(0),
  commitSha: text('commit_sha'),
  verification: json<Record<string, unknown>>('verification'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const skillUses = sqliteTable('skill_uses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillName: text('skill_name').notNull(),
  tfSessionId: text('tf_session_id').notNull(),
  succeeded: integer('succeeded', { mode: 'boolean' }),
  at: text('at').notNull().default(now),
});

export const users = sqliteTable('users', {
  userId: text('user_id').primaryKey(),
  activeSessionId: text('active_session_id'),
  agentName: text('agent_name').notNull().default('monk'),
  createdAt: text('created_at').notNull().default(now),
});

export const links = sqliteTable(
  'links',
  {
    platform: text('platform').notNull(),
    chatId: text('chat_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.platform, t.chatId] })],
);

export const linkCodes = sqliteTable('link_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const cronJobs = sqliteTable('cron_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schedule: text('schedule').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  agent: text('agent').notNull().default('monk'),
  prompt: text('prompt').notNull(),
  deliverTo: json<{ platform: string; chatId: string }>('deliver_to').notNull(),
  chaosProfile: text('chaos_profile'),
  kind: text('kind', { enum: ['prompt', 'chaos_drill'] }).notNull().default('prompt'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRun: text('last_run'),
  lastStatus: text('last_status'),
  createdAt: text('created_at').notNull().default(now),
});

export const evalRuns = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  benchId: text('bench_id'),
  suite: text('suite').notNull(),
  profile: text('profile').notNull(),
  seed: integer('seed').notNull(),
  generation: integer('generation').notNull(),
  variant: text('variant').notNull().default('full'),
  startedAt: text('started_at').notNull().default(now),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['running', 'done', 'error', 'cancelled'] }).notNull().default('running'),
  summary: json<Record<string, number>>('summary'),
});

export const evalResults = sqliteTable('eval_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  taskId: text('task_id').notNull(),
  split: text('split', { enum: ['learn', 'heldout'] }).notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  tfSessionId: text('tf_session_id'),
  faultsInjected: integer('faults_injected').notNull().default(0),
  faultsRecovered: integer('faults_recovered').notNull().default(0),
  meanRecoverySteps: real('mean_recovery_steps'),
  meanRecoveryMs: real('mean_recovery_ms'),
  approvalsRequested: integer('approvals_requested').notNull().default(0),
  approvalsRequired: integer('approvals_required').notNull().default(0),
  destructiveUnapproved: integer('destructive_unapproved').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  wallMs: integer('wall_ms').notNull().default(0),
  skillsLoaded: json<string[]>('skills_loaded').notNull().default([]),
  error: text('error'),
});
