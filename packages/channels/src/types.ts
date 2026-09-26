import type { ChaosState, CronJobRow, FaultType } from '@monk/shared';

/** A button tap arrives as an InboundMessage with `callback` set and empty text. */
export type InboundMessage = {
  platform: string;
  chatId: string;
  /** Platform user id of the sender (or of whoever tapped the button). */
  userId: string;
  /** Display handle for approval receipts, e.g. "@chetan". */
  userName?: string;
  text: string;
  messageId: string;
  /** Button payload when this is a tap; `messageId` is then the message carrying the button. */
  callback?: string;
};

export type Button = { text: string; data: string; style?: 'primary' | 'success' | 'danger' | 'secondary' };

export type Attachment = {
  filename: string;
  data: Buffer;
  /** 'photo' renders inline (screenshots); everything else is a file. */
  kind?: 'photo' | 'document';
  caption?: string;
};

export type OutboundMessage = {
  text: string;
  /** Text uses Monk's markdown subset: **bold**, `code`, ``` fences, [links](url). */
  markdown?: boolean;
  buttons?: Button[][];
  attachments?: Attachment[];
};

/**
 * PRD Module 3 interface. Extensions: `send` returns the platform message id (needed to edit it),
 * `limit` is the platform message size, and `stop` shuts the connection down. `editStream`
 * replaces a message's text (markdown) and drops any buttons it had.
 */
export interface ChannelAdapter {
  name: 'telegram' | 'discord' | (string & {});
  limit: number;
  start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  send(chatId: string, out: OutboundMessage): Promise<string>;
  editStream?(chatId: string, msgId: string, text: string): Promise<void>;
  stop?(): Promise<void>;
}

/** The slice of @monk/chaos-proxy's ChaosControl the gateway needs. */
export type { ChaosApi } from '@monk/shared';

export type CronDraft = {
  cron: string;
  human: string;
  prompt: string;
  timezone: string;
  kind: 'prompt' | 'chaos_drill';
  chaosProfile: string | null;
  /** ISO timestamps of the next runs, for the confirmation card. */
  nextRuns: string[];
};

/** What the gateway needs from @monk/cron; `monk up` wires it (see @monk/cron createCronApi). */
export type CronApi = {
  parse(text: string): Promise<CronDraft>;
  create(job: CronDraft & { deliverTo: { platform: string; chatId: string }; agent: string }): Promise<{ id: string }>;
  list(): Promise<CronJobRow[]>;
  remove(id: string): Promise<boolean>;
  reload(): Promise<void>;
};

export type Gateway = {
  deliver(to: { platform: string; chatId: string }, text: string): Promise<void>;
  close(): Promise<void>;
};
