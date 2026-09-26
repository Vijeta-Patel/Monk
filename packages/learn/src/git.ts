import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class SkillsRepo {
  readonly dir: string;
  readonly ref: string;
  private identity: string[] | null = null;

  constructor(dir: string, ref = 'main') {
    this.dir = dir;
    this.ref = ref;
  }

  async git(args: string[]): Promise<string> {
    const id = this.identity ?? [];
    const { stdout } = await run('git', [...id, ...args], { cwd: this.dir, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  }

  /** `git init` when the directory is not its own repo yet; falls back to a Monk identity if none is set. */
  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (!existsSync(join(this.dir, '.git'))) await run('git', ['init', '-q', '-b', this.ref], { cwd: this.dir });
    if (this.identity === null) {
      const email = await this.git(['config', 'user.email']).catch(() => '');
      this.identity = email ? [] : ['-c', 'user.name=Monk', '-c', 'user.email=monk@localhost'];
    }
  }

  async head(): Promise<string | null> {
    return this.git(['rev-parse', 'HEAD']).catch(() => null);
  }

  /** Writes and commits one skill. Returns the resulting HEAD sha (unchanged if content is identical). */
  async commitSkill(name: string, content: string, message: string): Promise<string | null> {
    await this.ensure();
    const rel = `${name}/SKILL.md`;
    await mkdir(join(this.dir, name), { recursive: true });
    await writeFile(join(this.dir, rel), content, 'utf8');
    await this.git(['add', '--', rel]);
    const changed = await this.git(['status', '--porcelain', '--', rel]);
    if (changed) await this.git(['commit', '-q', '-m', message, '--', rel]);
    return this.head();
  }

  async removeSkill(name: string, message: string): Promise<string | null> {
    await this.ensure();
    const dir = join(this.dir, name);
    if (!existsSync(dir)) return this.head();
    const tracked = await this.git(['ls-files', '--', name]);
    if (tracked) {
      await this.git(['rm', '-r', '-q', '--', name]);
      await this.git(['commit', '-q', '-m', message]);
    }
    await rm(dir, { recursive: true, force: true });
    return this.head();
  }

  async hasRemote(): Promise<string | null> {
    if (!existsSync(join(this.dir, '.git'))) return null;
    const remotes = (await this.git(['remote']).catch(() => '')).split('\n').filter(Boolean);
    return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);
  }

  /** Pushes only when a remote exists. Never forces. */
  async push(): Promise<boolean> {
    const remote = await this.hasRemote();
    if (!remote) return false;
    await this.git(['push', '-q', remote, `HEAD:refs/heads/${this.ref}`]);
    return true;
  }
}
