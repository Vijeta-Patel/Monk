import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { remoteChaos, type Ctx } from './context.ts';
import { trueforgeReachable } from './trueforge.ts';

const execFileP = promisify(execFile);

type Check = { name: string; ok: boolean | 'warn'; detail: string };

async function has(cmd: string, args = ['--version']): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout: 10_000 });
    return (stdout || stderr).split('\n')[0]?.trim() ?? '';
  } catch {
    return null;
  }
}

export async function doctor(ctx: Ctx): Promise<Check[]> {
  const { cfg } = ctx;
  const checks: Check[] = [];
  const env = (name: string, value: string, required: boolean, why: string) =>
    checks.push({ name, ok: value ? true : required ? false : 'warn', detail: value ? 'set' : why });

  env('LLM_BASE_URL', cfg.LLM_BASE_URL, true, 'your LiteLLM proxy, e.g. https://models.aikin.club/v1');
  env('LLM_API_KEY', cfg.LLM_API_KEY, true, 'key for the LLM proxy');
  env('MODEL', cfg.MODEL, true, 'run `pnpm monk models` to pick one');
  env('GITHUB_TOKEN', cfg.GITHUB_TOKEN, true, 'needed for GitHub MCP and the eval suite');
  env('EVAL_REPO', cfg.EVAL_REPO, false, 'needed for monk bench (owner/name of a sandbox repo)');
  env('SKILLS_REPO_URL', cfg.SKILLS_REPO_URL, false, 'learned skills are not loaded by TrueForge without a public repo');
  env('TELEGRAM_BOT_TOKEN', cfg.TELEGRAM_BOT_TOKEN, false, 'telegram channel off');
  env('DISCORD_BOT_TOKEN', cfg.DISCORD_BOT_TOKEN, false, 'discord channel off');
  env('DAYTONA_API_KEY', cfg.DAYTONA_API_KEY, false, 'local sandbox only; the Gradle build needs Daytona');
  if ((cfg.TELEGRAM_BOT_TOKEN || cfg.DISCORD_BOT_TOKEN) && cfg.allowedUsers.length === 0) {
    checks.push({ name: 'ALLOWED_USERS', ok: false, detail: 'empty: the bots will ignore everyone' });
  }

  checks.push({ name: 'trueforge', ok: await trueforgeReachable(cfg), detail: cfg.TRUEFORGE_URL });
  try {
    const tools = await remoteChaos(cfg).tools();
    checks.push({ name: 'chaos proxy', ok: tools.length > 0 ? true : 'warn', detail: `${tools.length} tools via ${cfg.chaosProxyUrl}` });
  } catch {
    checks.push({ name: 'chaos proxy', ok: 'warn', detail: 'not running (monk up)' });
  }

  const docker = await has('docker');
  checks.push({ name: 'docker', ok: docker ? true : false, detail: docker ?? 'needed to run the GitHub MCP server' });
  const bun = await has('bun');
  checks.push({ name: 'bun', ok: bun ? true : false, detail: bun ?? 'needed for the terminal UI' });
  for (const [bin, flag] of [['bwrap', '--version'], ['socat', '-V'], ['rg', '--version']] as const) {
    const v = await has(bin, [flag]);
    checks.push({ name: bin, ok: v !== null ? true : 'warn', detail: v !== null ? 'found' : 'TrueForge local sandbox needs it' });
  }
  if (cfg.MONK_PHONE) {
    const adb = await has('adb', ['devices']);
    const devices = adb === null ? null : (await execFileP('adb', ['devices'])).stdout.split('\n').slice(1).filter((l) => l.includes('\tdevice'));
    checks.push({ name: 'adb', ok: devices && devices.length ? true : false, detail: devices ? `${devices.length} device(s)` : 'adb not found' });
  }
  return checks;
}

export function printChecks(checks: Check[]): boolean {
  for (const c of checks) {
    const glyph = c.ok === true ? '✓' : c.ok === 'warn' ? '·' : '✗';
    process.stdout.write(`${glyph} ${c.name.padEnd(20)} ${c.detail}\n`);
  }
  return checks.every((c) => c.ok !== false);
}
