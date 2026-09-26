import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { loadConfig } from '../config.ts';
import { ADDED_COLUMNS, MIGRATIONS } from './migrate.ts';
import * as schema from './schema.ts';

export { schema };
export type MonkDb = SqliteRemoteDatabase<typeof schema> & { raw: DatabaseSync };

/**
 * node:sqlite behind drizzle's sqlite-proxy: no native modules to build, and the same schema could
 * move to Postgres later. WAL lets the proxy, gateway and dashboard API share one file.
 */
export function openDb(path = loadConfig().MONK_DB_PATH): MonkDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  for (const stmt of MIGRATIONS) raw.exec(stmt);
  for (const add of ADDED_COLUMNS) {
    const cols = raw.prepare(`PRAGMA table_info(${add.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === add.column)) raw.exec(`ALTER TABLE ${add.table} ADD COLUMN ${add.column} ${add.ddl}`);
  }

  const db = drizzle(
    async (query, params, method) => {
      const stmt = raw.prepare(query);
      const args = params as SQLInputValue[];
      if (method === 'run') {
        stmt.run(...args);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === 'get') {
        const row = stmt.get(...args);
        return { rows: (row ?? undefined) as unknown as unknown[] };
      }
      return { rows: stmt.all(...args) as unknown as unknown[][] };
    },
    { schema },
  );
  return Object.assign(db, { raw });
}
