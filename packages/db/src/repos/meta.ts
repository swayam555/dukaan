import { one, type SqlExecutor } from '../driver';

export async function getMeta<T>(db: SqlExecutor, key: string): Promise<T | null> {
  const row = await one<{ value: string }>(db, 'SELECT value FROM meta WHERE key = ?', [key]);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setMeta(db: SqlExecutor, key: string, value: unknown): Promise<void> {
  await db.execute('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
