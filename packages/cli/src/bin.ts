#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { exportSession, sessionsToExport } from '@monk/agenteye';
import { learnFromRecentSessions, retireSkills } from '@monk/learn';
import { ABLATION_VARIANTS, SUITES, githubFromConfig, resetRepo, runSuite, suiteOfTask, usesGithub, type AblationVariant, type Suite } from '@monk/evals';
import { MONK_AGENT_NAME, blendedCost, findRootDir, listProxyModels, loadConfig, rankForAgent, redact, runMonkTurn, type TurnInput } from '@monk/shared';
import { benchAblate, benchReport, benchRun, learnVerifier } from './bench.ts';
import { context, log, remoteChaos } from './context.ts';
import { doctor, printChecks } from './doctor.ts';
import { runTrueForge } from './trueforge.ts';
import { setup } from './setup.ts';
import { up } from './up.ts';

const HELP = `monk: an agent that acts on your real systems and gets better every time something breaks

usage
  monk [--continue] [--demo]     open the terminal UI
  monk trueforge                 run stock TrueForge on :8790, allowed to reach the chaos proxy
  monk up [--phone] [--no-channels] [--no-cron]
                                 chaos proxy, Monk API + dashboard, channels, cron
  monk setup                     configure TrueForge for Monk (models, MCP, sandbox, agent)
  monk doctor                    check keys, services and local tools
  monk ask "<message>" [--approve]
                                 one headless turn with Monk; irreversible steps are denied unless --approve
  monk models [--all]            models on the LLM proxy, cheapest with tool calling first
  monk stack [install|status|restart|stop|logs]
                                 the stack as background services (TrueForge, monk up, AgentEye)
  monk agenteye up               start the local, Monk-only AgentEye (docker)
  monk agenteye setup            keys, plus AgentEye's evaluations and audit for Monk (integrations/agenteye)
  monk agenteye export [--bench <id>] [--session <id>]
                                 send sessions to AgentEye (live sessions export on their own under monk up)
  monk learn [--since 24h]       run the learning loop over recent sessions
  monk bench seed                seed or reset the eval repo fixtures
  monk bench task <id,...> [--profile moderate] [--seed 42]
                                 run single benchmark tasks (e.g. gh-01-list-bugs) and print their results
  monk bench run --suite github,mobile --profile moderate --seeds 3 --generations 5 [--stress] [--keep-skills]
                                 suites: github, mobile, github-edge, mobile-edge (edge cases; ghe-*, mobe-* task ids)
  monk bench ablate --suite github --variants all --seeds 3 --generations 3
  monk bench report --format md,json
`;

function parseDuration(s: string): number {
  const m = /^(\d+)\s*([mhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad duration "${s}" (use e.g. 30m, 24h, 7d)`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
}

function suites(v: string | undefined): Suite[] {
  const list = (v ?? 'github').split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of list) if (!Object.hasOwn(SUITES, s)) throw new Error(`unknown suite "${s}" (known: ${Object.keys(SUITES).join(', ')})`);
  return list as Suite[];
}

function openTui(args: string[]): Promise<number> {
  const root = findRootDir();
  const child = spawn('bun', ['run', join(root, 'packages/tui/src/index.tsx'), ...args], { stdio: 'inherit' });
  return new Promise((resolve) => {
    child.on('error', () => {
      log('bun is required for the terminal UI: https://bun.sh');
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, sub] = argv;
  if (!cmd || cmd.startsWith('--')) return openTui(argv);
  if (cmd === 'help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === 'trueforge') return runTrueForge(loadConfig());

  if (cmd === 'up') {
    const { values } = parseArgs({ args: argv.slice(1), options: { phone: { type: 'boolean' }, 'no-channels': { type: 'boolean' }, 'no-cron': { type: 'boolean' } } });
    if (values.phone) process.env.MONK_PHONE = 'true';
    const ctx = context();
    const stop = await up(ctx, { channels: !values['no-channels'], cron: !values['no-cron'] });
    log('monk is up. ctrl+c to stop.');
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    log('stopping…');
    await stop();
    return 0;
  }

  if (cmd === 'setup') {
    await setup(context());
    return 0;
  }

  if (cmd === 'doctor') return printChecks(await doctor(context())) ? 0 : 1;

  if (cmd === 'stack') {
    const root = findRootDir();
    const units = ['monk-trueforge', 'monk-up', 'monk-agenteye'];
    const run = (bin: string, args: string[]) =>
      new Promise<number>((resolve) => spawn(bin, args, { stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 0)));
    switch (sub ?? 'status') {
      case 'install':
        return run('bash', [join(root, 'deploy/systemd/install.sh')]);
      case 'restart':
        return run('systemctl', ['--user', 'restart', ...units]);
      case 'stop':
        return run('systemctl', ['--user', 'stop', 'monk-up', 'monk-trueforge']);
      case 'logs':
        return run('tail', ['-n', '60', '-f', join(root, 'data/monk-up.log'), join(root, 'data/trueforge.log')]);
      default:
        return run('systemctl', ['--user', '--no-pager', 'status', ...units]);
    }
  }

  if (cmd === 'agenteye') {
    const root = findRootDir();
    if (sub === 'up') {
      const child = spawn('bash', [join(root, 'integrations/agenteye/up.sh')], { stdio: 'inherit' });
      return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
    }
    if (sub === 'setup') {
      const child = spawn(process.execPath, [join(root, 'packages/agenteye/scripts/setup-local.ts')], { stdio: 'inherit' });
      return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
    }
    if (sub === 'export') {
      const { values } = parseArgs({ args: argv.slice(2), options: { bench: { type: 'string' }, session: { type: 'string' } } });
      const ctx = context();
      if (!ctx.cfg.AGENTEYE_INGEST_KEY) throw new Error('AGENTEYE_INGEST_KEY is not set');
      const ids = values.session ? [values.session] : await sessionsToExport(ctx.db, values.bench ? { benchId: values.bench } : {});
      let events = 0;
      for (const id of ids) {
        try {
          const r = await exportSession(ctx, id);
          events += r.sent;
          if (r.sent) log(`✓ ${id} → ${r.environment}: ${r.sent} events${r.ended ? '' : ' (still open)'}`);
        } catch (err) {
          log(`✗ ${id}: ${(err as Error).message}`);
        }
      }
      log(`sent ${events} events from ${ids.length} session(s) to ${ctx.cfg.AGENTEYE_URL}`);
      return 0;
    }
  }

  if (cmd === 'ask') {
    const { values, positionals } = parseArgs({ args: argv.slice(1), options: { approve: { type: 'boolean' } }, allowPositionals: true });
    const message = positionals.join(' ').trim();
    if (!message) throw new Error('usage: monk ask "<message>"');
    const ctx = context();
    const { data: session } = await ctx.client.sessions.create({ agent: { name: MONK_AGENT_NAME }, metadata: { monk_client: 'cli' } });
    log(`session ${session.id}`);
    let input: TurnInput = { kind: 'message', content: message };
    for (let turn = 0; turn < 10; turn++) {
      let pending: { threadId: string; callId: string; name: string }[] = [];
      let questions: { threadId: string; callId: string }[] = [];
      for await (const ev of runMonkTurn(ctx, session.id, input)) {
        if (ev.type === 'text' && ev.threadId === 'main') process.stdout.write(ev.delta);
        else if (ev.type === 'tool.call') log(`\n▸ ${ev.name} ${redact(ev.args).slice(0, 120)}`);
        else if (ev.type === 'tool.result') log(`  ${ev.isError ? '✗' : '✓'} ${redact(ev.content).replace(/\s+/g, ' ').slice(0, 140)}`);
        else if (ev.type === 'subagent.started') log(`\n◇ helper ${ev.name}`);
        else if (ev.type === 'approval.required') pending = ev.calls;
        else if (ev.type === 'question') questions = ev.calls;
        else if (ev.type === 'turn.done') log(`\n— turn ${ev.status}${ev.error ? `: ${ev.error}` : ''} · ${ev.inputTokens} in / ${ev.outputTokens} out tokens`);
      }
      if (pending.length) {
        const allow = values.approve ?? false;
        log(`◆ ${pending.map((p) => p.name).join(', ')} needs approval → ${allow ? 'approved (--approve)' : 'denied (pass --approve to allow)'}`);
        input = { kind: 'approvals', decisions: pending.map((p) => ({ threadId: p.threadId, callId: p.callId, allow, ...(allow ? {} : { reason: 'denied in monk ask' }) })) };
        continue;
      }
      if (questions.length) {
        input = { kind: 'answers', answers: questions.map((q) => ({ threadId: q.threadId, callId: q.callId, content: 'Use your best judgement.' })) };
        continue;
      }
      break;
    }
    log(`session ${session.id}`);
    return 0;
  }

  if (cmd === 'models') {
    const cfg = loadConfig();
    const all = await listProxyModels(cfg);
    const ranked = argv.includes('--all') ? all : rankForAgent(all);
    const price = (v: number | null) => (v === null ? '      ?' : `$${v.toFixed(2).padStart(6)}`);
    const flag = (v: boolean | null) => (v === null ? '?' : v ? '✓' : '·');
    process.stdout.write(`${'model'.padEnd(44)} ${'in/M'.padStart(7)} ${'out/M'.padStart(7)}  tools vision schema\n`);
    for (const m of ranked) {
      process.stdout.write(`${m.id.slice(0, 44).padEnd(44)} ${price(m.inputPerM)} ${price(m.outputPerM)}    ${flag(m.toolCalling)}     ${flag(m.vision)}      ${flag(m.jsonSchema)}\n`);
    }
    const pick = rankForAgent(all).find((m) => m.toolCalling === true && blendedCost(m) !== null);
    const vision = rankForAgent(all, { needVision: true }).find((m) => m.toolCalling === true && m.vision === true && blendedCost(m) !== null);
    if (pick) process.stdout.write(`\nsuggested: MODEL=${pick.id}${vision ? `\n           VISION_MODEL=${vision.id}` : ''}\n`);
    else process.stdout.write('\nthe proxy did not report prices or tool support; pick a model you know handles tools well.\n');
    return 0;
  }

  if (cmd === 'learn') {
    const { values } = parseArgs({ args: argv.slice(1), options: { since: { type: 'string', default: '24h' } } });
    const ctx = context();
    const report = await learnFromRecentSessions({ ...ctx, since: new Date(Date.now() - parseDuration(values.since ?? '24h')), verifier: learnVerifier(ctx, remoteChaos(ctx.cfg)) });
    const retired = await retireSkills({ ...ctx, client: ctx.client });
    process.stdout.write(`${JSON.stringify({ ...report, retired }, null, 2)}\n`);
    return 0;
  }

  if (cmd === 'bench') {
    const { values } = parseArgs({
      args: argv.slice(2),
      allowPositionals: true,
      options: {
        suite: { type: 'string' },
        profile: { type: 'string', default: 'moderate' },
        seeds: { type: 'string', default: '3' },
        generations: { type: 'string', default: '5' },
        variants: { type: 'string', default: 'all' },
        format: { type: 'string', default: 'md,json' },
        stress: { type: 'boolean' },
        'keep-skills': { type: 'boolean' },
        'no-control': { type: 'boolean' },
      },
    });
    const ctx = context();
    const chaos = remoteChaos(ctx.cfg);
    if (sub === 'seed') {
      const ids = await resetRepo(githubFromConfig(ctx.cfg));
      process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
      return 0;
    }
    if (sub === 'task') {
      const ids = (argv[2] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      if (!ids.length) throw new Error('usage: monk bench task <task-id>[,<task-id>…]');
      const suite = suiteOfTask(ids[0]!);
      if (!suite) throw new Error(`unknown task "${ids[0]}"`);
      const other = ids.find((id) => suiteOfTask(id) !== suite);
      if (other) throw new Error(`${other} is not in suite ${suite}; run one suite's tasks at a time`);
      const { values: v } = parseArgs({ args: argv.slice(3), options: { profile: { type: 'string', default: 'moderate' }, seed: { type: 'string', default: '42' } } });
      const s = await runSuite({ ...ctx, suite, profile: v.profile ?? 'moderate', seed: Number(v.seed), generation: 0, variant: 'check', taskIds: ids, chaos, ...(usesGithub(suite) ? { gh: githubFromConfig(ctx.cfg) } : {}) });
      for (const r of s.results) log(`${r.passed ? '✓' : '✗'} ${r.taskId}  ${r.detail}  · ${r.steps} steps · faults ${r.faultsInjected}/${r.faultsRecovered} recovered · $${r.costUsd.toFixed(4)}${r.tfSessionId ? ` · ${r.tfSessionId}` : ''}`);
      return s.results.every((r) => r.passed) ? 0 : 1;
    }
    if (sub === 'run') {
      const benchId = await benchRun(ctx, chaos, {
        suites: suites(values.suite),
        profile: values.profile ?? 'moderate',
        seeds: Number(values.seeds),
        generations: Number(values.generations),
        chaosOffControl: !values['no-control'],
        stress: values.stress ?? false,
        keepSkills: values['keep-skills'] ?? false,
      });
      log(`bench ${benchId} done. monk bench report to write REPORT.md`);
      return 0;
    }
    if (sub === 'ablate') {
      const variants = values.variants === 'all' ? [...ABLATION_VARIANTS] : (values.variants ?? '').split(',').map((v) => v.trim()) as AblationVariant[];
      for (const v of variants) if (!ABLATION_VARIANTS.includes(v)) throw new Error(`unknown variant "${v}" (${ABLATION_VARIANTS.join(', ')})`);
      const benchId = await benchAblate(ctx, chaos, {
        suites: suites(values.suite),
        variants,
        seeds: Number(values.seeds),
        generations: Number(values.generations),
        profile: values.profile ?? 'moderate',
      });
      log(`ablation ${benchId} done`);
      return 0;
    }
    if (sub === 'report') {
      const formats = (values.format ?? 'md,json').split(',').map((f) => f.trim()) as ('md' | 'json')[];
      for (const f of await benchReport(ctx, formats)) process.stdout.write(`${f}\n`);
      return 0;
    }
  }

  process.stderr.write(HELP);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
