import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  escapeMarkdown,
} from 'discord.js';
import type { Button, ChannelAdapter, InboundMessage, OutboundMessage } from '../types.ts';

export const DISCORD_LIMIT = 2000;

const STYLES: Record<NonNullable<Button['style']>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  secondary: ButtonStyle.Secondary,
};

/** Buttons → action rows (Discord allows 5 rows of 5; custom ids up to 100 chars). */
export function toActionRows(rows: Button[][]): ActionRowBuilder<ButtonBuilder>[] {
  return rows.slice(0, 5).map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      row.slice(0, 5).map((b) =>
        new ButtonBuilder()
          .setCustomId(b.data.slice(0, 100))
          .setLabel(b.text.slice(0, 80))
          .setStyle(STYLES[b.style ?? 'secondary']),
      ),
    ),
  );
}

/** Discord renders markdown natively; plain text gets its markdown escaped. */
export function discordText(out: { text: string; markdown?: boolean }): string {
  const text = out.markdown ? out.text : escapeMarkdown(out.text);
  return text.length > DISCORD_LIMIT ? `${text.slice(0, DISCORD_LIMIT - 1)}…` : text;
}

export function discordAdapter(opts: { token: string }): ChannelAdapter {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });

  async function channel(chatId: string) {
    const ch = await client.channels.fetch(chatId);
    if (!ch || !ch.isSendable()) throw new Error(`discord channel ${chatId} is not writable`);
    return ch;
  }

  return {
    name: 'discord',
    limit: DISCORD_LIMIT,

    async start(onMessage) {
      const dispatch = (msg: InboundMessage) => {
        void onMessage(msg).catch((err) => console.error('[discord] handler:', (err as Error).message));
      };
      client.on(Events.MessageCreate, (m) => {
        if (m.author.bot || !m.content) return;
        dispatch({
          platform: 'discord',
          chatId: m.channelId,
          userId: m.author.id,
          userName: `@${m.author.username}`,
          text: m.content,
          messageId: m.id,
        });
      });
      client.on(Events.InteractionCreate, async (i) => {
        if (!i.isButton()) return;
        // Acknowledge within Discord's 3 s window; the gateway edits the message itself.
        await i.deferUpdate().catch(() => {});
        dispatch({
          platform: 'discord',
          chatId: i.channelId,
          userId: i.user.id,
          userName: `@${i.user.username}`,
          text: '',
          messageId: i.message.id,
          callback: i.customId,
        });
      });
      client.on(Events.Error, (err) => console.error('[discord]', err.message));
      await client.login(opts.token);
    },

    async send(chatId, out: OutboundMessage) {
      const ch = await channel(chatId);
      const files = (out.attachments ?? []).map((a) => new AttachmentBuilder(a.data, { name: a.filename, ...(a.caption ? { description: a.caption } : {}) }));
      const caption = out.attachments?.find((a) => a.caption)?.caption;
      const content = out.text.trim() ? discordText(out) : caption ? escapeMarkdown(caption) : undefined;
      const m = await ch.send({
        ...(content ? { content } : {}),
        ...(out.buttons?.length ? { components: toActionRows(out.buttons) } : {}),
        ...(files.length ? { files } : {}),
      });
      return m.id;
    },

    async editStream(chatId, msgId, text) {
      const ch = await channel(chatId);
      if (!('messages' in ch)) return;
      const m = await ch.messages.fetch(msgId);
      await m.edit({ content: discordText({ text, markdown: true }), components: [] });
    },

    async stop() {
      await client.destroy();
    },
  };
}
