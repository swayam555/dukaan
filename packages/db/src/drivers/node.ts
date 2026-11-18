import Database from 'better-sqlite3';
import { Mutex, type QueryResult, type Row, type SqlDriver, type SqlExecutor, type SqlValue } from '../driver';

/** better-sqlite3 adapter. Used by tests, the seeder, benchmarks and the headless sync client. */
export function openNodeDb(path = ':memory:'): SqlDriver & { raw: Database.Database } {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = OFF');
  raw.pragma('temp_store = MEMORY');
  raw.pragma('cache_size = -16000');
  const cache = new Map<string, Database.Statement>();
  const prepare = (sql: string) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };
  const exec: SqlExecutor = {
    async execute<R = Row>(sql: string, params: readonly SqlValue[] = []): Promise<QueryResult<R>> {
      const stmt = prepare(sql);
      if (stmt.reader) return { rows: stmt.all(...params) as R[], rowsAffected: 0 };
      const info = stmt.run(...params);
      return { rows: [], rowsAffected: info.changes };
    },
    async executeMany(sql, paramSets) {
      const stmt = prepare(sql);
      for (const p of paramSets) stmt.run(...p);
    },
  };
  const mutex = new Mutex();
  return {
    raw,
    ...exec,
    transaction: (fn) =>
      mutex.run(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(exec);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          if (raw.inTransaction) raw.exec('ROLLBACK');
          throw err;
        }
      }),
    async close() {
      raw.close();
    },
  };
}
