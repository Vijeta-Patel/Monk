import { afterEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@monk/shared';
import { startGateway } from '../src/index.ts';
import { FakeAdapter, done, ev, fakeChaos, paused, setup, textTurn, toolCallMsg } from './fakes.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('allowlist', () => {
  it('ignores unknown users silently and accepts prefixed or bare ids', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.say(t.tg, 'hello', { userId: '999' });
    await t.gw.idle();
    expect(t.tg.sent).toHaveLength(0);
    expect(t.tf.created).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);

    // Bare "42" matches on any platform.
    await t.say(t.dc, 'hello', { userId: '42' });
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(1);
    warn.mockRestore();
  });

  it('ignores taps from strangers', async () => {
    const t = setup();
    t.tf.scripts.push([toolCallMsg('m1', 'c1', 'delete_branch', { owner: 'acme', repo: 'app', branch: 'old' }), ev({ type: 'tool.approval_required', id: 'a', toolCalls: [{ id: 'c1', sourceEventId: 'm1' }] }), paused()]);
    await t.say(t.tg, 'clean up');
    await t.gw.idle();
    const card = t.tg.withButtons()[0]!;
    const data = card.out.buttons![0]![0]!.data;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.tap(t.tg, data, { userId: '555' }); // not allowlisted
    await t.tap(t.dc, data, { userId: '42', chatId: 'other' }); // allowed, but a different Monk user
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(1);
  });
});

describe('streaming', () => {
  it('edits one message, at most once a second, and lands the final text', async () => {
    vi.useFakeTimers();
    const t = setup({ intervalMs: 1000 });
    const words = 'On it. Looking at the open pull requests in acme/app now.'.split(' ').map((w) => `${w} `);
    t.tf.scripts.push(textTurn(words, 300));
    await t.say(t.tg, 'status of acme/app?');
    await vi.advanceTimersByTimeAsync(20_000);
    await t.gw.idle();

    expect(t.tg.sent).toHaveLength(1);
    const msgId = t.tg.sent[0]!.id;
    const edits = t.tg.edits.filter((e) => e.msgId === msgId);
    expect(edits.length).toBeGreaterThan(1);
    expect(edits.length).toBeLessThan(words.length); // throttled, not one edit per delta
    const times = [t.tg.sent[0]!.at, ...edits.map((e) => e.at)];
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1000);
    expect(edits.at(-1)!.text).toBe('On it. Looking at the open pull requests in acme/app now.');
  });

  it('renders tool calls as compact lines with ⚡ on faults', async () => {
    const t = setup();
    t.tf.scripts.push([
      ev({ type: 'turn.created', id: 't', turnId: 'x', input: [] }),
      toolCallMsg('m1', 'c1', 'list_issues', { repo: 'acme/app' }),
      ev({ type: 'tool.response', id: 'r1', toolCallId: 'c1', content: '{"error":"429 rate limit, retry_after 2"}' }),
      toolCallMsg('m2', 'c2', 'list_issues', { repo: 'acme/app' }),
      ev({ type: 'tool.response', id: 'r2', toolCallId: 'c2', content: '[]' }),
      ev({ type: 'model.message', id: 'm3', content: 'No open issues.' }),
      done(),
    ]);
    await t.say(t.tg, 'issues?');
    await t.gw.idle();
    const text = t.tg.textOf(t.tg.sent[0]!.id);
    expect(text).toMatch(/^▸ list issues ⚡ 429 rate limit, retry_after 2 \d+\.\ds\n▸ list issues ✓ \d+\.\ds\n\nNo open issues\.$/);
  });

  it('splits long replies at the platform limit and attaches very long ones', async () => {
    const t = setup();
    const para = (n: number) => Array.from({ length: n }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const medium = para(60); // ~2.9k chars: over Discord's 2000, under the attach threshold
    t.tf.scripts.push([ev({ type: 'model.message', id: 'm1', content: medium }), done()]);
    await t.say(t.dc, 'medium');
    await t.gw.idle();
    const first = t.dc.sent[0]!;
    expect(t.dc.textOf(first.id).length).toBeLessThanOrEqual(2000);
    expect(t.dc.sent).toHaveLength(2);
    expect(t.dc.textOf(first.id) + '\n' + t.dc.sent[1]!.out.text).toBe(medium);

    const long = para(120);
    t.tf.scripts.push([ev({ type: 'model.message', id: 'm1', content: long }), done()]);
    await t.say(t.tg, 'long');
    await t.gw.idle();
    const file = t.tg.sent.find((s) => s.out.attachments?.length)!;
    expect(file.out.attachments![0]!.filename).toBe('reply.md');
    expect(file.out.attachments![0]!.data.toString()).toBe(long);
    expect(t.tg.textOf(t.tg.sent[0]!.id)).toMatch(/full reply attached · \d+\.\d KB$/);
  });

  it('sends code blocks that cannot fit one message as a file', async () => {
    const t = setup();
    const code = '```ts\n' + 'const a = 1;\n'.repeat(180) + '```';
    t.tf.scripts.push([ev({ type: 'model.message', id: 'm1', content: `Here:\n\n${code}` }), done()]);
    await t.say(t.dc, 'code');
    await t.gw.idle();
    expect(t.dc.sent.some((s) => s.out.attachments?.[0]?.filename === 'reply.md')).toBe(true);
  });

  it('redacts secrets before they leave', async () => {
    const t = setup();
    t.tf.scripts.push(textTurn(['token is ghp_abcdefghijklmnopqrstuvwxyz0123 ok']));
    await t.say(t.tg, 'x');
    await t.gw.idle();
    expect(t.tg.textOf(t.tg.sent[0]!.id)).toBe('token is [redacted] ok');
  });
});

describe('sessions and links', () => {
  it('creates a session lazily and reuses it', async () => {
    const t = setup();
    await t.say(t.tg, 'one');
    await t.gw.idle();
    await t.say(t.tg, 'two');
    await t.gw.idle();
    expect(t.tf.created).toEqual(['ses_1']);
    expect(t.tf.turns.map((x) => x.sessionId)).toEqual(['ses_1', 'ses_1']);
    expect(t.tf.turns[0]!.input).toEqual([{ type: 'user.message', content: 'one' }]);
  });

  it('continues the same session on another platform after /link', async () => {
    const t = setup();
    await t.say(t.tg, 'start on telegram');
    await t.gw.idle();
    await t.say(t.tg, '/link');
    const code = /\*\*([A-Z2-9]{6})\*\*/.exec(t.tg.last().out.text)![1]!;
    await t.say(t.dc, `/link ${code.toLowerCase()}`);
    expect(t.dc.last().out.text).toContain('picking up session `ses_1`');
    await t.say(t.dc, 'continue on discord');
    await t.gw.idle();
    expect(t.tf.created).toEqual(['ses_1']);
    expect(t.tf.turns.map((x) => x.sessionId)).toEqual(['ses_1', 'ses_1']);

    // Codes are single-use.
    await t.say(t.dc, `/link ${code}`, { chatId: 'another' });
    expect(t.dc.last().out.text).toContain("didn't work");
  });

  it('rejects expired codes', async () => {
    const t = setup();
    await t.db.insert(schema.users).values({ userId: 'u1' });
    await t.db.insert(schema.linkCodes).values({ code: 'ABCDEF', userId: 'u1', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await t.say(t.dc, '/link ABCDEF');
    expect(t.dc.last().out.text).toContain("didn't work");
  });

  it('/new and /agent reset the session', async () => {
    const t = setup();
    await t.say(t.tg, 'hi');
    await t.gw.idle();
    await t.say(t.tg, '/agent researcher');
    await t.say(t.tg, 'hi again');
    await t.gw.idle();
    expect(t.tf.created).toEqual(['ses_1', 'ses_2']);
    await t.say(t.tg, '/status');
    expect(t.tg.last().out.text).toContain('agent    researcher');
    await t.say(t.tg, '/new');
    await t.say(t.tg, 'third');
    await t.gw.idle();
    expect(t.tf.created).toHaveLength(3);
  });
});

describe('approvals and questions', () => {
  function approvalScript() {
    return [
      ev({ type: 'turn.created', id: 't', turnId: 'x', input: [] }),
      toolCallMsg('m1', 'c1', 'merge_pull_request', { owner: 'acme', repo: 'app', pullNumber: 12, merge_method: 'squash' }, 'Merging PR #12 into main.'),
      ev({ type: 'tool.approval_required', id: 'a', toolCalls: [{ id: 'c1', sourceEventId: 'm1' }] }),
      paused(),
    ];
  }

  it('shows an exact card, and a tap sends an approvals turn and streams the rest', async () => {
    const t = setup();
    t.tf.scripts.push(approvalScript(), textTurn(['Merged. v1.3 is out.']));
    await t.say(t.tg, 'merge PR 12 and publish v1.3');
    await t.gw.idle();

    const reply = t.tg.textOf(t.tg.sent[0]!.id);
    expect(reply).toContain('▸ merge pull request · needs your ok');
    const card = t.tg.withButtons()[0]!;
    expect(card.out.text).toContain('**merge pull request**');
    expect(card.out.text).toContain('repo    acme/app');
    expect(card.out.text).toContain('pr      #12');
    expect(card.out.text).toContain('method  squash');
    expect(card.out.text).toContain("this one's forever.");
    const [approve, reject] = card.out.buttons![0]!;
    expect(approve).toMatchObject({ text: '✓ Approve', style: 'success' });
    expect(reject).toMatchObject({ text: '✗ Reject', style: 'danger' });

    const before = t.tg.sent.length;
    await t.tap(t.tg, approve!.data);
    await t.gw.idle();
    expect(t.tf.turns[1]).toEqual({
      sessionId: 'ses_1',
      input: [{ type: 'user.tool_approval', threadId: 'main', toolCallId: 'c1', approval: { status: 'allow' } }],
    });
    expect(t.tg.textOf(card.id)).toMatch(/^✓ \*\*approved\*\* by @chetan · \d\d:\d\d\nmerge pull request · acme\/app · pr #12 · squash$/);
    const continuation = t.tg.sent[before]!;
    expect(t.tg.textOf(continuation.id)).toBe('Merged. v1.3 is out.');

    // A second tap on the same card does nothing new.
    await t.tap(t.tg, approve!.data);
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(2);
  });

  it("in a shared chat, only the person who asked can approve", async () => {
    const t = setup({ allowed: 'telegram:1,telegram:2' });
    t.tf.scripts.push(approvalScript());
    await t.say(t.tg, 'merge', { userId: '1', chatId: 'group' });
    await t.gw.idle();
    const card = t.tg.withButtons()[0]!;
    await t.tap(t.tg, card.out.buttons![0]![0]!.data, { userId: '2', chatId: 'group', userName: '@teammate' });
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(1);
    expect(t.tg.last().out.text).toContain('only the person who asked');
    await t.tap(t.tg, card.out.buttons![0]![0]!.data, { userId: '1', chatId: 'group' });
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(2);
  });

  it('reject sends a deny with who rejected', async () => {
    const t = setup();
    t.tf.scripts.push(approvalScript());
    await t.say(t.tg, 'merge');
    await t.gw.idle();
    const card = t.tg.withButtons()[0]!;
    await t.tap(t.tg, card.out.buttons![0]![1]!.data);
    await t.gw.idle();
    expect(t.tf.turns[1]!.input).toEqual([
      { type: 'user.tool_approval', threadId: 'main', toolCallId: 'c1', approval: { status: 'deny', reason: 'rejected by @chetan' } },
    ]);
    expect(t.tg.textOf(card.id)).toContain('✗ **rejected** by @chetan');
  });

  it('lets a linked chat on another platform approve', async () => {
    const t = setup();
    t.tf.scripts.push(approvalScript());
    await t.say(t.tg, 'merge');
    await t.gw.idle();
    await t.say(t.tg, '/link');
    const code = /\*\*([A-Z2-9]{6})\*\*/.exec(t.tg.last().out.text)![1]!;
    await t.say(t.dc, `/link ${code}`);
    const card = t.tg.withButtons()[0]!;
    await t.tap(t.dc, card.out.buttons![0]![0]!.data);
    await t.gw.idle();
    expect(t.tf.turns).toHaveLength(2);
  });

  it('renders questions as option buttons and answers with a tool response', async () => {
    const t = setup();
    t.tf.scripts.push([
      toolCallMsg('m1', 'q1', 'ask_user_question', { question: 'Which repo?', options: ['acme/app', 'acme/web'] }),
      ev({ type: 'tool.response_required', id: 'r', toolCalls: [{ id: 'q1', sourceEventId: 'm1' }] }),
      paused(),
    ]);
    await t.say(t.tg, 'open an issue');
    await t.gw.idle();
    expect(t.tg.textOf(t.tg.sent[0]!.id)).not.toContain('ask user question');
    const card = t.tg.withButtons()[0]!;
    expect(card.out.text).toContain('**Which repo?**');
    expect(card.out.buttons!.flat().map((b) => b.text)).toEqual(['acme/app', 'acme/web']);
    await t.tap(t.tg, card.out.buttons![0]![1]!.data);
    await t.gw.idle();
    expect(t.tf.turns[1]!.input).toEqual([{ type: 'user.tool_response', threadId: 'main', toolCallId: 'q1', content: 'acme/web' }]);
    expect(t.tg.textOf(card.id)).toContain('✓ acme/web · @chetan');
  });

  it('takes a typed reply as the answer to an open question', async () => {
    const t = setup();
    t.tf.scripts.push([
      toolCallMsg('m1', 'q1', 'ask_user_question', { question: 'What title?', options: [] }),
      ev({ type: 'tool.response_required', id: 'r', toolCalls: [{ id: 'q1', sourceEventId: 'm1' }] }),
      paused(),
    ]);
    await t.say(t.tg, 'file a bug');
    await t.gw.idle();
    await t.say(t.tg, 'Crash on login');
    await t.gw.idle();
    expect(t.tf.turns[1]!.input).toEqual([{ type: 'user.tool_response', threadId: 'main', toolCallId: 'q1', content: 'Crash on login' }]);
  });
});

describe('stop and queue', () => {
  it('/stop cancels the running turn and drops queued messages', async () => {
    const t = setup();
    t.tf.scripts.push([
      ev({ type: 'turn.created', id: 't', turnId: 'x', input: [] }),
      ev({ type: 'model.message', id: 'm1', content: '' }),
      ev({ type: 'model.message.delta', id: 'm1', content: 'Working on it' }),
      () => t.tf.untilCancelled(),
      ev({ type: 'turn.done', id: 'd', threadId: null, state: { status: 'cancelled', reason: 'user' } }),
    ]);
    await t.say(t.tg, 'long task');
    await new Promise((r) => setTimeout(r, 20));
    await t.say(t.tg, 'and then this');
    expect(t.tg.last().out.text).toBe('queued · 1 ahead. /stop to cut in.');
    await t.say(t.tg, '/stop');
    await t.gw.idle();
    expect(t.tf.cancelled).toEqual(['ses_1']);
    expect(t.tf.turns).toHaveLength(1); // the queued one was dropped
    expect(t.tg.textOf(t.tg.sent[0]!.id)).toBe('Working on it\n\n■ stopped.');
    expect(t.tg.sent.some((s) => s.out.text === 'stopping. dropped 1 queued.')).toBe(true);
  });

  it('runs queued messages one after another', async () => {
    const t = setup();
    const order: string[] = [];
    t.tf.scripts.push(
      [async () => void order.push('a:start'), 30, async () => void order.push('a:end'), done()],
      [async () => void order.push('b:start'), done()],
    );
    await t.say(t.tg, 'a');
    await t.say(t.tg, 'b');
    await t.gw.idle();
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('/stop with nothing running says so', async () => {
    const t = setup();
    await t.say(t.tg, '/stop');
    expect(t.tg.last().out.text).toBe('nothing running.');
  });
});

describe('commands', () => {
  it('/chaos sets profiles, injects faults, turns off and reports', async () => {
    const t = setup();
    await t.say(t.tg, 'hi');
    await t.gw.idle();
    await t.say(t.tg, '/chaos pressure');
    expect(t.chaos.calls.set.at(-1)).toEqual({ enabled: true, profile: 'pressure' });
    expect(t.tg.last().out.text).toContain('⚡ chaos **pressure**');
    await t.say(t.tg, '/chaos rate_limit list_issues');
    expect(t.chaos.calls.inject.at(-1)).toEqual({ fault: 'rate_limit', tool: 'list_issues', tfSessionId: 'ses_1' });
    await t.say(t.tg, '/chaos popup');
    expect(t.chaos.calls.inject.at(-1)).toEqual({ fault: 'popup', tfSessionId: 'ses_1' });
    await t.say(t.tg, '/chaos status');
    expect(t.tg.last().out.text).toContain('queued: rate_limit → list_issues, popup');
    await t.say(t.tg, '/chaos off');
    expect(t.chaos.calls.set.at(-1)).toEqual({ enabled: false });
    await t.say(t.tg, '/chaos nonsense');
    expect(t.tg.last().out.text).toContain("don't know `nonsense`");
  });

  it('/cron add shows a confirm card, saves on tap and reloads', async () => {
    const t = setup();
    await t.say(t.tg, '/cron add every weekday 9am, summarize open PRs in acme/app');
    expect(t.cron.calls.parse).toEqual(['every weekday 9am, summarize open PRs in acme/app']);
    const card = t.tg.last();
    expect(card.out.text).toContain('every weekday at 09:00 (Asia/Kolkata): summarize open PRs in acme/app');
    expect(card.out.text).toMatch(/next · Thu 24 Sept?, 09:00/);
    const save = card.out.buttons![0]![0]!;
    expect(save.text).toBe('✓ Save');
    await t.tap(t.tg, save.data);
    expect(t.cron.calls.create).toEqual([
      expect.objectContaining({ cron: '0 9 * * 1-5', prompt: 'summarize open PRs in acme/app', deliverTo: { platform: 'telegram', chatId: 'c-1' }, agent: 'monk' }),
    ]);
    expect(t.cron.calls.reload).toBe(1);
    expect(t.tg.textOf(card.id)).toContain('✓ **scheduled** · `job_1`');

    await t.say(t.tg, '/cron add every day at 6pm, hello');
    const card2 = t.tg.last();
    await t.tap(t.tg, card2.out.buttons![0]![1]!.data);
    expect(t.cron.calls.create).toHaveLength(1);
    expect(t.tg.textOf(card2.id)).toContain('not scheduled');

    await t.say(t.tg, '/cron rm job_1');
    expect(t.tg.last().out.text).toBe('✓ removed `job_1`.');
    expect(t.cron.calls.reload).toBe(2);
  });

  it('/screen sends the phone screenshot as a photo', async () => {
    const t = setup();
    await t.say(t.tg, '/screen');
    expect(t.tg.last().out.text).toContain('no phone attached');
    t.chaos.setScreen(Buffer.from([0x89, 0x50]));
    await t.say(t.tg, '/screen');
    expect(t.tg.last().out.attachments![0]).toMatchObject({ filename: 'screen.png', kind: 'photo' });
  });

  it('/skills lists active skills with win rates', async () => {
    const t = setup();
    await t.db.insert(schema.skills).values([
      { name: 'rate-limit-backoff', type: 'recovery', description: 'd', body: 'b', status: 'active' },
      { name: 'draft-one', type: 'recovery', description: 'd', body: 'b', status: 'draft' },
    ]);
    await t.db.insert(schema.skillUses).values([
      { skillName: 'rate-limit-backoff', tfSessionId: 's', succeeded: true },
      { skillName: 'rate-limit-backoff', tfSessionId: 's', succeeded: true },
      { skillName: 'rate-limit-backoff', tfSessionId: 's', succeeded: false },
    ]);
    await t.say(t.tg, '/skills');
    const text = t.tg.last().out.text;
    expect(text).toContain('1 active');
    expect(text).toContain('rate-limit-backoff  2/3  67%');
    expect(text).not.toContain('draft-one');
  });

  it('/help and unknown commands, including /cmd@botname', async () => {
    const t = setup();
    await t.say(t.tg, '/help@monk_bot');
    expect(t.tg.last().out.text).toContain('/chaos <profile|fault|off|status>');
    await t.say(t.tg, '/wat');
    expect(t.tg.last().out.text).toBe('no /wat here. /help lists what I know.');
    expect(t.tf.turns).toHaveLength(0);
  });
});

describe('deliver and startGateway', () => {
  it('delivers to a chat, splitting at the limit', async () => {
    const t = setup();
    const text = Array.from({ length: 50 }, (_, i) => `row ${i} ${'y'.repeat(50)}`).join('\n');
    await t.gw.deliver({ platform: 'discord', chatId: 'c-7' }, text);
    expect(t.dc.sent.length).toBe(2);
    expect(t.dc.sent.every((s) => s.out.text.length <= 2000)).toBe(true);
    await expect(t.gw.deliver({ platform: 'slack', chatId: 'x' }, 'hi')).rejects.toThrow(/no slack adapter/);
  });

  it('starts given adapters and routes their messages', async () => {
    const t = setup();
    const a = new FakeAdapter('telegram');
    const gw = await startGateway({ db: t.db, client: t.tf.asClient(), cfg: t.cfg, adapters: [a], chaos: fakeChaos().api, streamIntervalMs: 0 });
    await a.emit({ platform: 'telegram', chatId: 'c', userId: '1', text: '/help', messageId: '1' });
    expect(a.last().out.text).toContain('**monk**');
    await gw.close();
  });
});
