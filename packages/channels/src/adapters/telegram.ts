import { Bot, GrammyError, InputFile } from 'grammy';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types';
import { mdToPlain, mdToTelegramHtml } from '../format.ts';
import type { Button, ChannelAdapter, InboundMessage, OutboundMessage } from '../types.ts';

export const TELEGRAM_LIMIT = 4096;

/** Buttons → inline keyboard. Callback data is capped at Telegram's 64 bytes. */
export function toInlineKeyboard(rows: Button[][]): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b): InlineKeyboardButton => {
        const style = b.style === 'secondary' ? undefined : b.style;
        return { text: b.text, callback_data: Buffer.from(b.data).subarray(0, 64).toString(), ...(style ? { style } : {}) };
      }),
    ),
  };
}

/** Rendering for one outbound text: HTML parse mode for markdown, plain otherwise. */
export function telegramText(out: { text: string; markdown?: boolean }): { text: string; parse_mode?: 'HTML' } {
  return out.markdown ? { text: mdToTelegramHtml(out.text), parse_mode: 'HTML' } : { text: out.text };
}

function isParseError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 && /can't parse entities|unsupported start tag/i.test(err.description);
}

function isNotModified(err: unknown): boolean {
  return err instanceof GrammyError && /message is not modified/i.test(err.description);
}

/** Retries once on a 429 (flood control), waiting the time Telegram asks for. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 429) {
      const wait = (err.parameters.retry_after ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
      return fn();
    }
    throw err;
  }
}

const COMMANDS = [
  { command: 'new', description: 'fresh session' },
  { command: 'stop', description: 'interrupt the current turn' },
  { command: 'chaos', description: 'profile, fault, off or status' },
  { command: 'skills', description: 'learned skills and win rates' },
  { command: 'cron', description: 'list, add or remove scheduled jobs' },
  { command: 'status', description: 'session, agent, chaos' },
  { command: 'screen', description: 'latest phone screen' },
  { command: 'link', description: 'continue this chat on another platform' },
  { command: 'agent', description: 'switch agent' },
  { command: 'help', description: 'what monk can do' },
];

export function telegramAdapter(opts: { token: string }): ChannelAdapter {
  const bot = new Bot(opts.token);
  const chat = (id: string) => (/^-?\d+$/.test(id) ? Number(id) : id);

  async function sendText(chatId: string, out: OutboundMessage): Promise<string> {
    const markup = out.buttons?.length ? { reply_markup: toInlineKeyboard(out.buttons) } : {};
    const body = telegramText(out);
    try {
      const m = await withRetry(() =>
        bot.api.sendMessage(chat(chatId), body.text, { ...markup, ...(body.parse_mode ? { parse_mode: body.parse_mode } : {}), link_preview_options: { is_disabled: true } }),
      );
      return String(m.message_id);
    } catch (err) {
      if (!isParseError(err)) throw err;
      const m = await bot.api.sendMessage(chat(chatId), mdToPlain(out.text), markup);
      return String(m.message_id);
    }
  }

  return {
    name: 'telegram',
    limit: TELEGRAM_LIMIT,

    async start(onMessage) {
      const dispatch = (msg: InboundMessage) => {
        // Never block the polling loop on a turn: taps must keep flowing while a reply streams.
        void onMessage(msg).catch((err) => console.error('[telegram] handler:', (err as Error).message));
      };
      bot.on('message:text', (ctx) => {
        const from = ctx.from;
        dispatch({
          platform: 'telegram',
          chatId: String(ctx.chat.id),
          userId: String(from.id),
          userName: from.username ? `@${from.username}` : from.first_name,
          text: ctx.message.text,
          messageId: String(ctx.message.message_id),
        });
      });
      bot.on('callback_query:data', async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const from = ctx.callbackQuery.from;
        const m = ctx.callbackQuery.message;
        if (!m) return;
        dispatch({
          platform: 'telegram',
          chatId: String(m.chat.id),
          userId: String(from.id),
          userName: from.username ? `@${from.username}` : from.first_name,
          text: '',
          messageId: String(m.message_id),
          callback: ctx.callbackQuery.data,
        });
      });
      bot.catch((err) => console.error('[telegram]', err.message));
      await bot.init();
      await bot.api.setMyCommands(COMMANDS).catch(() => {});
      void bot.start({ allowed_updates: ['message', 'callback_query'] }).catch((err) => console.error('[telegram] polling stopped:', (err as Error).message));
    },

    async send(chatId, out) {
      let first: string | null = null;
      if (out.text.trim()) first = await sendText(chatId, out);
      for (const a of out.attachments ?? []) {
        const file = new InputFile(a.data, a.filename);
        const caption = a.caption ? { caption: a.caption.slice(0, 1024) } : {};
        const m =
          a.kind === 'photo'
            ? await withRetry(() => bot.api.sendPhoto(chat(chatId), file, caption))
            : await withRetry(() => bot.api.sendDocument(chat(chatId), file, caption));
        first ??= String(m.message_id);
      }
      return first ?? '';
    },

    async editStream(chatId, msgId, text) {
      const body = telegramText({ text: text.slice(0, TELEGRAM_LIMIT * 2), markdown: true });
      try {
        await withRetry(() =>
          bot.api.editMessageText(chat(chatId), Number(msgId), body.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
        );
      } catch (err) {
        if (isNotModified(err)) return;
        if (!isParseError(err)) throw err;
        await bot.api.editMessageText(chat(chatId), Number(msgId), mdToPlain(text).slice(0, TELEGRAM_LIMIT)).catch(() => {});
      }
    },

    async stop() {
      await bot.stop();
    },
  };
}
