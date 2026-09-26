import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  type ChaosApi, type CronJobRow, type CurvePoint, type EvalRunRow, type FaultRow, type HeatCell, type MonkConfig,
  type MonkDb, type MonkState, type SkillDetail, type SkillRow, FaultTypeSchema, HttpError, costUsd, createRouter,
  linkSession, mcpSessionsFor, openSse, publish, readEvents, schema,
} from '@monk/shared';

const execFileP = promisify(execFile);

export type { ChaosApi } from '@monk/shared';

export type ApiServerOptions = {
  db: MonkDb;
  cfg: MonkConfig;
  chaos: ChaosApi;
  bench?: (req: { suite: string; profile: string; seeds: number; generations: number }) => Promise<{ benchId: string }>;
  curve?: () => Promise<CurvePoint[]>;
  cron?: { reload(): Promise<void>; nextRun?(schedule: string, timezone: string): string | null };
  staticDir?: string;
  port?: number;
  host?: string;
};

const WIN_WINDOW = 10;

export async function listSkills(db: MonkDb): Promise<SkillRow[]> {
  const rows = await db.select().from(schema.skills).orderBy(desc(schema.skills.updatedAt));
  const uses = await db.select().from(schema.skillUses).orderBy(desc(schema.skillUses.id));
  const byName = new Map<string, (typeof uses)[number][]>();
  for (const u of uses) byName.set(u.skillName, [...(byName.get(u.skillName) ?? []), u]);
  return rows.map((r) => {
    const all = byName.get(r.name) ?? [];
    const recent = all.filter((u) => u.succeeded !== null).slice(0, WIN_WINDOW);
    const wins = recent.filter((u) => u.succeeded).length;
    return {
      name: r.name,
      type: r.type,
      description: r.description,
      version: r.version,
      verified: r.verified,
      status: r.status,
      uses: all.length,
      wins,
      winRate: recent.length ? wins / recent.length : null,
      faultTypes: r.faultTypes,
      tools: r.tools,
      generation: r.generation,
      updatedAt: r.updatedAt,
    };
  });
}

async function skillHistory(cfg: MonkConfig, name: string): Promise<SkillDetail['history']> {
  if (!existsSync(join(cfg.SKILLS_REPO_PATH, '.git'))) return [];
  try {
    const { stdout } = await execFileP('git', ['-C', cfg.SKILLS_REPO_PATH, 'log', '--format=%H%x09%cI%x09%s', '--', name], { timeout: 5000 });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', date = '', ...msg] = line.split('\t');
        return { sha, date, message: msg.join('\t') };
      });
  } catch {
    return [];
  }
}

export async function listFaults(db: MonkDb, opts: { tfSessionId?: string; limit: number }): Promise<FaultRow[]> {
  const f = schema.faults;
  const m = schema.mcpSessions;
  const base = db
    .select({ fault: f, tfSessionId: m.tfSessionId })
    .from(f)
    .leftJoin(m, eq(m.mcpSessionId, f.mcpSessionId));
  let rows;
  if (opts.tfSessionId) {
    const ids = await mcpSessionsFor(db, opts.tfSessionId);
    if (ids.length === 0) return [];
    rows = await base.where(inArray(f.mcpSessionId, ids)).orderBy(desc(f.injectedAt)).limit(opts.limit);
  } else {
    rows = await base.orderBy(desc(f.injectedAt)).limit(opts.limit);
  }
  return rows.map(({ fault, tfSessionId }) => ({
    id: fault.id,
    tfSessionId: tfSessionId ?? null,
    tool: fault.tool,
    faultType: fault.faultType,
    injectedAt: fault.injectedAt,
    recoveredAt: fault.recoveredAt,
    recoverySteps: fault.recoverySteps,
    outcome: fault.outcome,
    manual: fault.manual,
  }));
}

export async function heatmap(db: MonkDb): Promise<HeatCell[]> {
  const f = schema.faults;
  const rows = await db
    .select({
      faultType: f.faultType,
      tool: f.tool,
      injected: sql<number>`count(*)`,
      recovered: sql<number>`sum(case when ${f.outcome} = 'recovered' then 1 else 0 end)`,
    })
    .from(f)
    .groupBy(f.faultType, f.tool);
  return rows.map((r) => ({ faultType: r.faultType, tool: r.tool, injected: Number(r.injected), recovered: Number(r.recovered ?? 0) }));
}

export async function listRuns(db: MonkDb, limit = 200): Promise<EvalRunRow[]> {
  const rows = await db.select().from(schema.evalRuns).orderBy(desc(schema.evalRuns.startedAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    benchId: r.benchId,
    suite: r.suite,
    profile: r.profile,
    seed: r.seed,
    generation: r.generation,
    variant: r.variant,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summary: r.summary ?? null,
  }));
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function monkState(db: MonkDb, cfg: MonkConfig, chaos: ChaosApi): Promise<MonkState> {
  const today = startOfTodayIso();
  const gen = db.raw
    .prepare(`SELECT MAX(g) AS g FROM (SELECT MAX(generation) AS g FROM eval_runs UNION ALL SELECT MAX(generation) FROM skills WHERE status = 'active')`)
    .get() as { g: number | null } | undefined;
  const active = await db.select({ n: sql<number>`count(*)` }).from(schema.skills).where(eq(schema.skills.status, 'active'));
  const fresh = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.skills)
    .where(and(eq(schema.skills.status, 'active'), gte(schema.skills.createdAt, today)));
  const cost = db.raw
    .prepare(`SELECT COALESCE(SUM(json_extract(data, '$.costUsd')), 0) AS c FROM events WHERE kind = 'session.cost' AND ts >= ?`)
    .get(today) as { c: number } | undefined;
  return {
    chaos: chaos.state(),
    generation: gen?.g ?? 0,
    skills: { active: Number(active[0]?.n ?? 0), newToday: Number(fresh[0]?.n ?? 0) },
    model: cfg.MODEL,
    agent: 'monk',
    costTodayUsd: cost?.c ?? 0,
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `${field} is required`);
  return v;
}

export async function startApiServer(opts: ApiServerOptions): Promise<{ close(): Promise<void>; url: string }> {
  const { db, cfg, chaos } = opts;
  const r = createRouter();

  r.get('/healthz', () => ({ ok: true }));
  r.get('/api/state', () => monkState(db, cfg, chaos));

  r.get('/api/events', async ({ req, res, query }) => {
    const after = Number(query.get('after') ?? 0) || 0;
    const kind = query.get('kind');
    if ((req.headers.accept ?? '').includes('text/event-stream')) {
      const sse = openSse(res);
      let cursor = after;
      let closed = false;
      sse.onClose(() => (closed = true));
      while (!closed) {
        const batch = await readEvents(db, cursor, 500);
        for (const e of batch) {
          cursor = e.id;
          if (!kind || e.kind === kind) sse.send(e.id, e);
        }
        if (batch.length === 0) await new Promise((ok) => setTimeout(ok, 250));
      }
      return undefined;
    }
    const limit = Math.min(Number(query.get('limit') ?? 200) || 200, 2000);
    const events = await readEvents(db, after, limit);
    return kind ? events.filter((e) => e.kind === kind) : events;
  });

  r.get('/api/skills', () => listSkills(db));
  r.get('/api/skills/:name', async ({ params }) => {
    const name = params.name ?? '';
    const row = (await listSkills(db)).find((s) => s.name === name);
    if (!row) throw new HttpError(404, `no skill ${name}`);
    const [full] = await db.select().from(schema.skills).where(eq(schema.skills.name, name));
    const file = join(cfg.SKILLS_REPO_PATH, name, 'SKILL.md');
    const markdown = existsSync(file) ? await readFile(file, 'utf8') : (full?.body ?? '');
    const detail: SkillDetail = {
      ...row,
      body: full?.body ?? '',
      markdown,
      history: await skillHistory(cfg, name),
      verification: full?.verification ?? null,
    };
    return detail;
  });

  r.get('/api/faults', ({ query }) =>
    listFaults(db, { tfSessionId: query.get('session') ?? undefined, limit: Math.min(Number(query.get('limit') ?? 100) || 100, 1000) }),
  );
  r.get('/api/heatmap', () => heatmap(db));
  r.get('/api/runs', () => listRuns(db));
  r.get('/api/curve', async () => (opts.curve ? opts.curve() : []));

  r.get('/api/cron', async () => {
    const rows = await db.select().from(schema.cronJobs).orderBy(schema.cronJobs.createdAt);
    return rows.map(
      (j): CronJobRow => ({
        id: j.id,
        name: j.name,
        schedule: j.schedule,
        timezone: j.timezone,
        prompt: j.prompt,
        kind: j.kind,
        deliverTo: j.deliverTo,
        chaosProfile: j.chaosProfile,
        enabled: j.enabled,
        lastRun: j.lastRun,
        lastStatus: j.lastStatus,
        nextRun: j.enabled ? (opts.cron?.nextRun?.(j.schedule, j.timezone) ?? null) : null,
      }),
    );
  });

  r.post('/api/chaos', async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const patch: { enabled?: boolean; profile?: string; faultRate?: number; seed?: number } = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (typeof b.profile === 'string') patch.profile = b.profile;
    if (typeof b.faultRate === 'number') {
      if (b.faultRate < 0 || b.faultRate > 1) throw new HttpError(400, 'faultRate must be between 0 and 1');
      patch.faultRate = b.faultRate;
    }
    if (typeof b.seed === 'number') patch.seed = b.seed;
    return chaos.set(patch);
  });

  r.post('/api/chaos/inject', async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const fault = FaultTypeSchema.safeParse(b.fault);
    if (!fault.success) throw new HttpError(400, `unknown fault ${String(b.fault)}`);
    return chaos.inject({
      fault: fault.data,
      ...(typeof b.tool === 'string' ? { tool: b.tool } : {}),
      ...(typeof b.tfSessionId === 'string' ? { tfSessionId: b.tfSessionId } : {}),
    });
  });

  r.post('/api/bench/run', async ({ body }) => {
    if (!opts.bench) throw new HttpError(501, 'bench runner not available in this process');
    const b = (body ?? {}) as Record<string, unknown>;
    return opts.bench({
      suite: typeof b.suite === 'string' ? b.suite : 'github',
      profile: typeof b.profile === 'string' ? b.profile : 'moderate',
      seeds: typeof b.seeds === 'number' ? b.seeds : 1,
      generations: typeof b.generations === 'number' ? b.generations : 1,
    });
  });

  r.post('/api/sessions/link', async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    await linkSession(db, { tfSessionId: str(b.tfSessionId, 'tfSessionId'), mcpSessionId: str(b.mcpSessionId, 'mcpSessionId') });
    return { ok: true };
  });

  r.post('/api/sessions/cost', async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const inputTokens = Number(b.inputTokens ?? 0);
    const outputTokens = Number(b.outputTokens ?? 0);
    await publish(db, {
      kind: 'session.cost',
      data: { tfSessionId: str(b.tfSessionId, 'tfSessionId'), inputTokens, outputTokens, costUsd: costUsd(cfg.MODEL, inputTokens, outputTokens) },
    });
    return { ok: true };
  });

  r.get('/api/phone/screen', async ({ res }) => {
    const png = await chaos.screenshot();
    if (!png) throw new HttpError(404, 'no phone attached');
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(png);
    return undefined;
  });

  // Dashboard build with SPA fallback.
  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    const serve = async ({ req, res }: { req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse }) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      let file = normalize(join(staticDir, path));
      if (!file.startsWith(staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
      if (!existsSync(file)) throw new HttpError(404, 'dashboard not built: pnpm --filter @monk/dashboard build');
      const content = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(content);
      return undefined;
    };
    r.get('/', serve);
    r.get('/assets/:file', serve);
    r.get('/:file', serve);
  }

  const port = opts.port ?? cfg.MONK_API_PORT;
  const server = await r.listen(port, opts.host ?? cfg.MONK_BIND_HOST);
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://localhost:${actualPort}`,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
