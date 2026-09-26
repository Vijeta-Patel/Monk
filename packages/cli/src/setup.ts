import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { syncSkillsToTrueForge } from '@monk/learn';
import {
  CHAOS_PROXY_SERVER_NAME, MONK_AGENT_NAME, destructiveToolNames, ensureAgent, ensureLlmProvider, ensureRemoteMcpServer,
  monkAgentSpec, schema, eq } from '@monk/shared';

import { log, remoteChaos, type Ctx } from './context.ts';
import { trueforgeReachable } from './trueforge.ts';

const execFileP = promisify(execFile);

/**
 * Idempotently configures a stock TrueForge for Monk: OpenRouter models, the chaos proxy as an
 * MCP server, optional Daytona sandbox, the skills repo clone, and the `monk` agent.
 */
export async function setup(ctx: Ctx): Promise<void> {
  const { cfg, client, db } = ctx;
  if (!cfg.LLM_BASE_URL) throw new Error('LLM_BASE_URL is missing in .env');
  if (!cfg.MODEL) throw new Error('MODEL is missing in .env; run `pnpm monk models` to pick the cheapest with tool calling');
  if (!(await trueforgeReachable(cfg))) throw new Error(`TrueForge is not reachable at ${cfg.TRUEFORGE_URL}; start it with \`monk trueforge\``);

  await ensureLlmProvider(client, cfg);
  log(`✓ model provider   litellm @ ${cfg.LLM_BASE_URL} (${cfg.MODEL}${cfg.VISION_MODEL && cfg.VISION_MODEL !== cfg.MODEL ? `, ${cfg.VISION_MODEL}` : ''})`);

  const proxyUrl = cfg.CHAOS_PROXY_PUBLIC_URL || cfg.chaosProxyUrl;
  await ensureRemoteMcpServer(client, {
    name: CHAOS_PROXY_SERVER_NAME,
    url: proxyUrl,
    description: 'Monk chaos proxy: GitHub, phone and Monk tools, with fault injection for rehearsal.',
  });
  log(`✓ mcp server       ${CHAOS_PROXY_SERVER_NAME} → ${proxyUrl}`);

  if (cfg.DAYTONA_API_KEY) {
    await client.settings.sandboxProviders.createOrUpdate({
      manifest: {
        type: 'daytona',
        auth: { apiKey: cfg.DAYTONA_API_KEY },
        execTimeoutMs: 600_000,
        // One ~3 GiB sandbox per session and Daytona caps an account at 30 GiB, so a benchmark run
        // would fill it within the hour: stop after 10 idle minutes, delete 20 minutes after that.
        autoStopIntervalInMinutes: 10,
        autoArchiveIntervalInMinutes: 30,
        autoDeleteIntervalInMinutes: 20,
      },
    });
    log('✓ sandbox          daytona');
  } else {
    log('· sandbox          local fallback (set DAYTONA_API_KEY for the Gradle build in the mobile demo)');
  }

  if (cfg.SKILLS_REPO_URL && !existsSync(join(cfg.SKILLS_REPO_PATH, '.git'))) {
    await mkdir(dirname(cfg.SKILLS_REPO_PATH), { recursive: true });
    await execFileP('git', ['clone', '--quiet', cfg.SKILLS_REPO_URL, cfg.SKILLS_REPO_PATH], { timeout: 120_000 });
    log(`✓ skills repo      cloned to ${cfg.SKILLS_REPO_PATH}`);
  } else if (!cfg.SKILLS_REPO_URL) {
    log('· skills repo      SKILLS_REPO_URL not set; learned skills stay local and are not loaded by TrueForge');
  }

  // Approvals need exact names, so expand the destructive globs against the proxy's live tool list.
  let approvalTools: string[] = [];
  try {
    const tools = await remoteChaos(cfg).tools();
    approvalTools = destructiveToolNames(tools.map((t) => t.name), tools.filter((t) => t.destructive).map((t) => t.name));
    log(`✓ approvals        ${approvalTools.length} tools need your ok${approvalTools.length ? `: ${approvalTools.slice(0, 6).join(', ')}${approvalTools.length > 6 ? ', …' : ''}` : ''}`);
  } catch (err) {
    log(`! approvals        chaos proxy not running (${(err as Error).message}); relying on @destructive only. Run \`monk up\` and re-run setup.`);
  }

  const active = await db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
  await ensureAgent(client, {
    name: MONK_AGENT_NAME,
    description: 'Monk: a general agent that acts on your real systems and gets better every time something breaks.',
    manifest: monkAgentSpec({ model: cfg.MODEL, skills: [], approvalTools, reasoningEffort: cfg.REASONING_EFFORT, ...(cfg.TRUEFORGE_SUBAGENT_MODELS && cfg.VISION_MODEL ? { visionModel: cfg.VISION_MODEL } : {}) }),
  });
  if (active.length && cfg.SKILLS_REPO_URL) await syncSkillsToTrueForge(ctx);
  log(`✓ agent            ${MONK_AGENT_NAME} (${active.length} learned skills)`);
}
