import { asc, eq } from 'drizzle-orm';
import { newId, schema, type CronJobRow, type MonkDb } from '@monk/shared';
import { nextRuns, validateCron } from './schedule.ts';

export type JobRecord = typeof schema.cronJobs.$inferSelect;

export type NewJob = {
  name?: string;
  schedule: string;
  timezone?: string;
  agent?: string;
  prompt: string;
  deliverTo: { platform: string; chatId: string };
  kind?: 'prompt' | 'chaos_drill';
  chaosProfile?: string | null;
  enabled?: boolean;
};

function defaultName(job: NewJob): string {
  if (job.kind === 'chaos_drill') return `chaos drill${job.chaosProfile ? ` · ${job.chaosProfile}` : ''}`;
  const p = job.prompt.replace(/\s+/g, ' ').trim();
  return p.length > 48 ? `${p.slice(0, 47)}…` : p || 'scheduled job';
}

export function toRow(j: JobRecord): CronJobRow {
  let next: string | null = null;
  if (j.enabled) {
    try {
      next = nextRuns(j.schedule, j.timezone, 1)[0]?.toISOString() ?? null;
    } catch {
      next = null;
    }
  }
  return {
    id: j.id,
    name: j.name,
    schedule: j.schedule,
    timezone: j.timezone,
    prompt: j.prompt,
    kind: j.kind,
    deliverTo: j.deliverTo,
    chaosProfile: j.chaosProfile,
    enabled: j.enabled,
    lastRun: j.lastRun,
    lastStatus: j.lastStatus,
    nextRun: next,
  };
}

export async function createJob(db: MonkDb, job: NewJob, defaults: { timezone?: string } = {}): Promise<CronJobRow> {
  validateCron(job.schedule);
  const id = newId('job');
  await db.insert(schema.cronJobs).values({
    id,
    name: job.name?.trim() || defaultName(job),
    schedule: job.schedule.trim(),
    timezone: job.timezone ?? defaults.timezone ?? 'Asia/Kolkata',
    agent: job.agent ?? 'monk',
    prompt: job.prompt,
    deliverTo: job.deliverTo,
    chaosProfile: job.chaosProfile ?? null,
    kind: job.kind ?? 'prompt',
    enabled: job.enabled ?? true,
  });
  return toRow((await getJob(db, id))!);
}

export async function getJob(db: MonkDb, id: string): Promise<JobRecord | null> {
  const [row] = await db.select().from(schema.cronJobs).where(eq(schema.cronJobs.id, id));
  return row ?? null;
}

export async function listJobs(db: MonkDb): Promise<CronJobRow[]> {
  const rows = await db.select().from(schema.cronJobs).orderBy(asc(schema.cronJobs.createdAt));
  return rows.map(toRow);
}

export async function deleteJob(db: MonkDb, id: string): Promise<boolean> {
  if (!(await getJob(db, id))) return false;
  await db.delete(schema.cronJobs).where(eq(schema.cronJobs.id, id));
  return true;
}

export async function setEnabled(db: MonkDb, id: string, enabled: boolean): Promise<boolean> {
  if (!(await getJob(db, id))) return false;
  await db.update(schema.cronJobs).set({ enabled }).where(eq(schema.cronJobs.id, id));
  return true;
}
