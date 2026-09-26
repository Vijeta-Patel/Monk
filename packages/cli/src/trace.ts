// Prints a TrueForge session compactly: `node packages/cli/src/trace.ts <session-id>`.
import { contentToText, createTrueForgeClient, loadConfig, redact, unwrapToolCall, type TrueForgeApi } from '@monk/shared';

const id = process.argv[2];
if (!id) throw new Error('usage: trace.ts <session-id>');
const client = createTrueForgeClient(loadConfig());
const items: TrueForgeApi.SessionEventItem[] = [];
for await (const it of await client.sessions.listEvents(id, { limit: 100 })) items.push(it);
for (const { event: e } of items.reverse()) {
  const ev = e as unknown as Record<string, unknown> & { type: string };
  if (ev.type === 'turn.created') {
    for (const i of (ev.input as { type: string; content?: unknown }[]) ?? []) console.log(`USER ${i.type}: ${redact(String(i.content ?? '')).slice(0, 300)}`);
  } else if (ev.type === 'model.message') {
    const m = ev as unknown as TrueForgeApi.ModelMessageEvent;
    const text = contentToText(m.content).trim();
    if (text) console.log(`AGENT: ${redact(text).replace(/\s+/g, ' ').slice(0, 400)}`);
    for (const tc of m.toolCalls ?? []) {
      const r = unwrapToolCall(tc.function.name, tc.function.arguments ?? '', null);
      console.log(`  CALL ${r.name} ${redact(r.args).slice(0, 160)}`);
    }
  } else if (ev.type === 'tool.response') {
    console.log(`  → ${redact(String(ev.content)).replace(/\s+/g, ' ').slice(0, 200)}`);
  } else if (ev.type === 'tool.approval_required') {
    console.log('  ◆ approval required');
  } else if (ev.type === 'turn.done') {
    const st = ev.state as { status: string; message?: string };
    console.log(`DONE ${st.status}${st.message ? `: ${st.message}` : ''}`);
  }
}
