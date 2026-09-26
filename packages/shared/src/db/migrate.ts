// Hand-written DDL kept in step with schema.ts; the schema test checks every column exists.
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    kind TEXT NOT NULL,
    session_id TEXT,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_kind ON events(kind)`,
  `CREATE TABLE IF NOT EXISTS mcp_sessions (
    mcp_session_id TEXT PRIMARY KEY,
    tf_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    mcp_session_id TEXT NOT NULL,
    upstream TEXT NOT NULL,
    tool TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    fault_id TEXT,
    call_index INTEGER,
    error_class TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS tool_calls_session ON tool_calls(mcp_session_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS faults (
    id TEXT PRIMARY KEY,
    mcp_session_id TEXT NOT NULL,
    upstream TEXT NOT NULL,
    tool TEXT NOT NULL,
    fault_type TEXT NOT NULL,
    profile TEXT NOT NULL,
    seed INTEGER NOT NULL,
    injected_at TEXT NOT NULL,
    recovered_at TEXT,
    recovery_steps INTEGER,
    outcome TEXT NOT NULL DEFAULT 'pending',
    manual INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS faults_session ON faults(mcp_session_id)`,
  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    fault_types TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    source_sessions TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    verified INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    generation INTEGER NOT NULL DEFAULT 0,
    commit_sha TEXT,
    verification TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS skill_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT NOT NULL,
    tf_session_id TEXT NOT NULL,
    succeeded INTEGER,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    active_session_id TEXT,
    agent_name TEXT NOT NULL DEFAULT 'monk',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (platform, chat_id)
  )`,
  `CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    agent TEXT NOT NULL DEFAULT 'monk',
    prompt TEXT NOT NULL,
    deliver_to TEXT NOT NULL,
    chaos_profile TEXT,
    kind TEXT NOT NULL DEFAULT 'prompt',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    bench_id TEXT,
    suite TEXT NOT NULL,
    profile TEXT NOT NULL,
    seed INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    variant TEXT NOT NULL DEFAULT 'full',
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    summary TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    split TEXT NOT NULL,
    passed INTEGER NOT NULL,
    tf_session_id TEXT,
    faults_injected INTEGER NOT NULL DEFAULT 0,
    faults_recovered INTEGER NOT NULL DEFAULT 0,
    mean_recovery_steps REAL,
    mean_recovery_ms REAL,
    approvals_requested INTEGER NOT NULL DEFAULT 0,
    approvals_required INTEGER NOT NULL DEFAULT 0,
    destructive_unapproved INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    wall_ms INTEGER NOT NULL DEFAULT 0,
    skills_loaded TEXT NOT NULL DEFAULT '[]',
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS eval_results_run ON eval_results(run_id)`,
];

/** Columns added after a table first shipped; applied with ALTER TABLE when missing. */
export const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'tool_calls', column: 'call_index', ddl: 'INTEGER' },
  { table: 'tool_calls', column: 'error_class', ddl: 'TEXT' },
];
