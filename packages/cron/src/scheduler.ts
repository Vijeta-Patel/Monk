import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import {
  publish,
  redact,
  runMonkTurn,
  schema,
  type MonkConfig,
  type MonkDb,
  type ToolCallInfo,
  type TrueForge,
  type TurnEvent,
  type TurnInput,
} from '@monk/shared';
import { getJob, type JobRecord } from './jobs.ts';

export type Deliver = (to: { platform: string; chatId: string }, text: string) => Promise<void>;

export type StartCronOptions = {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  deliver: Deliver;
  runDrill?: (profile: string) => Promise<string>;
  /** Wall-clock cap per run; the TrueForge session is cancelled when it hits. */
  runTimeoutMs?: number;
};

export type RunResult = { status: 'ok' | 'error' | 'skipped'; text: string; blocked: string[] };

export type CronScheduler = {
  close(): Promise<void>;
  reload(): Promise<void>;
  /** Runs a job now, with the same no-overlap rule as scheduled runs. */
  runNow(id: string): Promise<RunResult>;
  /** Scheduled jobs and their next run. */
  scheduled(): { id: string; next: Date | null }[];
};

const UNATTENDED_REASON = 'Unattended scheduled run: nobody is here to approve this. Do not retry; report what you would have done.';
const UNATTENDED_ANSWER = 'Nobody is watching this scheduled run. Pick the safest reasonable option, say which one you picked, and continue.';
const MAX_ROUNDS = 6;

function preamble(job: JobRecord): string {
  return `[scheduled job "${job.name}", unattended: no one can approve irreversible actions or answer questions during this run. Finish with a short report.]\n\n`;
}

/** "merge pull request · acme/app #12" from a tool call, for the blocked list. */
export function describeCall(c: ToolCallInfo): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(c.args) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    /* no args */
  }
  const s = (k: string) => (typeof args[k] === 'string' || typeof args[k] === 'number' ? String(args[k]) : null);
  const repo = s('owner') && s('repo') ? `${s('owner')}/${s('repo')}` : s('repo');
  const num = s('pull_number') ?? s('pullNumber') ?? s('issue_number') ?? s('number');
  const target = [repo, num ? `#${num}` : null, s('tag') ?? s('tag_name'), s('branch'), s('packageName') ?? s('app')].filter(Boolean).join(' ');
  const name = c.name.replace(/^.*__/, '').replace(/[_-]+/g, ' ');
  return target ? `${name} · ${target}` : name;
}

export async function startCron(opts: StartCronOptions): Promise<CronScheduler> {
  const { db, client, cfg, deliver } = opts;
  const tasks = new Map<string, Cron>();
  const busy = new Set<string>();
  const timeoutMs = opts.runTimeoutMs ?? 15 * 60_000;

  async function runPrompt(job: JobRecord): Promise<{ output: string; blocked: string[] }> {
    const { data: session } = await client.sessions.create({ agent: { name: job.agent }, metadata: { monk_client: 'cron' } });
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      void client.sessions.cancel(session.id).catch(() => {});
    }, timeoutMs);
    const blocked: string[] = [];
    let output = '';
    let input: TurnInput = { kind: 'message', content: preamble(job) + job.prompt };
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const approvals: ToolCallInfo[] = [];
        const questions: ToolCallInfo[] = [];
        let done: Extract<TurnEvent, { type: 'turn.done' }> | null = null;
        for await (const ev of runMonkTurn({ db, client, cfg }, session.id, input, { signal: ac.signal })) {
          if (ev.type === 'approval.required') approvals.push(...ev.calls);
          else if (ev.type === 'question') questions.push(...ev.calls);
          else if (ev.type === 'turn.done') done = ev;
        }
        if (!done) throw new Error('the stream ended early');
        if (done.status === 'error') throw new Error(done.error ?? 'the turn failed');
        if (done.status === 'cancelled') throw new Error(ac.signal.aborted ? `timed out after ${Math.round(timeoutMs / 60_000)} min` : 'cancelled');
        if (done.output.trim()) output = done.output.trim();
        if (done.status !== 'paused') break;
        if (approvals.length) {
          blocked.push(...approvals.map(describeCall));
          input = { kind: 'approvals', decisions: approvals.map((c) => ({ threadId: c.threadId, callId: c.callId, allow: false, reason: UNATTENDED_REASON })) };
        } else if (questions.length) {
          input = { kind: 'answers', answers: questions.map((q) => ({ threadId: q.threadId, callId: q.callId, content: UNATTENDED_ANSWER })) };
        } else break;
      }
    } finally {
      clearTimeout(timer);
    }
    return { output, blocked };
  }

  async function runJob(id: string): Promise<RunResult> {
    const job = await getJob(db, id);
    if (!job) return { status: 'error', text: `no job ${id}`, blocked: [] };
    if (busy.has(id)) {
      await publish(db, { kind: 'cron.run', data: { jobId: id, name: job.name, status: 'skipped', detail: 'previous run still going' } });
      return { status: 'skipped', text: '', blocked: [] };
    }
    busy.add(id);
    const startedAt = new Date().toISOString();
    await publish(db, { kind: 'cron.run', data: { jobId: id, name: job.name, status: 'started' } });
    let result: RunResult;
    try {
      if (job.kind === 'chaos_drill') {
        if (!opts.runDrill) throw new Error('chaos drills need the eval runner (monk up with evals)');
        const profile = job.chaosProfile ?? cfg.CHAOS_PROFILE;
        const summary = await opts.runDrill(profile);
        result = { status: 'ok', text: `◆ **chaos drill** · ${profile}\n${summary.trim()}`, blocked: [] };
      } else {
        const { output, blocked } = await runPrompt(job);
        const parts = [`◆ **${job.name}** · scheduled run`, output || 'no output.'];
        if (blocked.length) {
          parts.push(`blocked, needs your ok:\n${blocked.map((b) => `✗ ${b}`).join('\n')}\nask me in chat to do it with you watching.`);
        }
        result = { status: 'ok', text: parts.join('\n\n'), blocked };
      }
    } catch (err) {
      result = { status: 'error', text: `✗ **${job.name}** failed · ${(err as Error).message}`, blocked: [] };
    } finally {
      busy.delete(id);
    }

    result.text = redact(result.text);
    try {
      await deliver(job.deliverTo, result.text);
    } catch (err) {
      console.error(`[cron] delivery to ${job.deliverTo.platform}:${job.deliverTo.chatId} failed:`, (err as Error).message);
    }
    await db.update(schema.cronJobs).set({ lastRun: startedAt, lastStatus: result.status }).where(eq(schema.cronJobs.id, id));
    const detail = result.status === 'error' ? result.text.slice(0, 300) : result.blocked.length ? `${result.blocked.length} blocked` : undefined;
    await publish(db, { kind: 'cron.run', data: { jobId: id, name: job.name, status: result.status, ...(detail ? { detail } : {}) } });
    return result;
  }

  function stopAll(): void {
    for (const t of tasks.values()) t.stop();
    tasks.clear();
  }

  async function reload(): Promise<void> {
    stopAll();
    const jobs = await db.select().from(schema.cronJobs).where(eq(schema.cronJobs.enabled, true));
    for (const job of jobs) {
      try {
        const task = new Cron(job.schedule, { timezone: job.timezone || cfg.TIMEZONE, mode: '5-part', catch: true }, () => {
          void runJob(job.id).catch((err) => console.error(`[cron] ${job.id}:`, (err as Error).message));
        });
        tasks.set(job.id, task);
      } catch (err) {
        console.error(`[cron] skipping ${job.id} (${job.schedule}):`, (err as Error).message);
      }
    }
  }

  await reload();

  return {
    reload,
    runNow: runJob,
    async close() {
      stopAll();
    },
    scheduled: () => [...tasks.entries()].map(([id, t]) => ({ id, next: t.nextRun() })),
  };
}
