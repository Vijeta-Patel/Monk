import type { CronJobRow, MonkConfig, MonkDb } from '@monk/shared';
import { createJob, deleteJob, listJobs } from './jobs.ts';
import { nextRuns, parseJobRequest, type Llm } from './schedule.ts';

export { startCron, describeCall, type CronScheduler, type Deliver, type RunResult, type StartCronOptions } from './scheduler.ts';
export {
  parseSchedule,
  parseJobRequest,
  parseScheduleRules,
  describeCron,
  validateCron,
  nextRuns,
  proxyScheduleLlm,
  type Llm,
  type ParsedSchedule,
  type ParsedJobRequest,
} from './schedule.ts';
export { createJob, listJobs, deleteJob, getJob, setEnabled, toRow, type NewJob, type JobRecord } from './jobs.ts';

export type CronDraft = {
  cron: string;
  human: string;
  prompt: string;
  timezone: string;
  kind: 'prompt' | 'chaos_drill';
  chaosProfile: string | null;
  nextRuns: string[];
};

/**
 * The object the channels gateway takes as its `cron` option (structurally its CronApi), so chat
 * can parse, confirm, save and remove jobs without channels depending on this package.
 */
export function createCronApi(opts: { db: MonkDb; cfg: MonkConfig; llm?: Llm; reload: () => Promise<void> }) {
  const tz = opts.cfg.TIMEZONE;
  return {
    async parse(text: string): Promise<CronDraft> {
      const r = await parseJobRequest(text, opts.llm);
      return { ...r, timezone: tz, nextRuns: nextRuns(r.cron, tz, 3).map((d) => d.toISOString()) };
    },
    async create(job: CronDraft & { deliverTo: { platform: string; chatId: string }; agent: string }): Promise<{ id: string }> {
      const row = await createJob(opts.db, {
        schedule: job.cron,
        timezone: job.timezone,
        agent: job.agent,
        prompt: job.prompt,
        deliverTo: job.deliverTo,
        kind: job.kind,
        chaosProfile: job.chaosProfile,
      });
      return { id: row.id };
    },
    list: (): Promise<CronJobRow[]> => listJobs(opts.db),
    remove: (id: string): Promise<boolean> => deleteJob(opts.db, id),
    reload: opts.reload,
  };
}
