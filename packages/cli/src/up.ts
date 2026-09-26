import { join } from 'node:path';
import { startAgentEyeExporter } from '@monk/agenteye';
import { startChaosProxy } from '@monk/chaos-proxy';
import { startGateway } from '@monk/channels';
import { createCronApi, nextRuns, startCron } from '@monk/cron';
import { computeCurve, type Suite } from '@monk/evals';
import { newId, refreshPricing } from '@monk/shared';
import { startApiServer } from '@monk/server';
import { benchRun } from './bench.ts';
import { log, type Ctx } from './context.ts';

/** Starts the chaos proxy, Monk API + dashboard, channels gateway and cron in one process. */
export async function up(ctx: Ctx, opts: { channels: boolean; cron: boolean }): Promise<() => Promise<void>> {
  const { cfg, db, client } = ctx;
  void refreshPricing(cfg);
  const closers: (() => Promise<void>)[] = [];

  const proxy = await startChaosProxy({ cfg, db });
  closers.push(proxy.close);
  log(`chaos proxy   ${proxy.url}   profile ${proxy.control.state().profile}${cfg.CHAOS_ENABLED ? '' : ' (disabled)'}`);

  let benchBusy = false;
  const cronBox: { reload(): Promise<void> } = { reload: async () => {} };

  const api = await startApiServer({
    db,
    cfg,
    chaos: proxy.control,
    curve: () => computeCurve(db),
    cron: { reload: () => cronBox.reload(), nextRun: (s, tz) => nextRuns(s, tz, 1)[0]?.toISOString() ?? null },
    staticDir: join(cfg.rootDir, 'packages/dashboard/dist'),
    bench: async (req) => {
      if (benchBusy) throw new Error('a benchmark is already running');
      benchBusy = true;
      const suites = req.suite.split(',').map((s) => s.trim()) as Suite[];
      const benchId = newId('bench');
      benchRun(ctx, proxy.control, { suites, profile: req.profile, seeds: req.seeds, generations: req.generations, benchId }, () => {})
        .catch((err: unknown) => log(`bench failed: ${(err as Error).message}`))
        .finally(() => (benchBusy = false));
      return { benchId };
    },
  });
  closers.push(api.close);
  log(`monk api      ${api.url}   (dashboard at ${api.url}/)`);

  let deliver = async (to: { platform: string; chatId: string }, text: string): Promise<unknown> => log(`[deliver ${to.platform}:${to.chatId}] ${text.slice(0, 200)}`);

  if (opts.channels && (cfg.TELEGRAM_BOT_TOKEN || cfg.DISCORD_BOT_TOKEN)) {
    const cronApi = createCronApi({ db, cfg, reload: () => cronBox.reload() });
    const gw = await startGateway({ db, client, cfg, chaos: proxy.control, cron: cronApi });
    closers.push(gw.close);
    deliver = gw.deliver;
    log(`channels      ${[cfg.TELEGRAM_BOT_TOKEN && 'telegram', cfg.DISCORD_BOT_TOKEN && 'discord'].filter(Boolean).join(', ')}`);
  } else if (opts.channels) {
    log('channels      off (no TELEGRAM_BOT_TOKEN / DISCORD_BOT_TOKEN)');
  }

  if (opts.cron) {
    const cron = await startCron({
      db,
      client,
      cfg,
      deliver: async (to, text) => {
        await deliver(to, text);
      },
      runDrill: async (profile) => {
        const benchId = await benchRun(ctx, proxy.control, { suites: ['github'], profile, seeds: 1, generations: 1, chaosOffControl: false, keepSkills: true }, () => {});
        const curve = (await computeCurve(db)).filter((p) => p.suite === 'github');
        const last = curve.at(-1);
        return last ? `chaos drill ${benchId}: ${Math.round(last.successRate.mean * 100)}% success under ${profile}` : `chaos drill ${benchId} finished`;
      },
    });
    cronBox.reload = cron.reload;
    closers.push(cron.close);
    log('cron          on');
  }

  if (cfg.AGENTEYE_INGEST_KEY) {
    const exporter = startAgentEyeExporter({ db, client, cfg, log });
    closers.push(exporter.close);
  } else {
    log('agenteye      off (no AGENTEYE_INGEST_KEY)');
  }

  return async () => {
    for (const c of closers.reverse()) await c().catch(() => {});
  };
}
