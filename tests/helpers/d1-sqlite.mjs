// A D1-shaped wrapper over Node's built-in SQLite, so the D1 store adapter runs in unit tests on Node with the real
// migration. Implements only what lib/identity/store.mjs uses: prepare().bind().first/all/run, and batch().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function d1FromSqlite(migrationPath = new URL('../../migrations/0001_accounts.sql', import.meta.url)) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(migrationPath, 'utf8'));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}
