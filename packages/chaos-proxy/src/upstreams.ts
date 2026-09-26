import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { redact } from '@monk/shared';
import type { UpstreamSpec } from './types.ts';

export type ToolEntry = { tool: Tool; upstream: string; mobile: boolean };
export type UpstreamStatus = { name: string; transport: string; connected: boolean; tools: number; error: string | null };
type Log = (msg: string) => void;

const RETRY_MS = 5_000;

class Upstream {
  spec: UpstreamSpec;
  client: Client | null = null;
  tools: Tool[] = [];
  connecting: Promise<void> | null = null;
  lastAttempt = 0;
  lastError: string | null = null;
  closed = false;
  private inprocClose: (() => Promise<void>) | null = null;

  constructor(spec: UpstreamSpec) {
    this.spec = spec;
  }

  get mobile(): boolean {
    return this.spec.mobile ?? this.spec.name === 'mobile';
  }

  connect(log: Log, onTools: () => void): Promise<void> {
    if (this.client || this.closed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.lastAttempt = Date.now();
    this.connecting = (async () => {
      const client = new Client({ name: 'monk-chaos-proxy', version: '0.1.0' });
      try {
        const transport = await this.transport();
        await client.connect(transport, { timeout: this.spec.transport === 'stdio' ? 120_000 : 15_000 });
        const tools: Tool[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          tools.push(...page.tools);
          cursor = page.nextCursor;
        } while (cursor);
        client.onclose = () => {
          if (this.client === client) this.client = null;
        };
        this.client = client;
        this.tools = tools;
        this.lastError = null;
        log(`upstream ${this.spec.name}: connected, ${tools.length} tools`);
        onTools();
      } catch (err) {
        this.lastError = redact(err instanceof Error ? err.message : String(err));
        log(`upstream ${this.spec.name}: connect failed (${this.lastError}); will retry lazily`);
        await client.close().catch(() => {});
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private async transport(): Promise<Transport> {
    const s = this.spec;
    if (s.transport === 'stdio') {
      return new StdioClientTransport({ command: s.command, args: s.args ?? [], env: s.env, stderr: 'ignore' });
    }
    if (s.transport === 'http') {
      return new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } });
    }
    const server = typeof s.server === 'function' ? await s.server() : s.server;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    this.inprocClose = async () => {
      await server.close?.();
    };
    return clientSide;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.client?.close().catch(() => {});
    await this.inprocClose?.().catch(() => {});
    this.client = null;
  }
}

/** Upstream MCP clients, shared by every proxy session. Connect failures never throw; calls retry lazily. */
export class UpstreamPool {
  private ups: Upstream[];
  private log: Log;
  private warned = new Set<string>();
  onToolsChanged: () => void = () => {};

  constructor(specs: UpstreamSpec[], log: Log = (m) => console.warn(`[chaos-proxy] ${m}`)) {
    this.ups = specs.map((s) => new Upstream(s));
    this.log = log;
  }

  /** Starts (or retries) connections for upstreams that are down; resolves when those attempts settle. */
  ensure(force = false): Promise<void> {
    const now = Date.now();
    const pending = this.ups
      .filter((u) => !u.client && !u.closed && (u.connecting || force || now - u.lastAttempt >= RETRY_MS))
      .map((u) => u.connect(this.log, () => this.onToolsChanged()));
    return Promise.all(pending).then(() => {});
  }

  /** Waits up to `ms` for connections in flight. */
  async ready(ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.ensure(), new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
  }

  /** Merged tool registry; on a name collision the earlier upstream wins. */
  tools(): Map<string, ToolEntry> {
    const out = new Map<string, ToolEntry>();
    for (const u of this.ups) {
      for (const tool of u.tools) {
        const prev = out.get(tool.name);
        if (prev) {
          const key = `${tool.name}:${u.spec.name}`;
          if (!this.warned.has(key)) {
            this.warned.add(key);
            this.log(`tool name collision: ${tool.name} from ${u.spec.name} hidden by ${prev.upstream}`);
          }
          continue;
        }
        out.set(tool.name, { tool, upstream: u.spec.name, mobile: u.mobile });
      }
    }
    return out;
  }

  isMobile(upstream: string): boolean {
    return this.ups.find((u) => u.spec.name === upstream)?.mobile ?? false;
  }

  async call(upstream: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const u = this.ups.find((x) => x.spec.name === upstream);
    if (!u) throw new Error(`unknown upstream ${upstream}`);
    if (!u.client) await u.connect(this.log, () => this.onToolsChanged());
    if (!u.client) throw new Error(`upstream ${upstream} is unavailable: ${u.lastError ?? 'not connected'}`);
    const res = await u.client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    if ('toolResult' in res && !('content' in res)) {
      return { content: [{ type: 'text', text: JSON.stringify(res.toolResult) }] };
    }
    return res as CallToolResult;
  }

  status(): UpstreamStatus[] {
    return this.ups.map((u) => ({ name: u.spec.name, transport: u.spec.transport, connected: !!u.client, tools: u.tools.length, error: u.lastError }));
  }

  async close(): Promise<void> {
    await Promise.all(this.ups.map((u) => u.close()));
  }
}
