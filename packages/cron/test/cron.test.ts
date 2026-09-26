import { describe, expect, it, vi } from 'vitest';
import { loadConfig, openDb, readEvents, schema, type TrueForge, type TrueForgeApi } from '@monk/shared';
import { eq } from 'drizzle-orm';
import {
  createCronApi,
  createJob,
  deleteJob,
  describeCron,
  listJobs,
  nextRuns,
  parseJobRequest,
  parseSchedule,
  startCron,
  validateCron,
  type Llm,
} from '../src/index.ts';

type Raw = TrueForgeApi.TurnStreamingEvent;
const ev = (e: { type: Raw['type'] } & Record<string, unknown>) => ({ createdAt: 'x', threadId: 'main', ...e }) as unknown as Raw;
const done = (extra: Record<string, unknown> = {}) =>
  ev({ type: 'turn.done', id: 'd', threadId: null, state: { status: 'done', completedAt: 'x', output: null, requiredActions: [], ...extra } });
type Step = Raw | (() => Promise<void>);

class FakeTF {
  created: string[] = [];
  turns: { sessionId: string; input: unknown[] }[] = [];
  scripts: Step[][] = [];
  sessions = {
    create: async (req: { agent: { name: string } }) => {
      const id = `ses_${this.created.length + 1}`;
      this.created.push(`${id}:${req.agent.name}`);
      return { data: { id } };
    },
    cancel: async () => ({}),
    createTurnStream: async (sessionId: string, req: { input: unknown[] }) => {
      this.turns.push({ sessionId, input: req.input });
      const script = this.scripts.shift() ?? [ev({ type: 'model.message', id: 'm', content: 'nothing to do.' }), done()];
      return (async function* () {
        for (const s of script) {
          if (typeof s === 'function') await s();
          else yield s;
        }
      })();
    },
  };
  asClient() {
    return this as unknown as TrueForge;
  }
}

function setup() {
  const db = openDb(':memory:');
  const cfg = loadConfig({ env: { TIMEZONE: 'Asia/Kolkata', CHAOS_PROFILE: 'moderate' }, rootDir: '/tmp' });
  const tf = new FakeTF();
  const delivered: { to: { platform: string; chatId: string }; text: string }[] = [];
  const deliver = async (to: { platform: string; chatId: string }, text: string) => {
    delivered.push({ to, text });
  };
  return { db, cfg, tf, delivered, deliver };
}

const to = { platform: 'telegram', chatId: '123' };

describe('parseSchedule (rules)', () => {
  const cases: [string, string, string][] = [
    ['every weekday 9am', '0 9 * * 1-5', 'every weekday at 09:00'],
    ['every weekday at 9:30 am', '30 9 * * 1-5', 'every weekday at 09:30'],
    ['weekdays at 18:00', '0 18 * * 1-5', 'every weekday at 18:00'],
    ['every day at 18:30', '30 18 * * *', 'every day at 18:30'],
    ['daily at 6pm', '0 18 * * *', 'every day at 18:00'],
    ['every monday', '0 9 * * 1', 'every monday at 09:00'],
    ['every monday and thursday at 10am', '0 10 * * 1,4', 'every monday and thursday at 10:00'],
    ['on fridays at 5pm', '0 17 * * 5', 'every friday at 17:00'],
    ['every hour', '0 * * * *', 'every hour'],
    ['hourly', '0 * * * *', 'every hour'],
    ['every 15 minutes', '*/15 * * * *', 'every 15 minutes'],
    ['every 2 hours', '0 */2 * * *', 'every 2 hours'],
    ['every minute', '* * * * *', 'every minute'],
    ['nightly', '0 2 * * *', 'every night at 02:00'],
    ['every night at 11:30pm', '30 23 * * *', 'every night at 23:30'],
    ['at 9am every weekday', '0 9 * * 1-5', 'every weekday at 09:00'],
    ['every day at noon', '0 12 * * *', 'every day at 12:00'],
    ['every day at midnight', '0 0 * * *', 'every day at 00:00'],
    ['every day at 12am', '0 0 * * *', 'every day at 00:00'],
    ['every weekend at 10', '0 10 * * 0,6', 'every weekend day at 10:00'],
    ['monthly on the 15th', '0 9 15 * *', 'every month on day 15 at 09:00'],
    ['every morning', '0 9 * * *', 'every day at 09:00'],
    ['at 7:45', '45 7 * * *', 'every day at 07:45'],
  ];
  it.each(cases)('%s → %s', async (text, cron, human) => {
    expect(await parseSchedule(text)).toEqual({ cron, human });
  });

  it('accepts a raw cron expression', async () => {
    expect(await parseSchedule('0 9 * * 1-5')).toEqual({ cron: '0 9 * * 1-5', human: 'at 09:00, monday through friday' });
  });

  it('splits the task from the schedule', async () => {
    expect(await parseJobRequest('every weekday 9am, summarize open PRs in repo acme/app')).toMatchObject({
      cron: '0 9 * * 1-5',
      prompt: 'summarize open PRs in repo acme/app',
      kind: 'prompt',
    });
    expect(await parseJobRequest('summarize open PRs every day at 18:30')).toMatchObject({ cron: '30 18 * * *', prompt: 'summarize open PRs' });
    expect(await parseJobRequest('every 15 minutes: check the deploy')).toMatchObject({ prompt: 'check the deploy' });
    expect(await parseJobRequest('0 9 * * 1 post the weekly summary')).toMatchObject({ cron: '0 9 * * 1', prompt: 'post the weekly summary' });
  });

  it('recognises chaos drills', async () => {
    expect(await parseJobRequest('nightly chaos drill moderate')).toMatchObject({ cron: '0 2 * * *', kind: 'chaos_drill', chaosProfile: 'moderate' });
    expect(await parseJobRequest('every night at 3am, run a chaos drill')).toMatchObject({ kind: 'chaos_drill', chaosProfile: null });
  });

  it('falls back to the llm and validates its answer', async () => {
    const llm = vi.fn<Llm>(async () => ({ cron: '0 8 1,15 * *', prompt: 'send the invoice reminder' }));
    const r = await parseJobRequest('on the 1st and 15th at 8, send the invoice reminder', llm);
    expect(r).toMatchObject({ cron: '0 8 1,15 * *', prompt: 'send the invoice reminder' });
    expect(r.human).toBe('at 08:00, on day 1 and 15 of the month');
    expect(llm).toHaveBeenCalledOnce();

    await expect(parseSchedule('whenever you like', async () => ({ cron: '99 * * * *', prompt: '' }))).rejects.toThrow(/not a valid cron/);
    await expect(parseSchedule('whenever you like', async () => ({ cron: '', prompt: '' }))).rejects.toThrow(/couldn't find a schedule/);
    await expect(parseSchedule('whenever you like')).rejects.toThrow(/every weekday 9am/);
  });

  it('does not call the llm when rules match', async () => {
    const llm = vi.fn<Llm>();
    await parseSchedule('every hour', llm);
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('validates, describes and lists next runs in the job time zone', () => {
    expect(() => validateCron('0 9 * *')).toThrow(/5-field/);
    expect(() => validateCron('0 25 * * *')).toThrow(/not a valid/);
    expect(describeCron('*/15 * * * *')).toBe('every 15 minutes');
    const runs = nextRuns('0 9 * * 1-5', 'Asia/Kolkata', 2, new Date('2026-09-23T00:00:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual(['2026-09-23T03:30:00.000Z', '2026-09-24T03:30:00.000Z']);
  });

  it('creates, lists and deletes jobs', async () => {
    const { db } = setup();
    const row = await createJob(db, { schedule: '0 9 * * 1-5', prompt: 'summarize open PRs', deliverTo: to });
    expect(row).toMatchObject({ name: 'summarize open PRs', timezone: 'Asia/Kolkata', enabled: true, kind: 'prompt' });
    expect(row.nextRun).not.toBeNull();
    expect(await listJobs(db)).toHaveLength(1);
    await expect(createJob(db, { schedule: 'nope', prompt: 'x', deliverTo: to })).rejects.toThrow();
    expect(await deleteJob(db, row.id)).toBe(true);
    expect(await deleteJob(db, row.id)).toBe(false);
  });

  it('createCronApi matches the gateway flow: parse, create, list, remove', async () => {
    const { db, cfg } = setup();
    let reloads = 0;
    const api = createCronApi({ db, cfg, reload: async () => void reloads++ });
    const draft = await api.parse('every weekday 9am, summarize open PRs in acme/app');
    expect(draft).toMatchObject({ human: 'every weekday at 09:00', timezone: 'Asia/Kolkata', prompt: 'summarize open PRs in acme/app' });
    expect(draft.nextRuns).toHaveLength(3);
    const { id } = await api.create({ ...draft, deliverTo: to, agent: 'monk' });
    await api.reload();
    expect((await api.list()).map((j) => j.id)).toEqual([id]);
    expect(await api.remove(id)).toBe(true);
    expect(reloads).toBe(1);
  });
});

describe('startCron', () => {
  it('schedules enabled jobs in their time zone and reloads', async () => {
    const t = setup();
    const a = await createJob(t.db, { schedule: '0 9 * * 1-5', prompt: 'a', deliverTo: to });
    await createJob(t.db, { schedule: '0 10 * * *', prompt: 'b', deliverTo: to, enabled: false });
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    expect(cron.scheduled().map((s) => s.id)).toEqual([a.id]);
    const next = cron.scheduled()[0]!.next!;
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(next)).toBe('09:00');

    const c = await createJob(t.db, { schedule: '*/5 * * * *', prompt: 'c', deliverTo: to });
    expect(cron.scheduled()).toHaveLength(1);
    await cron.reload();
    expect(cron.scheduled().map((s) => s.id).sort()).toEqual([a.id, c.id].sort());
    await cron.close();
    expect(cron.scheduled()).toHaveLength(0);
  });

  it('runs a fresh session, delivers the output and records the run', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '0 9 * * 1-5', prompt: 'summarize open PRs', deliverTo: to, agent: 'monk' });
    t.tf.scripts.push([ev({ type: 'model.message', id: 'm', content: '3 open PRs. #12 is ready to merge.' }), done()]);
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    const r = await cron.runNow(job.id);
    await cron.runNow(job.id);
    expect(r.status).toBe('ok');
    expect(t.tf.created).toEqual(['ses_1:monk', 'ses_2:monk']); // fresh session per run
    const first = t.tf.turns[0]!.input[0] as { type: string; content: string };
    expect(first.type).toBe('user.message');
    expect(first.content).toMatch(/unattended[\s\S]*summarize open PRs$/);
    expect(t.delivered[0]).toEqual({ to, text: '◆ **summarize open PRs** · scheduled run\n\n3 open PRs. #12 is ready to merge.' });
    const [row] = await t.db.select().from(schema.cronJobs).where(eq(schema.cronJobs.id, job.id));
    expect(row!.lastStatus).toBe('ok');
    expect(row!.lastRun).not.toBeNull();
    const kinds = (await readEvents(t.db)).filter((e) => e.kind === 'cron.run').map((e) => (e.data as { status: string }).status);
    expect(kinds).toEqual(['started', 'ok', 'started', 'ok']);
    await cron.close();
  });

  it('skips a run while the previous one is still going', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '* * * * *', prompt: 'slow', deliverTo: to });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    t.tf.scripts.push([() => gate, ev({ type: 'model.message', id: 'm', content: 'done' }), done()]);
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    const first = cron.runNow(job.id);
    await new Promise((r) => setTimeout(r, 10));
    expect((await cron.runNow(job.id)).status).toBe('skipped');
    release();
    expect((await first).status).toBe('ok');
    expect(t.tf.created).toHaveLength(1);
    const statuses = (await readEvents(t.db)).filter((e) => e.kind === 'cron.run').map((e) => (e.data as { status: string }).status);
    expect(statuses).toEqual(['started', 'skipped', 'ok']);
    expect(t.delivered).toHaveLength(1);
    await cron.close();
  });

  it('denies approvals in unattended runs and reports what was blocked', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '0 9 * * *', prompt: 'merge ready PRs', deliverTo: to });
    t.tf.scripts.push(
      [
        ev({
          type: 'model.message',
          id: 'm1',
          content: 'Merging #12.',
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'merge_pull_request', arguments: JSON.stringify({ owner: 'acme', repo: 'app', pull_number: 12 }) },
              toolInfo: { type: 'mcp', name: 'merge_pull_request', serverId: 's', serverName: 'monk-chaos' },
            },
          ],
        }),
        ev({ type: 'tool.approval_required', id: 'a', toolCalls: [{ id: 'c1', sourceEventId: 'm1' }] }),
        done({ requiredActions: [{}] }),
      ],
      [ev({ type: 'model.message', id: 'm2', content: 'I did not merge #12; it needs your approval.' }), done()],
    );
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    const r = await cron.runNow(job.id);
    expect(t.tf.turns).toHaveLength(2);
    expect(t.tf.turns[1]!.sessionId).toBe(t.tf.turns[0]!.sessionId);
    expect(t.tf.turns[1]!.input).toEqual([
      { type: 'user.tool_approval', threadId: 'main', toolCallId: 'c1', approval: { status: 'deny', reason: expect.stringMatching(/^Unattended scheduled run/) } },
    ]);
    expect(r.blocked).toEqual(['merge pull request · acme/app #12']);
    expect(t.delivered[0]!.text).toContain('I did not merge #12; it needs your approval.');
    expect(t.delivered[0]!.text).toContain('blocked, needs your ok:\n✗ merge pull request · acme/app #12');
    await cron.close();
  });

  it('answers questions itself when nobody is watching', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '0 9 * * *', prompt: 'triage', deliverTo: to });
    t.tf.scripts.push(
      [
        ev({
          type: 'model.message',
          id: 'm1',
          content: '',
          toolCalls: [{ id: 'q1', type: 'function', function: { name: 'ask_user_question', arguments: '{"question":"Which repo?","options":["a","b"]}' } }],
        }),
        ev({ type: 'tool.response_required', id: 'r', toolCalls: [{ id: 'q1', sourceEventId: 'm1' }] }),
        done({ requiredActions: [{}] }),
      ],
      [ev({ type: 'model.message', id: 'm2', content: 'Picked a.' }), done()],
    );
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    await cron.runNow(job.id);
    expect(t.tf.turns[1]!.input).toEqual([{ type: 'user.tool_response', threadId: 'main', toolCallId: 'q1', content: expect.stringMatching(/^Nobody is watching/) }]);
    expect(t.delivered[0]!.text).toContain('Picked a.');
    await cron.close();
  });

  it('delivers failures and records them', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '0 9 * * *', prompt: 'broken', deliverTo: to });
    t.tf.scripts.push([ev({ type: 'turn.done', id: 'd', threadId: null, state: { status: 'error', message: 'model provider down' } })]);
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
    const r = await cron.runNow(job.id);
    expect(r.status).toBe('error');
    expect(t.delivered[0]!.text).toBe('✗ **broken** failed · model provider down');
    const [row] = await t.db.select().from(schema.cronJobs).where(eq(schema.cronJobs.id, job.id));
    expect(row!.lastStatus).toBe('error');
    await cron.close();
  });

  it('runs chaos drills through runDrill and delivers the summary', async () => {
    const t = setup();
    const job = await createJob(t.db, { schedule: '0 2 * * *', prompt: 'chaos drill', kind: 'chaos_drill', chaosProfile: 'pressure', deliverTo: to });
    const runDrill = vi.fn(async (profile: string) => `success 31/38 (82%) under ${profile}`);
    const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver, runDrill });
    await cron.runNow(job.id);
    expect(runDrill).toHaveBeenCalledWith('pressure');
    expect(t.delivered[0]!.text).toBe('◆ **chaos drill** · pressure\nsuccess 31/38 (82%) under pressure');
    expect(t.tf.created).toHaveLength(0);
    await cron.close();
  });

  it('fires on schedule', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-09-23T03:29:50Z')); // 08:59:50 in Kolkata
    try {
      const t = setup();
      await createJob(t.db, { schedule: '0 9 * * *', prompt: 'morning brief', deliverTo: to });
      const cron = await startCron({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, deliver: t.deliver });
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => expect(t.delivered).toHaveLength(1), { interval: 1 });
      await cron.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
