import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { publish, schema, type MonkConfig, type MonkDb, type TrueForge, type TrueForgeApi } from '@monk/shared';
import { SkillsRepo } from './git.ts';
import { syncSkillsToTrueForge } from './sync.ts';

const NAME = '[a-z][a-z0-9-]{0,62}[a-z0-9]';
const MOUNT_RE = new RegExp(`/opt/tfy/skills/(${NAME})`, 'g');
const FILE_RE = new RegExp(`(?:^|[^a-z0-9-])(${NAME})/SKILL\\.md`, 'g');

/**
 * Skills the agent actually opened: tool-call arguments that reference a skill mount or SKILL.md.
 * Accepts session events, `{event, turnId}` items or streamed turn events.
 */
export function detectSkillsUsed(events: readonly unknown[], known?: readonly string[]): string[] {
  const found = new Set<string>();
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = ('event' in raw && 'turnId' in raw ? raw.event : raw) as Partial<TrueForgeApi.ModelMessageEvent>;
    if (ev.type !== 'model.message') continue;
    for (const tc of ev.toolCalls ?? []) {
      const args = tc.function?.arguments ?? '';
      for (const re of [MOUNT_RE, FILE_RE]) {
        re.lastIndex = 0;
        for (const m of args.matchAll(re)) if (m[1]) found.add(m[1]);
      }
    }
  }
  found.delete('skills');
  const out = [...found];
  return known ? out.filter((n) => known.includes(n)) : out;
}

export async function recordSkillUses(opts: { db: MonkDb; tfSessionId: string; skills: string[]; succeeded: boolean }): Promise<void> {
  const names = [...new Set(opts.skills)];
  if (!names.length) return;
  const existing = await opts.db
    .select({ n: schema.skillUses.skillName })
    .from(schema.skillUses)
    .where(and(eq(schema.skillUses.tfSessionId, opts.tfSessionId), inArray(schema.skillUses.skillName, names)));
  const seen = new Set(existing.map((r) => r.n));
  for (const name of names) {
    if (seen.has(name)) continue;
    await opts.db.insert(schema.skillUses).values({ skillName: name, tfSessionId: opts.tfSessionId, succeeded: opts.succeeded });
    await publish(opts.db, { kind: 'skill.used', data: { name, tfSessionId: opts.tfSessionId } });
  }
}

export async function winStats(db: MonkDb, name: string, window?: number): Promise<{ uses: number; wins: number; winRate: number | null }> {
  const q = db
    .select({ succeeded: schema.skillUses.succeeded })
    .from(schema.skillUses)
    .where(and(eq(schema.skillUses.skillName, name), isNotNull(schema.skillUses.succeeded)))
    .orderBy(desc(schema.skillUses.id));
  const rows = window ? await q.limit(window) : await q;
  const wins = rows.filter((r) => r.succeeded).length;
  return { uses: rows.length, wins, winRate: rows.length ? wins / rows.length : null };
}

/** Retires active skills whose win rate over their last `window` uses is below `threshold`. */
export async function retireSkills(opts: {
  db: MonkDb;
  cfg: MonkConfig;
  window?: number;
  threshold?: number;
  client?: TrueForge;
  push?: boolean;
}): Promise<string[]> {
  const window = opts.window ?? 10;
  const threshold = opts.threshold ?? 0.5;
  const active = await opts.db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
  const repo = new SkillsRepo(opts.cfg.SKILLS_REPO_PATH, opts.cfg.SKILLS_REPO_REF);
  const retired: string[] = [];
  for (const s of active) {
    const st = await winStats(opts.db, s.name, window);
    if (st.uses < window || st.winRate === null || st.winRate >= threshold) continue;
    const pct = Math.round(st.winRate * 100);
    const sha = await repo.removeSkill(s.name, `learn: retire ${s.name} (win rate ${pct}% over last ${st.uses} uses)`);
    await opts.db
      .update(schema.skills)
      .set({ status: 'retired', commitSha: sha, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` })
      .where(eq(schema.skills.name, s.name));
    await publish(opts.db, { kind: 'skill.retired', data: { name: s.name, winRate: st.winRate } });
    retired.push(s.name);
  }
  if (retired.length && opts.push !== false) await repo.push().catch(() => false);
  if (retired.length && opts.client) await syncSkillsToTrueForge({ db: opts.db, client: opts.client, cfg: opts.cfg });
  return retired;
}
