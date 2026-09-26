import { randomBytes, randomInt } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import {
  ALL_FAULT_TYPES,
  DESTRUCTIVE_TOOL_GLOBS,
  matchesAny,
  newId,
  redact,
  runMonkTurn,
  schema,
  type FaultType,
  type MonkConfig,
  type MonkDb,
  type ToolCallInfo,
  type TrueForge,
  type TurnEvent,
  type TurnInput,
} from '@monk/shared';
import { clockTime, dateTime, fmtBytes, headOf, humanizeTool, splitText, table, toolTargets } from './format.ts';
import { ATTACH_OVER, ReplyStream, type ReplySink } from './stream.ts';
import type { Button, ChannelAdapter, ChaosApi, CronApi, CronDraft, Gateway, InboundMessage, OutboundMessage } from './types.ts';

export type GatewayOptions = {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  adapters: ChannelAdapter[];
  chaos: ChaosApi;
  cron?: CronApi;
  /** Minimum gap between edits of a streaming reply. */
  streamIntervalMs?: number;
};

/** Gateway plus the hooks tests and `startGateway` need. */
export type GatewayCore = Gateway & {
  handle(msg: InboundMessage): Promise<void>;
  /** Resolves once every queued turn has finished. */
  idle(): Promise<void>;
};

type Chat = { adapter: ChannelAdapter; platform: string; chatId: string };
type QuestionCall = ToolCallInfo & { question: string; options: string[] };

type Pending =
  | { kind: 'approval'; userId: string; chat: Chat; msgId: string; calls: ToolCallInfo[] }
  | { kind: 'question'; userId: string; chat: Chat; msgId: string; call: QuestionCall; batch: QuestionBatch }
  | { kind: 'cron'; userId: string; chat: Chat; msgId: string; draft: CronDraft };

type QuestionBatch = { size: number; answers: { threadId: string; callId: string; content: string }[] };

type Lane = { tail: Promise<void>; queued: number; epoch: number; active: boolean; running: { sessionId: string } | null };

const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_TTL_MS = 10 * 60_000;
const AGENT_NAME = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

const HELP = [
  '**monk** · message me like a teammate.',
  '',
  '/new · fresh session',
  '/agent <name> · switch agent',
  '/link [code] · continue this chat on another platform',
  '/stop · interrupt the current turn',
  '/chaos <profile|fault|off|status>',
  '/skills · learned skills and win rates',
  '/cron list · add <when, what> · rm <id>',
  '/status · session, agent, chaos',
  '/screen · latest phone screen',
].join('\n');

function isAllowed(allowed: string[], msg: InboundMessage): boolean {
  return allowed.some((e) => e === `${msg.platform}:${msg.userId}` || e === msg.userId);
}

function targetsLine(call: ToolCallInfo): string {
  const values = toolTargets(call.name, call.args).map((t) => (t.label === 'pr' || t.label === 'issue' ? `${t.label} ${t.value}` : t.value));
  return [humanizeTool(call.name), ...values].join(' · ');
}

export function approvalCard(calls: ToolCallInfo[]): string {
  const parts = ['**before I ship this, I need your ok**'];
  for (const c of calls) {
    const targets = toolTargets(c.name, c.args);
    parts.push(`**${humanizeTool(c.name)}**\n${targets.length ? `\`\`\`\n${table(targets)}\n\`\`\`` : 'no arguments'}`);
  }
  if (calls.some((c) => matchesAny(c.name, DESTRUCTIVE_TOOL_GLOBS))) parts.push("this one's forever.");
  return parts.join('\n\n');
}

export function createGateway(opts: GatewayOptions): GatewayCore {
  const { db, client, cfg, chaos, cron } = opts;
  const byName = new Map(opts.adapters.map((a) => [a.name, a]));
  const lanes = new Map<string, Lane>();
  const pending = new Map<string, Pending>();
  const awaitingText = new Map<string, string>(); // userId -> pending question id
  // Platform people who have talked as each Monk user. Only they can answer its cards, so a
  // teammate in a shared group chat can't approve someone else's merge.
  const owners = new Map<string, Set<string>>();
  const ownerKey = (m: InboundMessage) => `${m.platform}:${m.userId}`;
  const warned = new Set<string>();
  const tz = cfg.TIMEZONE;

  // ---- output ---------------------------------------------------------------------------------

  function clean(out: OutboundMessage): OutboundMessage {
    return { ...out, text: redact(out.text) };
  }

  function say(chat: Chat, text: string, extra: Omit<OutboundMessage, 'text'> = {}): Promise<string> {
    return chat.adapter.send(chat.chatId, clean({ text, markdown: true, ...extra }));
  }

  async function editCard(chat: Chat, msgId: string, text: string): Promise<void> {
    if (chat.adapter.editStream) await chat.adapter.editStream(chat.chatId, msgId, redact(text)).catch(logErr('edit card'));
    else await say(chat, text);
  }

  function sinkFor(chat: Chat): ReplySink {
    const edit = chat.adapter.editStream?.bind(chat.adapter);
    return {
      limit: chat.adapter.limit,
      send: (text) => say(chat, text),
      edit: edit ? (msgId, text) => edit(chat.chatId, msgId, redact(text)) : undefined,
      sendFile: async (att) => {
        await chat.adapter.send(chat.chatId, {
          text: '',
          attachments: [{ ...att, data: Buffer.from(redact(att.data.toString('utf8')), 'utf8') }],
        });
      },
    };
  }

  function logErr(what: string) {
    return (err: unknown) => console.error(`[channels] ${what}:`, redact((err as Error)?.message ?? String(err)));
  }

  // ---- users, links, sessions -----------------------------------------------------------------

  async function linkedUser(platform: string, chatId: string): Promise<string | null> {
    const [row] = await db
      .select()
      .from(schema.links)
      .where(and(eq(schema.links.platform, platform), eq(schema.links.chatId, chatId)));
    return row?.userId ?? null;
  }

  async function userFor(platform: string, chatId: string): Promise<string> {
    const existing = await linkedUser(platform, chatId);
    if (existing) return existing;
    const userId = newId('usr');
    await db.insert(schema.users).values({ userId });
    await db.insert(schema.links).values({ platform, chatId, userId });
    return userId;
  }

  async function getUser(userId: string) {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.userId, userId));
    if (row) return row;
    await db.insert(schema.users).values({ userId });
    const [created] = await db.select().from(schema.users).where(eq(schema.users.userId, userId));
    return created!;
  }

  async function setSession(userId: string, sessionId: string | null): Promise<void> {
    await db.update(schema.users).set({ activeSessionId: sessionId }).where(eq(schema.users.userId, userId));
  }

  async function ensureSession(userId: string): Promise<string> {
    const user = await getUser(userId);
    if (user.activeSessionId) return user.activeSessionId;
    const { data } = await client.sessions.create({ agent: { name: user.agentName }, metadata: { monk_client: 'chat' } });
    await setSession(userId, data.id);
    return data.id;
  }

  // ---- per-user turn queue --------------------------------------------------------------------

  function lane(userId: string): Lane {
    let l = lanes.get(userId);
    if (!l) {
      l = { tail: Promise.resolve(), queued: 0, epoch: 0, active: false, running: null };
      lanes.set(userId, l);
    }
    return l;
  }

  /** Queues a turn behind the user's current one; returns how many turns are ahead of it. */
  function enqueue(userId: string, job: () => Promise<void>): number {
    const l = lane(userId);
    const ahead = l.queued + (l.active ? 1 : 0);
    const epoch = l.epoch;
    l.queued++;
    l.tail = l.tail.then(async () => {
      l.queued--;
      if (epoch !== l.epoch) return; // dropped by /stop
      l.active = true;
      await job().catch(logErr('turn'));
      l.active = false;
    });
    return ahead;
  }

  async function runTurn(chat: Chat, userId: string, input: TurnInput, retried = false): Promise<void> {
    const l = lane(userId);
    const stream = new ReplyStream(sinkFor(chat), opts.streamIntervalMs !== undefined ? { intervalMs: opts.streamIntervalMs } : {});
    const approvals: ToolCallInfo[] = [];
    const questions: QuestionCall[] = [];
    let done: Extract<TurnEvent, { type: 'turn.done' }> | null = null;
    let sessionId = '';
    let sawEvent = false;
    try {
      await stream.start();
      sessionId = await ensureSession(userId);
      l.running = { sessionId };
      for await (const ev of runMonkTurn({ db, client, cfg }, sessionId, input)) {
        sawEvent = true;
        if (ev.type === 'approval.required') approvals.push(...ev.calls);
        else if (ev.type === 'question') questions.push(...ev.calls);
        else if (ev.type === 'turn.done') done = ev;
        stream.onEvent(ev);
      }
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // The TrueForge session is gone (server reset): start a fresh one once.
      if (status === 404 && !sawEvent && !retried && input.kind === 'message') {
        l.running = null;
        await setSession(userId, null);
        await stream.finish({ type: 'turn.done', status: 'done', output: 'that session was gone. starting a fresh one.', inputTokens: 0, outputTokens: 0 });
        return runTurn(chat, userId, input, true);
      }
      done = { type: 'turn.done', status: 'error', output: '', error: `can't reach trueforge: ${(err as Error).message}`, inputTokens: 0, outputTokens: 0 };
    } finally {
      l.running = null;
    }
    done ??= { type: 'turn.done', status: 'error', output: '', error: 'the stream ended early', inputTokens: 0, outputTokens: 0 };
    await stream.finish(done);
    if (approvals.length) await sendApprovalCard(chat, userId, approvals);
    if (questions.length) await sendQuestions(chat, userId, questions);
  }

  // ---- cards ----------------------------------------------------------------------------------

  function token(): string {
    return randomBytes(4).toString('hex');
  }

  async function sendApprovalCard(chat: Chat, userId: string, calls: ToolCallInfo[]): Promise<void> {
    const id = token();
    const buttons: Button[][] = [
      [
        { text: '✓ Approve', data: `ap:${id}:y`, style: 'success' },
        { text: '✗ Reject', data: `ap:${id}:n`, style: 'danger' },
      ],
    ];
    const msgId = await say(chat, approvalCard(calls), { buttons });
    pending.set(id, { kind: 'approval', userId, chat, msgId, calls });
  }

  async function sendQuestions(chat: Chat, userId: string, calls: QuestionCall[]): Promise<void> {
    const batch: QuestionBatch = { size: calls.length, answers: [] };
    for (const call of calls) {
      const id = token();
      const opts = call.options.slice(0, 10);
      const rows: Button[][] = [];
      const perRow = opts.every((o) => o.length <= 14) ? 3 : 1;
      opts.forEach((o, i) => {
        if (i % perRow === 0) rows.push([]);
        rows.at(-1)!.push({ text: o.slice(0, 60), data: `qa:${id}:${i}` });
      });
      const hint = opts.length ? 'tap one, or reply with your own answer.' : 'reply with your answer.';
      const msgId = await say(chat, `**${call.question || 'monk has a question'}**\n\n${hint}`, rows.length ? { buttons: rows } : {});
      pending.set(id, { kind: 'question', userId, chat, msgId, call, batch });
      if (!awaitingText.has(userId)) awaitingText.set(userId, id);
    }
  }

  async function answerQuestion(id: string, p: Extract<Pending, { kind: 'question' }>, content: string, by: string): Promise<void> {
    pending.delete(id);
    if (awaitingText.get(p.userId) === id) awaitingText.delete(p.userId);
    // Point free-text replies at the next open question of the batch, if any.
    for (const [otherId, other] of pending) {
      if (other.kind === 'question' && other.batch === p.batch && !awaitingText.has(p.userId)) awaitingText.set(p.userId, otherId);
    }
    await editCard(p.chat, p.msgId, `**${p.call.question || 'question'}**\n\n✓ ${content} · ${by} · ${clockTime(new Date(), tz)}`);
    p.batch.answers.push({ threadId: p.call.threadId, callId: p.call.callId, content });
    if (p.batch.answers.length === p.batch.size) {
      const answers = p.batch.answers;
      enqueue(p.userId, () => runTurn(p.chat, p.userId, { kind: 'answers', answers }));
    }
  }

  async function onTap(chat: Chat, msg: InboundMessage): Promise<void> {
    const [kind, id = '', choice = ''] = (msg.callback ?? '').split(':');
    const p = pending.get(id);
    if (!p) {
      await say(chat, 'that one is no longer open.');
      return;
    }
    // Only the Monk user this card belongs to (any of their linked chats) can answer it, and only
    // the people who have spoken as that user.
    if ((await linkedUser(msg.platform, msg.chatId)) !== p.userId) return;
    const known = owners.get(p.userId);
    if (known && known.size > 0 && !known.has(ownerKey(msg))) {
      await say(chat, 'only the person who asked can answer that one.');
      return;
    }
    const by = msg.userName ?? msg.userId;
    const at = clockTime(new Date(), tz);

    if (kind === 'ap' && p.kind === 'approval') {
      pending.delete(id);
      const allow = choice === 'y';
      const summary = p.calls.map(targetsLine).join('\n');
      await editCard(p.chat, p.msgId, `${allow ? '✓ **approved**' : '✗ **rejected**'} by ${by} · ${at}\n${summary}`);
      const decisions = p.calls.map((c) => ({
        threadId: c.threadId,
        callId: c.callId,
        allow,
        ...(allow ? {} : { reason: `rejected by ${by}` }),
      }));
      enqueue(p.userId, () => runTurn(p.chat, p.userId, { kind: 'approvals', decisions }));
    } else if (kind === 'qa' && p.kind === 'question') {
      const option = p.call.options[Number(choice)];
      if (option === undefined) return;
      await answerQuestion(id, p, option, by);
    } else if (kind === 'cr' && p.kind === 'cron') {
      pending.delete(id);
      if (choice !== 'y' || !cron) {
        await editCard(p.chat, p.msgId, `✗ not scheduled.\n${p.draft.human}: ${p.draft.prompt}`);
        return;
      }
      const user = await getUser(p.userId);
      const job = await cron.create({ ...p.draft, deliverTo: { platform: p.chat.platform, chatId: p.chat.chatId }, agent: user.agentName });
      await cron.reload();
      await editCard(p.chat, p.msgId, `✓ **scheduled** · \`${job.id}\`\n${p.draft.human} (${p.draft.timezone}): ${p.draft.prompt}`);
    }
  }

  // ---- commands -------------------------------------------------------------------------------

  async function cmdLink(chat: Chat, arg: string): Promise<void> {
    if (!arg) {
      const userId = await userFor(chat.platform, chat.chatId);
      let code = '';
      for (let i = 0; i < 6; i++) code += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
      await db.insert(schema.linkCodes).values({ code, userId, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() });
      await say(chat, `link code **${code}** · valid 10 min\nsend \`/link ${code}\` from your other chat to continue there.`);
      return;
    }
    const code = arg.toUpperCase();
    const [row] = await db
      .select()
      .from(schema.linkCodes)
      .where(and(eq(schema.linkCodes.code, code), gt(schema.linkCodes.expiresAt, new Date().toISOString())));
    if (!row) {
      await say(chat, "that code didn't work. it may have expired; run /link again on the other chat.");
      return;
    }
    await db.delete(schema.linkCodes).where(eq(schema.linkCodes.code, code));
    await db
      .insert(schema.links)
      .values({ platform: chat.platform, chatId: chat.chatId, userId: row.userId })
      .onConflictDoUpdate({ target: [schema.links.platform, schema.links.chatId], set: { userId: row.userId } });
    const user = await getUser(row.userId);
    const where = (await db.select().from(schema.links).where(eq(schema.links.userId, row.userId)))
      .map((l) => l.platform)
      .filter((p, i, all) => all.indexOf(p) === i);
    await say(
      chat,
      `✓ linked · ${where.join(' + ')}\n${user.activeSessionId ? `picking up session \`${user.activeSessionId}\`.` : 'your next message starts the session.'}`,
    );
  }

  async function cmdStop(chat: Chat, userId: string): Promise<void> {
    const l = lane(userId);
    const dropped = l.queued;
    l.epoch++;
    const running = l.running;
    if (running) await client.sessions.cancel(running.sessionId).catch(logErr('cancel'));
    const tail = dropped ? ` dropped ${dropped} queued.` : '';
    if (running) await say(chat, `stopping.${tail}`);
    else await say(chat, dropped ? tail.trim() : 'nothing running.');
  }

  async function cmdChaos(chat: Chat, userId: string, arg: string): Promise<void> {
    const [head = 'status', tool] = arg.split(/\s+/).filter(Boolean);
    const word = head.toLowerCase();
    const describe = (s: ReturnType<ChaosApi['state']>) =>
      `⚡ chaos **${s.enabled ? s.profile : 'off'}** · ${Math.round(s.faultRate * 100)}% fault rate`;
    if (word === 'status') {
      const s = chaos.state();
      const queued = s.pending.length ? `\nqueued: ${s.pending.map((p) => p.fault + (p.tool ? ` → ${p.tool}` : '')).join(', ')}` : '';
      await say(chat, `${describe(s)}${queued}\nprofiles: ${s.profiles.join(', ')}`);
      return;
    }
    if (word === 'off') {
      await say(chat, `${describe(await chaos.set({ enabled: false }))}\nno faults until you turn it back on.`);
      return;
    }
    if (word === 'on') {
      await say(chat, describe(await chaos.set({ enabled: true })));
      return;
    }
    if (chaos.state().profiles.includes(word)) {
      await say(chat, describe(await chaos.set({ enabled: true, profile: word })));
      return;
    }
    if ((ALL_FAULT_TYPES as readonly string[]).includes(word)) {
      const user = await getUser(userId);
      await chaos.inject({
        fault: word as FaultType,
        ...(tool ? { tool } : {}),
        ...(user.activeSessionId ? { tfSessionId: user.activeSessionId } : {}),
      });
      await say(chat, `⚡ queued **${word}** for the next ${tool ? `\`${tool}\` call` : 'tool call'}.`);
      return;
    }
    await say(chat, `don't know \`${head}\`.\nprofiles: ${chaos.state().profiles.join(', ')}\nfaults: ${ALL_FAULT_TYPES.join(', ')}`);
  }

  async function cmdSkills(chat: Chat): Promise<void> {
    const active = await db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
    if (!active.length) {
      await say(chat, 'no skills yet. they show up after the first learning run.');
      return;
    }
    const uses = await db.select().from(schema.skillUses);
    const rows = active
      .map((s) => {
        const mine = uses.filter((u) => u.skillName === s.name && u.succeeded !== null);
        const wins = mine.filter((u) => u.succeeded).length;
        return { s, wins, n: mine.length, rate: mine.length ? wins / mine.length : -1 };
      })
      .sort((a, b) => b.rate - a.rate || a.s.name.localeCompare(b.s.name));
    const lines = rows.map((r) => ({
      label: r.s.name,
      value: r.n ? `${r.wins}/${r.n}  ${Math.round(r.rate * 100)}%` : 'unused',
    }));
    await say(chat, `◆ **skills** · ${active.length} active\n\`\`\`\n${table(lines)}\n\`\`\``);
  }

  async function cmdCron(chat: Chat, userId: string, arg: string): Promise<void> {
    if (!cron) {
      await say(chat, 'cron is not running in this process.');
      return;
    }
    const [sub = 'list', ...restParts] = arg.split(/\s+/);
    const rest = arg.slice(sub.length).trim();
    switch (sub.toLowerCase()) {
      case 'list':
      case 'ls': {
        const jobs = await cron.list();
        if (!jobs.length) {
          await say(chat, 'no scheduled jobs. try `/cron add every weekday 9am, summarize open PRs`.');
          return;
        }
        const lines = jobs.map((j) => {
          const next = j.nextRun ? `next ${dateTime(new Date(j.nextRun), j.timezone)}` : 'paused';
          const last = j.lastStatus ? ` · last ${j.lastStatus}` : '';
          return `\`${j.id}\` · \`${j.schedule}\` · ${next}${last}\n${j.kind === 'chaos_drill' ? `chaos drill ${j.chaosProfile ?? ''}`.trim() : j.prompt}`;
        });
        await say(chat, `◆ **cron** · ${jobs.length} job${jobs.length === 1 ? '' : 's'}\n\n${lines.join('\n\n')}`);
        return;
      }
      case 'add': {
        if (!rest) {
          await say(chat, 'tell me when and what: `/cron add every weekday 9am, summarize open PRs in acme/app`');
          return;
        }
        let draft: CronDraft;
        try {
          draft = await cron.parse(rest);
        } catch (err) {
          await say(chat, `couldn't read a schedule from that. ${(err as Error).message}`);
          return;
        }
        const id = token();
        const what = draft.kind === 'chaos_drill' ? `chaos drill · ${draft.chaosProfile ?? cfg.CHAOS_PROFILE}` : draft.prompt;
        const next = draft.nextRuns[0] ? `\nnext · ${dateTime(new Date(draft.nextRuns[0]), draft.timezone)}` : '';
        const msgId = await say(chat, `◆ **new scheduled job**\n${draft.human} (${draft.timezone}): ${what}${next}\nresults come to this chat.`, {
          buttons: [
            [
              { text: '✓ Save', data: `cr:${id}:y`, style: 'success' },
              { text: 'Cancel', data: `cr:${id}:n`, style: 'secondary' },
            ],
          ],
        });
        pending.set(id, { kind: 'cron', userId, chat, msgId, draft });
        return;
      }
      case 'rm':
      case 'remove':
      case 'delete': {
        const jobId = restParts[0];
        if (!jobId) {
          await say(chat, 'which one? `/cron rm <id>` (ids are in /cron list)');
          return;
        }
        const ok = await cron.remove(jobId);
        if (ok) await cron.reload();
        await say(chat, ok ? `✓ removed \`${jobId}\`.` : `no job \`${jobId}\`.`);
        return;
      }
      default:
        await say(chat, '/cron list · /cron add <when, what> · /cron rm <id>');
    }
  }

  async function cmdStatus(chat: Chat, userId: string): Promise<void> {
    const user = await getUser(userId);
    const s = chaos.state();
    const l = lane(userId);
    const platforms = (await db.select().from(schema.links).where(eq(schema.links.userId, userId)))
      .map((x) => x.platform)
      .filter((p, i, all) => all.indexOf(p) === i);
    const rows = [
      { label: 'session', value: user.activeSessionId ?? 'none yet' },
      { label: 'agent', value: user.agentName },
      { label: 'chaos', value: s.enabled ? `${s.profile} · ${Math.round(s.faultRate * 100)}%` : 'off' },
      { label: 'turn', value: l.running ? `running${l.queued ? ` · ${l.queued} queued` : ''}` : 'idle' },
      { label: 'linked', value: platforms.join(', ') },
    ];
    await say(chat, `◆ **status**\n\`\`\`\n${table(rows)}\n\`\`\``);
  }

  async function cmdScreen(chat: Chat): Promise<void> {
    const png = await chaos.screenshot().catch(() => null);
    if (!png) {
      await say(chat, 'no phone attached. start with `monk up --phone`.');
      return;
    }
    await chat.adapter.send(chat.chatId, {
      text: '',
      attachments: [{ filename: 'screen.png', data: png, kind: 'photo', caption: `phone · ${clockTime(new Date(), tz)}` }],
    });
  }

  async function onCommand(chat: Chat, cmd: string, arg: string): Promise<void> {
    if (cmd === 'link') return cmdLink(chat, arg);
    const userId = await userFor(chat.platform, chat.chatId);
    switch (cmd) {
      case 'start':
      case 'help':
        await say(chat, HELP);
        return;
      case 'new':
        await setSession(userId, null);
        await say(chat, 'fresh start. your next message opens a new session.');
        return;
      case 'agent': {
        const user = await getUser(userId);
        if (!arg) {
          await say(chat, `talking to **${user.agentName}**. switch with \`/agent <name>\`.`);
          return;
        }
        if (!AGENT_NAME.test(arg)) {
          await say(chat, 'agent names are lowercase letters, digits and dashes.');
          return;
        }
        await db.update(schema.users).set({ agentName: arg, activeSessionId: null }).where(eq(schema.users.userId, userId));
        await say(chat, `now talking to **${arg}**. new session on your next message.`);
        return;
      }
      case 'stop':
        return cmdStop(chat, userId);
      case 'chaos':
        return cmdChaos(chat, userId, arg);
      case 'skills':
        return cmdSkills(chat);
      case 'cron':
        return cmdCron(chat, userId, arg);
      case 'status':
        return cmdStatus(chat, userId);
      case 'screen':
        return cmdScreen(chat);
      default:
        await say(chat, `no /${cmd} here. /help lists what I know.`);
    }
  }

  // ---- entry points ---------------------------------------------------------------------------

  async function handle(msg: InboundMessage): Promise<void> {
    const adapter = byName.get(msg.platform);
    if (!adapter) return;
    if (!isAllowed(cfg.allowedUsers, msg)) {
      const key = `${msg.platform}:${msg.userId}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[channels] ignoring ${key}; add it to ALLOWED_USERS to let them in`);
      }
      return;
    }
    const chat: Chat = { adapter, platform: msg.platform, chatId: msg.chatId };
    try {
      if (msg.callback) return await onTap(chat, msg);
      const text = msg.text.trim();
      if (!text) return;
      const cmd = /^\/([A-Za-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text);
      if (cmd) {
        const name = (cmd[1] ?? '').toLowerCase();
        await onCommand(chat, name, (cmd[2] ?? '').trim());
        // Joining with /link makes this person one of the user's owners too.
        if (name === 'link') {
          const uid = await linkedUser(msg.platform, msg.chatId);
          if (uid) owners.set(uid, (owners.get(uid) ?? new Set()).add(ownerKey(msg)));
        }
        return;
      }

      const userId = await userFor(msg.platform, msg.chatId);
      owners.set(userId, (owners.get(userId) ?? new Set()).add(ownerKey(msg)));
      const qid = awaitingText.get(userId);
      const q = qid ? pending.get(qid) : undefined;
      if (qid && q?.kind === 'question') return await answerQuestion(qid, q, text, msg.userName ?? msg.userId);

      const ahead = enqueue(userId, () => runTurn(chat, userId, { kind: 'message', content: text }));
      if (ahead > 0) await say(chat, `queued · ${ahead} ahead. /stop to cut in.`);
    } catch (err) {
      logErr('handle')(err);
      await say(chat, `✗ ${(err as Error).message}`).catch(() => {});
    }
  }

  async function deliver(to: { platform: string; chatId: string }, text: string): Promise<void> {
    const adapter = byName.get(to.platform);
    if (!adapter) throw new Error(`no ${to.platform} adapter running`);
    const chat: Chat = { adapter, platform: to.platform, chatId: to.chatId };
    const body = redact(text);
    if (body.length > ATTACH_OVER) {
      const data = Buffer.from(body, 'utf8');
      await say(chat, `${headOf(body, 600)}\n\n▤ full report attached · ${fmtBytes(data.length)}`);
      await adapter.send(to.chatId, { text: '', attachments: [{ filename: 'report.md', data, kind: 'document' }] });
      return;
    }
    for (const chunk of splitText(body, adapter.limit)) await say(chat, chunk);
  }

  async function idle(): Promise<void> {
    while (true) {
      const tails = [...lanes.values()].map((l) => l.tail);
      await Promise.all(tails);
      if ([...lanes.values()].every((l, i) => l.tail === tails[i] && !l.running)) return;
    }
  }

  async function close(): Promise<void> {
    for (const a of opts.adapters) await a.stop?.().catch(logErr(`stop ${a.name}`));
  }

  return { handle, deliver, close, idle };
}
