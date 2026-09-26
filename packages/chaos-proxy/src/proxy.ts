import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, isInitializeRequest, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { CHAOS_PROXY_SERVER_NAME, createRouter, HttpError, sendJson, type ChaosState, type FaultType, type MonkConfig, type MonkDb } from '@monk/shared';
import { adbDevice, adbReady, type Device } from './device.ts';
import { ChaosEngine } from './engine.ts';
import { monkToolsServer } from './monk-tools.ts';
import { loadProfile, OFF_PROFILE, type ChaosProfile } from './profile.ts';
import type { UpstreamSpec } from './types.ts';
import { UpstreamPool } from './upstreams.ts';

export type ChaosControl = {
  state(): ChaosState;
  set(patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number }): Promise<ChaosState>;
  inject(req: { fault: FaultType; tool?: string; tfSessionId?: string }): Promise<ChaosState>;
  listTools(): Promise<{ name: string; description: string; destructive: boolean; upstream: string }[]>;
  screenshot(): Promise<Buffer | null>;
};

const warn = (m: string) => console.warn(`[chaos-proxy] ${m}`);

/** Resolves the phone lazily and re-checks adb at most every 30s. */
function deviceResolver(cfg: MonkConfig): () => Promise<Device | null> {
  let checkedAt = 0;
  let ready = false;
  const dev = adbDevice();
  return async () => {
    if (!cfg.MONK_PHONE) return null;
    if (Date.now() - checkedAt > 30_000) {
      ready = await adbReady();
      checkedAt = Date.now();
    }
    return ready ? dev : null;
  };
}

function githubUpstream(cfg: MonkConfig): UpstreamSpec {
  switch (cfg.GITHUB_MCP) {
    case 'remote':
      return { name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: `Bearer ${cfg.GITHUB_TOKEN}` } };
    case 'binary':
      return { name: 'github', transport: 'stdio', command: 'github-mcp-server', args: ['stdio'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: cfg.GITHUB_TOKEN } };
    case 'docker':
      return {
        name: 'github',
        transport: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: cfg.GITHUB_TOKEN },
      };
  }
}

const ExtraServerSchema = z.discriminatedUnion('transport', [
  z.object({ name: z.string().min(1), transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), mobile: z.boolean().optional() }),
  z.object({ name: z.string().min(1), transport: z.literal('http'), url: z.string().url(), headers: z.record(z.string(), z.string()).optional(), mobile: z.boolean().optional() }),
]);

/**
 * MCP servers the user added. Every one goes behind the proxy, so new tools get chaos-tested and
 * learned from with no code change. `${VAR}` in env/headers is filled from the environment.
 */
export function extraUpstreams(cfg: MonkConfig, env: Record<string, string | undefined> = process.env): UpstreamSpec[] {
  const file = resolve(cfg.rootDir, cfg.MCP_SERVERS_FILE);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const list = z.array(ExtraServerSchema).parse(Array.isArray(raw) ? raw : (raw as { servers?: unknown }).servers);
  const fill = (rec?: Record<string, string>) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.replace(/\$\{(\w+)\}/g, (_, n: string) => env[n] ?? '')])) : undefined;
  return list.map((sv) =>
    sv.transport === 'stdio'
      ? { name: sv.name, transport: 'stdio' as const, command: sv.command, args: sv.args ?? [], env: fill(sv.env) ?? {}, mobile: sv.mobile ?? false }
      : { name: sv.name, transport: 'http' as const, url: sv.url, headers: fill(sv.headers) ?? {}, mobile: sv.mobile ?? false },
  );
}

export function defaultUpstreams(cfg: MonkConfig, device: () => Promise<Device | null>): UpstreamSpec[] {
  const out: UpstreamSpec[] = [];
  if (cfg.GITHUB_TOKEN) {
    out.push(githubUpstream(cfg));
  } else {
    warn('GITHUB_TOKEN is not set; the GitHub MCP upstream is skipped');
  }
  if (cfg.MONK_PHONE) {
    out.push({ name: 'mobile', transport: 'stdio', command: 'npx', args: ['-y', '@mobilenext/mobile-mcp@latest'], mobile: true });
  }
  out.push({ name: 'monk', transport: 'inproc', server: () => monkToolsServer({ cfg, device }), mobile: false });
  try {
    out.push(...extraUpstreams(cfg));
  } catch (err) {
    warn(`ignoring ${cfg.MCP_SERVERS_FILE}: ${(err as Error).message}`);
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  return JSON.parse(text);
}

export async function startChaosProxy(opts: { cfg: MonkConfig; db: MonkDb; upstreams?: UpstreamSpec[]; port?: number }): Promise<{
  control: ChaosControl;
  url: string;
  close(): Promise<void>;
}> {
  const { cfg, db } = opts;
  const device = deviceResolver(cfg);
  let profile: ChaosProfile;
  try {
    profile = await loadProfile(cfg.CHAOS_PROFILE, cfg.rootDir);
  } catch (err) {
    if (cfg.CHAOS_PROFILE !== 'off') throw err;
    profile = OFF_PROFILE;
  }

  const pool = new UpstreamPool(opts.upstreams ?? defaultUpstreams(cfg, device), warn);
  const engine = new ChaosEngine({ cfg, db, pool, profile, device });
  await engine.refreshProfiles();

  type Session = { transport: StreamableHTTPServerTransport; server: Server };
  const sessions = new Map<string, Session>();

  const notifyToolsChanged = () => {
    for (const s of sessions.values()) void s.server.sendToolListChanged().catch(() => {});
  };
  pool.onToolsChanged = notifyToolsChanged;
  engine.onToolsChanged = notifyToolsChanged;
  void pool.ensure(true);

  function makeServer(getSessionId: () => string | undefined): Server {
    const server = new Server({ name: CHAOS_PROXY_SERVER_NAME, version: '0.1.0' }, { capabilities: { tools: { listChanged: true } } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await pool.ready(15_000);
      return { tools: engine.exposedTools() };
    });
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const sid = extra.sessionId ?? getSessionId();
      if (!sid) throw new McpError(ErrorCode.InvalidRequest, 'missing MCP session');
      const res = await engine.handleCall(sid, req.params.name, req.params.arguments as Record<string, unknown> | undefined);
      if (!res) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${req.params.name}`);
      return res;
    });
    return server;
  }

  async function openSession(id?: string): Promise<Session> {
    let transport: StreamableHTTPServerTransport;
    const server = makeServer(() => transport.sessionId);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => id ?? randomUUID(),
      onsessioninitialized: async (sid) => {
        sessions.set(sid, session);
        await engine.registerSession(sid);
      },
    });
    const session: Session = { transport, server };
    transport.onclose = () => {
      if (transport.sessionId && sessions.get(transport.sessionId) === session) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return session;
  }

  /**
   * TrueForge keeps the Mcp-Session-Id across turns, so after a proxy restart it arrives with an id this
   * process never issued. Rather than 404 (which would split one task's accounting across two ids), adopt it.
   * The SDK has no public API for this, hence the reach into the inner transport.
   */
  async function adoptSession(id: string): Promise<Session | null> {
    const session = await openSession(id);
    const inner = (session.transport as unknown as { _webStandardTransport?: { sessionId?: string; _initialized?: boolean } })._webStandardTransport;
    if (!inner || !('_initialized' in inner)) {
      await session.transport.close();
      return null;
    }
    inner.sessionId = id;
    inner._initialized = true;
    sessions.set(id, session);
    return session;
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers['mcp-session-id'];
    const sid = Array.isArray(header) ? header[0] : header;
    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { jsonrpc: '2.0', error: { code: ErrorCode.ParseError, message: 'Parse error' }, id: null });
        return;
      }
    }
    let session = sid ? sessions.get(sid) : undefined;
    if (!session) {
      const isInit = Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body);
      if (req.method === 'POST' && isInit && !sid) {
        session = await openSession();
      } else if (sid && req.method !== 'DELETE') {
        session = (await adoptSession(sid)) ?? undefined;
      }
      if (!session) {
        sendJson(res, sid ? 404 : 400, {
          jsonrpc: '2.0',
          error: { code: -32000, message: sid ? 'Session not found' : 'Bad Request: no valid session ID provided' },
          id: null,
        });
        return;
      }
    }
    await session.transport.handleRequest(req, res, body);
  }

  const control: ChaosControl = {
    state: () => engine.state(),
    set: (patch) => engine.set(patch),
    inject: (req) => engine.inject(req),
    listTools: () => engine.listTools(),
    async screenshot() {
      const dev = await device();
      if (!dev) return null;
      try {
        return await dev.screenshot();
      } catch {
        return null;
      }
    },
  };

  const router = createRouter();
  router.get('/healthz', () => ({ ok: true, chaos: engine.state(), sessions: sessions.size, upstreams: pool.status() }));
  router.get('/chaos', () => control.state());
  router.post('/chaos', ({ body }) => {
    if (body !== undefined && (typeof body !== 'object' || body === null)) throw new HttpError(400, 'expected a JSON object');
    return control.set((body ?? {}) as Parameters<ChaosControl['set']>[0]);
  });
  router.post('/chaos/inject', ({ body }) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'expected {fault, tool?, tfSessionId?}');
    return control.inject(body as Parameters<ChaosControl['inject']>[0]);
  });
  router.get('/chaos/tools', () => control.listTools());
  router.get('/chaos/screen', async ({ res }) => {
    const png = await control.screenshot();
    if (!png) throw new HttpError(404, 'no phone attached');
    res.writeHead(200, { 'content-type': 'image/png' }).end(png);
    return undefined;
  });

  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const work = path === '/mcp' ? handleMcp(req, res) : router.handle(req, res);
    work.catch((err: unknown) => {
      warn(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });
  const port = opts.port ?? cfg.CHAOS_PROXY_PORT;
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, cfg.MONK_BIND_HOST, () => resolve());
  });
  const actual = (http.address() as AddressInfo).port;

  return {
    control,
    url: `http://localhost:${actual}/mcp`,
    async close() {
      for (const s of sessions.values()) await s.transport.close().catch(() => {});
      sessions.clear();
      await pool.close();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
