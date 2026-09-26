import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type Handler = (ctx: {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}) => Promise<unknown> | unknown;

type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Small router: `GET /api/skills/:name`. Returning undefined means the handler wrote the response. */
export function createRouter() {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const re = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler });
  };
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? '')]));
      try {
        const body = req.method === 'GET' ? undefined : await readJson(req);
        const out = await r.handler({ req, res, params, query: url.searchParams, body });
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (!res.headersSent) sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  }
  return {
    get: (p: string, h: Handler) => add('GET', p, h),
    post: (p: string, h: Handler) => add('POST', p, h),
    put: (p: string, h: Handler) => add('PUT', p, h),
    delete: (p: string, h: Handler) => add('DELETE', p, h),
    handle,
    listen(port: number, host = '127.0.0.1'): Promise<Server> {
      const server = createServer((req, res) => void handle(req, res));
      return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
    },
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new HttpError(400, `invalid JSON body: ${(err as Error).message}`);
  }
}

/** Opens an SSE response; returns a writer. Sends a comment heartbeat so proxies keep it open. */
export function openSse(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': ok\n\n');
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);
  res.on('close', () => clearInterval(hb));
  return {
    send(id: number | string, data: unknown) {
      res.write(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(fn: () => void) {
      res.on('close', fn);
    },
  };
}
