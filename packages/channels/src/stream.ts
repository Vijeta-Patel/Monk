import type { TurnEvent } from '@monk/shared';
import { errorSummary, fmtBytes, fmtDuration, headOf, humanizeTool, longestCodeBlock, splitText, tailOf } from './format.ts';
import type { Attachment } from './types.ts';

/** Where a reply goes; the gateway binds it to one adapter + chat and redacts everything. */
export type ReplySink = {
  limit: number;
  send(text: string): Promise<string>;
  edit?: (msgId: string, text: string) => Promise<void>;
  sendFile(att: Attachment): Promise<void>;
};

type Block =
  | { kind: 'text'; text: string; open: boolean }
  | { kind: 'sub'; name: string }
  | {
      kind: 'tool';
      callId: string;
      name: string;
      sub: boolean;
      startedAt: number;
      status: 'running' | 'ok' | 'fault' | 'held';
      ms: number;
      reason: string;
    };

/** Replies longer than this, or with a code block that can't fit one message, go out as a file. */
export const ATTACH_OVER = 3500;
const PLACEHOLDER = '…';
/** Built-ins whose effect shows up elsewhere (question cards), not as tool lines. */
const HIDDEN_TOOLS = new Set(['ask_user_question']);

/**
 * One live reply: a single message edited as the turn streams, at most once per `intervalMs`.
 * Tool calls render as compact lines; the final edit lands when the turn ends.
 */
export class ReplyStream {
  private blocks: Block[] = [];
  private msgId: string | null = null;
  private shown = '';
  private lastEditAt = 0;
  private lastActivity = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private started: Promise<void> | null = null;
  private readonly sink: ReplySink;
  private readonly intervalMs: number;

  constructor(sink: ReplySink, opts: { intervalMs?: number } = {}) {
    this.sink = sink;
    this.intervalMs = opts.intervalMs ?? 1000;
  }

  /** Sends the placeholder so the user sees Monk picked the message up. */
  start(): Promise<void> {
    this.started ??= (async () => {
      if (!this.sink.edit) return;
      this.msgId = await this.sink.send(PLACEHOLDER);
      this.shown = PLACEHOLDER;
      this.lastEditAt = Date.now();
    })();
    return this.started;
  }

  onEvent(ev: TurnEvent): void {
    const now = Date.now();
    switch (ev.type) {
      case 'text': {
        if (ev.threadId !== 'main' || !ev.delta) break;
        const last = this.blocks.at(-1);
        if (last?.kind === 'text' && last.open) last.text += ev.delta;
        else this.blocks.push({ kind: 'text', text: ev.delta, open: true });
        break;
      }
      case 'message': {
        if (ev.threadId !== 'main') break;
        const last = this.blocks.at(-1);
        if (last?.kind === 'text' && last.open) {
          last.text = ev.content;
          last.open = false;
        } else this.blocks.push({ kind: 'text', text: ev.content, open: false });
        break;
      }
      case 'tool.call':
        if (HIDDEN_TOOLS.has(ev.name)) break;
        // Calls are only known once their message is sealed; the last activity before that is
        // the closest thing to a start time.
        this.blocks.push({
          kind: 'tool',
          callId: ev.callId,
          name: ev.name,
          sub: ev.threadId !== 'main',
          startedAt: this.lastActivity,
          status: 'running',
          ms: 0,
          reason: '',
        });
        break;
      case 'tool.result': {
        const b = this.blocks.find((x): x is Extract<Block, { kind: 'tool' }> => x.kind === 'tool' && x.callId === ev.callId);
        if (b) {
          b.status = ev.isError ? 'fault' : 'ok';
          b.ms = now - b.startedAt;
          b.reason = ev.isError ? errorSummary(ev.content) : '';
        }
        break;
      }
      case 'approval.required':
        for (const c of ev.calls) {
          const b = this.blocks.find((x): x is Extract<Block, { kind: 'tool' }> => x.kind === 'tool' && x.callId === c.callId);
          if (b) b.status = 'held';
        }
        break;
      case 'subagent.started':
        this.blocks.push({ kind: 'sub', name: ev.name || 'sub-agent' });
        break;
      default:
        break;
    }
    if (ev.type !== 'tool.call' && ev.type !== 'message' && ev.type !== 'usage') this.lastActivity = now;
    this.schedule();
  }

  /** The reply as markdown: tool lines grouped, text paragraphs between them. */
  render(includeText = true): string {
    const groups: string[] = [];
    let lines: string[] = [];
    const flush = () => {
      if (lines.length) groups.push(lines.join('\n'));
      lines = [];
    };
    for (const b of this.blocks) {
      if (b.kind === 'text') {
        if (!includeText) continue;
        flush();
        if (b.text.trim()) groups.push(b.text.trim());
      } else if (b.kind === 'sub') {
        lines.push(`◆ ${b.name}`);
      } else {
        const pad = b.sub ? '  ' : '';
        const tail =
          b.status === 'running'
            ? '…'
            : b.status === 'held'
              ? '· needs your ok'
              : b.status === 'ok'
                ? `✓ ${fmtDuration(b.ms)}`
                : `⚡ ${b.reason ? `${b.reason} ` : ''}${fmtDuration(b.ms)}`;
        lines.push(`${pad}▸ ${humanizeTool(b.name)} ${tail}`);
      }
    }
    flush();
    return groups.join('\n\n');
  }

  /** Only what the agent said, without tool lines (what goes into an attached file). */
  agentText(): string {
    return this.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private preview(): string {
    const text = this.render() || PLACEHOLDER;
    return tailOf(text, this.sink.limit);
  }

  private schedule(): void {
    if (!this.sink.edit || this.timer) return;
    const wait = Math.max(0, this.lastEditAt + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.chain = this.chain.then(() => this.editTo(this.preview()));
    }, wait);
  }

  private async editTo(text: string): Promise<void> {
    await this.start();
    if (!this.msgId || !this.sink.edit || text === this.shown) return;
    try {
      await this.sink.edit(this.msgId, text);
      this.shown = text;
    } catch (err) {
      console.error('[channels] edit failed:', (err as Error).message);
    }
    this.lastEditAt = Date.now();
  }

  /** Final render. Long replies become a short preview plus an attached file. */
  async finish(done: Extract<TurnEvent, { type: 'turn.done' }>): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.chain;
    if (!this.agentText() && done.output.trim()) this.blocks.push({ kind: 'text', text: done.output, open: false });
    for (const b of this.blocks) if (b.kind === 'tool' && b.status === 'running' && done.status !== 'paused') b.status = 'ok';

    let suffix = '';
    if (done.status === 'cancelled') suffix = '■ stopped.';
    else if (done.status === 'error') suffix = `✗ ${done.error ?? 'the turn failed'}`;

    const agent = this.agentText();
    const limit = this.sink.limit;
    let body = this.render();
    let file: Attachment | null = null;
    if (agent.length > ATTACH_OVER || longestCodeBlock(agent) > limit - 200) {
      const tools = this.render(false);
      file = { filename: 'reply.md', data: Buffer.from(agent, 'utf8'), kind: 'document' };
      body = [tools, headOf(agent, 600), `▤ full reply attached · ${fmtBytes(file.data.length)}`].filter(Boolean).join('\n\n');
    }
    if (suffix) body = body ? `${body}\n\n${suffix}` : suffix;
    if (!body) body = done.status === 'paused' ? 'waiting on you.' : 'done.';

    const chunks = splitText(body, limit);
    if (this.msgId && this.sink.edit) {
      const wait = this.lastEditAt + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const [first, ...rest] = chunks;
      await this.editTo(first ?? '…');
      for (const c of rest) await this.sink.send(c);
    } else {
      for (const c of chunks) await this.sink.send(c);
    }
    if (file) await this.sink.sendFile(file);
  }
}
