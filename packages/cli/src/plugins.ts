// Local plugins: machine-specific add-ons kept out of the repo in `.local/<name>/monk-plugin.ts`
// (gitignored). Each can add CLI commands, run alongside `monk up`, and name systemd units for
// `monk stack`. Nothing in the repo depends on any particular plugin.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Ctx } from './context.ts';

export type MonkPlugin = {
  name: string;
  /** Extra lines for `monk --help`. */
  usage?: string;
  /** `monk <command> …`; argv starts after the command name. */
  commands?: Record<string, (argv: string[], ctx: () => Ctx) => Promise<number>>;
  /** Runs inside `monk up`; returns a closer. */
  up?: (ctx: Ctx & { log: (s: string) => void }) => Promise<(() => Promise<void>) | void> | (() => Promise<void>) | void;
  /** systemd user units `monk stack` should manage too. */
  units?: string[];
};

let cached: MonkPlugin[] | null = null;

export async function loadPlugins(root: string): Promise<MonkPlugin[]> {
  if (cached) return cached;
  const dir = join(root, '.local');
  const out: MonkPlugin[] = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name, 'monk-plugin.ts');
      if (!existsSync(file)) continue;
      try {
        const mod = (await import(pathToFileURL(file).href)) as { default: MonkPlugin };
        out.push(mod.default);
      } catch (err) {
        process.stderr.write(`plugin ${name}: failed to load: ${(err as Error).message}\n`);
      }
    }
  }
  cached = out;
  return out;
}
