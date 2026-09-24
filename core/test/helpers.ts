import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { D1Like } from '../src/repo.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Wraps node:sqlite in the D1 interface so the repository layer is tested against the
 * real schema (constraints, triggers, views) rather than a hand-written fake.
 */
export function makeTestDb(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  // Apply every migration in order, so the test schema is always the real schema and a
  // new migration cannot pass tests while breaking production.
  const dir = join(here, '../../migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(dir, file), 'utf8'));
  }

  const db: D1Like = {
    prepare(sql: string) {
      const bindAndRun = (values: unknown[]) => {
        const stmt = raw.prepare(sql);
        const params = values.map((v) =>
          v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v) as never[];
        return {
          async run() {
            const info = stmt.run(...params);
            return { meta: { changes: Number(info.changes ?? 0) } };
          },
          async all<T>() {
            return { results: stmt.all(...params) as T[] };
          },
          async first<T>() {
            return (stmt.get(...params) ?? null) as T | null;
          },
        };
      };
      return {
        bind: (...values: unknown[]) => bindAndRun(values),
        ...bindAndRun([]),
      };
    },
  };
  return { db, raw };
}
