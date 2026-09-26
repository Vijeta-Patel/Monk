import type { MonkConfig, MonkDb, TrueForge } from '@monk/shared';
import { discordAdapter } from './adapters/discord.ts';
import { telegramAdapter } from './adapters/telegram.ts';
import { createGateway } from './gateway.ts';
import type { ChannelAdapter, ChaosApi, CronApi, Gateway } from './types.ts';

export type * from './types.ts';
export { createGateway, approvalCard, type GatewayCore, type GatewayOptions } from './gateway.ts';
export { ReplyStream, ATTACH_OVER, type ReplySink } from './stream.ts';
export * from './format.ts';
export { telegramAdapter, toInlineKeyboard, telegramText, TELEGRAM_LIMIT } from './adapters/telegram.ts';
export { discordAdapter, toActionRows, discordText, DISCORD_LIMIT } from './adapters/discord.ts';

/** One adapter per bot token present in the config. */
export function adaptersFromConfig(cfg: MonkConfig): ChannelAdapter[] {
  const out: ChannelAdapter[] = [];
  if (cfg.TELEGRAM_BOT_TOKEN) out.push(telegramAdapter({ token: cfg.TELEGRAM_BOT_TOKEN }));
  if (cfg.DISCORD_BOT_TOKEN) out.push(discordAdapter({ token: cfg.DISCORD_BOT_TOKEN }));
  return out;
}

export async function startGateway(opts: {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  adapters?: ChannelAdapter[];
  chaos: ChaosApi;
  cron?: CronApi;
  streamIntervalMs?: number;
}): Promise<Gateway> {
  const adapters = opts.adapters ?? adaptersFromConfig(opts.cfg);
  const gw = createGateway({ ...opts, adapters });
  for (const a of adapters) {
    try {
      await a.start((msg) => gw.handle(msg));
    } catch (err) {
      console.error(`[channels] ${a.name} failed to start:`, (err as Error).message);
    }
  }
  return { deliver: gw.deliver, close: gw.close };
}
