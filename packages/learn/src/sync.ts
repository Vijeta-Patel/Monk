import { eq } from 'drizzle-orm';
import { ensureGitSkill, MONK_AGENT_NAME, schema, type MonkConfig, type MonkDb, type TrueForge } from '@monk/shared';
import { winStats } from './usage.ts';

export const MAX_AGENT_SKILLS = 50;

/** Active skills ranked by win rate (verification pass rate until a skill has uses). */
export async function rankedActiveSkills(db: MonkDb): Promise<(typeof schema.skills.$inferSelect & { score: number })[]> {
  const rows = await db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
  const scored = await Promise.all(
    rows.map(async (r) => {
      const st = await winStats(db, r.name, 10);
      const verified = typeof r.verification?.withSkillPass === 'number' ? (r.verification.withSkillPass as number) : 0.5;
      return { ...r, score: st.winRate ?? verified };
    }),
  );
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Registers every active skill as a git skill and sets the monk agent's skills[] to the active set.
 * Skills Monk doesn't manage (added by hand) stay on the agent; everything else in the manifest is kept.
 */
export async function syncSkillsToTrueForge(opts: {
  db: MonkDb;
  client: TrueForge;
  cfg: MonkConfig;
  agentName?: string;
}): Promise<string[]> {
  const { db, client, cfg } = opts;
  if (!cfg.SKILLS_REPO_URL) return [];
  const agentName = opts.agentName ?? MONK_AGENT_NAME;
  const ranked = await rankedActiveSkills(db);
  const managed = new Set((await db.select({ n: schema.skills.name }).from(schema.skills)).map((r) => r.n));

  let agent: Awaited<ReturnType<TrueForge['agents']['list']>>['data'][number] | undefined;
  for await (const a of await client.agents.list({ agentName })) {
    if (a.name === agentName) {
      agent = a;
      break;
    }
  }
  const current = agent?.manifest.skills ?? [];
  const foreign = current.filter((s) => !managed.has(s.name));
  const chosen = ranked.slice(0, Math.max(0, MAX_AGENT_SKILLS - foreign.length));

  for (const s of chosen) {
    await ensureGitSkill(client, { name: s.name, description: s.description, url: cfg.SKILLS_REPO_URL, ref: cfg.SKILLS_REPO_REF, path: s.name });
  }
  const names = chosen.map((s) => s.name);
  if (agent) {
    const prev = new Map(current.map((s) => [s.name, s]));
    const skills = [...foreign, ...names.map((name) => prev.get(name) ?? { name })];
    await client.agents.update(agent.id, { description: agent.description, manifest: { ...agent.manifest, skills } });
  }
  return names;
}
