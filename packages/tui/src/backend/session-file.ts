// Remembers the last session so `monk --continue` reopens it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.monk');
const file = join(dir, 'tui.json');

export function lastSessionId(): string | null {
  try {
    if (!existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, 'utf8')) as { lastSessionId?: unknown };
    return typeof v.lastSessionId === 'string' ? v.lastSessionId : null;
  } catch {
    return null;
  }
}

export function rememberSession(id: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ lastSessionId: id, at: new Date().toISOString() }));
  } catch {
    // Losing --continue is not worth interrupting anyone.
  }
}
