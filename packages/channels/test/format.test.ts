import { describe, expect, it } from 'vitest';
import {
  errorSummary,
  escapeHtml,
  fmtDuration,
  headOf,
  humanizeTool,
  longestCodeBlock,
  mdToPlain,
  mdToTelegramHtml,
  splitText,
  tailOf,
  toolTargets,
} from '../src/format.ts';
import { approvalCard } from '../src/gateway.ts';
import { discordText, toActionRows } from '../src/adapters/discord.ts';
import { telegramText, toInlineKeyboard } from '../src/adapters/telegram.ts';

describe('telegram html', () => {
  it('escapes everything that is not markup', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
    expect(mdToTelegramHtml('use <T> & **bold** and `x<y>`')).toBe('use &lt;T&gt; &amp; <b>bold</b> and <code>x&lt;y&gt;</code>');
  });

  it('renders fences, headings and links, and closes an unfinished fence', () => {
    expect(mdToTelegramHtml('# Title\n```ts\nconst a = 1 < 2;\n```\nsee [PR](https://github.com/a/b/pull/1?x="1")')).toBe(
      '<b>Title</b>\n<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>\nsee <a href="https://github.com/a/b/pull/1?x=&quot;1&quot;">PR</a>',
    );
    expect(mdToTelegramHtml('streaming\n```\npartial <code')).toBe('streaming\n<pre>partial &lt;code</pre>');
  });

  it('leaves single asterisks and underscores alone', () => {
    expect(mdToTelegramHtml('rate_limit * 2 = _x_')).toBe('rate_limit * 2 = _x_');
  });

  it('telegramText picks HTML only for markdown', () => {
    expect(telegramText({ text: '**a**', markdown: true })).toEqual({ text: '<b>a</b>', parse_mode: 'HTML' });
    expect(telegramText({ text: '**a**' })).toEqual({ text: '**a**' });
  });

  it('mdToPlain strips markup', () => {
    expect(mdToPlain('**ok** `x`\n```\ncode\n```\n[a](https://b.c)')).toBe('ok x\ncode\na (https://b.c)');
  });
});

describe('splitText', () => {
  it('keeps short text whole', () => {
    expect(splitText('hello', 10)).toEqual(['hello']);
  });

  it('splits at paragraphs, then lines, never over the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `paragraph ${i} ${'z'.repeat(30)}`).join('\n\n');
    const chunks = splitText(text, 200);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join('\n\n')).toBe(text);
  });

  it('hard-cuts a single huge word', () => {
    const chunks = splitText('a'.repeat(250), 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe('a'.repeat(250));
  });

  it('closes and reopens a code fence cut in two', () => {
    const text = 'intro\n```py\n' + Array.from({ length: 30 }, (_, i) => `print(${i})`).join('\n') + '\n```\nafter';
    const chunks = splitText(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120);
      expect((c.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(chunks[1]!.startsWith('```py\n')).toBe(true);
  });
});

describe('small helpers', () => {
  it('humanizes tool names', () => {
    expect(humanizeTool('merge_pull_request')).toBe('merge pull request');
    expect(humanizeTool('github__createRelease')).toBe('create release');
    expect(humanizeTool('mobile_uninstall-app')).toBe('mobile uninstall app');
  });

  it('parses targets from args, exact for identifiers', () => {
    expect(toolTargets('merge_pull_request', JSON.stringify({ owner: 'acme', repo: 'app', pullNumber: 12, merge_method: 'squash' }))).toEqual([
      { label: 'repo', value: 'acme/app' },
      { label: 'pr', value: '#12' },
      { label: 'method', value: 'squash' },
    ]);
    expect(toolTargets('create_release', JSON.stringify({ repo: 'acme/app', tag_name: 'v1.3', target_commitish: 'main', draft: false }))).toEqual([
      { label: 'repo', value: 'acme/app' },
      { label: 'tag', value: 'v1.3' },
      { label: 'target commitish', value: 'main' },
      { label: 'draft', value: 'false' },
    ]);
    expect(toolTargets('uninstall_app', JSON.stringify({ packageName: 'com.acme.app' }))).toEqual([{ label: 'app', value: 'com.acme.app' }]);
    expect(toolTargets('close_issue', JSON.stringify({ owner: 'a', repo: 'b', number: 7 }))).toEqual([
      { label: 'repo', value: 'a/b' },
      { label: 'issue', value: '#7' },
    ]);
    expect(toolTargets('x', 'not json')).toEqual([]);
  });

  it('summarizes MCP errors', () => {
    expect(errorSummary('{"error":"429 Too Many Requests"}')).toBe('429 too many requests');
    expect(errorSummary('{"error":{"message":"Timeout after 30s"}}')).toBe('timeout after 30s');
    expect(errorSummary('plain failure\nstack')).toBe('plain failure');
  });

  it('formats durations', () => {
    expect(fmtDuration(812)).toBe('0.8s');
    expect(fmtDuration(12_600)).toBe('13s');
    expect(fmtDuration(64_000)).toBe('1m 4s');
  });

  it('measures code blocks and trims previews', () => {
    expect(longestCodeBlock('a\n```\n1234\n```\n```\n12\n')).toBe(5);
    expect(tailOf('line1\nline2\nline3', 10)).toBe('…\nline3');
    expect(headOf('para one\n\npara two is long', 12)).toBe('para one …');
  });

  it('builds an approval card with exact targets', () => {
    const card = approvalCard([
      { threadId: 'main', callId: 'c1', name: 'merge_pull_request', server: 'monk-chaos', args: '{"owner":"acme","repo":"app","pull_number":12}' },
    ]);
    expect(card).toBe(
      "**before I ship this, I need your ok**\n\n**merge pull request**\n```\nrepo  acme/app\npr    #12\n```\n\nthis one's forever.",
    );
  });
});

describe('keyboards', () => {
  const rows = [
    [
      { text: '✓ Approve', data: 'ap:abcd1234:y', style: 'success' as const },
      { text: '✗ Reject', data: 'ap:abcd1234:n', style: 'danger' as const },
    ],
    [{ text: 'Cancel', data: 'x'.repeat(80), style: 'secondary' as const }],
  ];

  it('telegram: inline keyboard with styles and 64-byte callback data', () => {
    const kb = toInlineKeyboard(rows);
    expect(kb.inline_keyboard[0]).toEqual([
      { text: '✓ Approve', callback_data: 'ap:abcd1234:y', style: 'success' },
      { text: '✗ Reject', callback_data: 'ap:abcd1234:n', style: 'danger' },
    ]);
    expect(kb.inline_keyboard[1]![0]).toEqual({ text: 'Cancel', callback_data: 'x'.repeat(64) });
  });

  it('discord: action rows with button styles', () => {
    const json = toActionRows(rows).map((r) => r.toJSON());
    expect(json).toHaveLength(2);
    expect(json[0]!.components.map((c) => ({ ...c }))).toEqual([
      { type: 2, custom_id: 'ap:abcd1234:y', label: '✓ Approve', style: 3 },
      { type: 2, custom_id: 'ap:abcd1234:n', label: '✗ Reject', style: 4 },
    ]);
  });

  it('discord: escapes plain text, caps at 2000', () => {
    expect(discordText({ text: '**x**' })).toBe('\\*\\*x\\*\\*');
    expect(discordText({ text: 'y'.repeat(2500), markdown: true })).toHaveLength(2000);
  });
});
