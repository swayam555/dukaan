export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export type QueryResult<R = Row> = { rows: R[]; rowsAffected: number };

/** Minimal surface shared by op-sqlite (device) and better-sqlite3 (Node tests, seeder, benches). */
export interface SqlExecutor {
  execute<R = Row>(sql: string, params?: readonly SqlValue[]): Promise<QueryResult<R>>;
  /** Runs one statement many times with different params (prepared once). */
  executeMany(sql: string, paramSets: readonly (readonly SqlValue[])[]): Promise<void>;
}

export interface SqlDriver extends SqlExecutor {
  /** Serialised: at most one transaction runs at a time. Rolls back if fn throws. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function one<R = Row>(db: SqlExecutor, sql: string, params?: readonly SqlValue[]): Promise<R | undefined> {
  const { rows } = await db.execute<R>(sql, params);
  return rows[0];
}

export async function scalar<T extends SqlValue>(db: SqlExecutor, sql: string, params?: readonly SqlValue[]): Promise<T | undefined> {
  const row = await one(db, sql, params);
  return row ? (Object.values(row)[0] as T) : undefined;
}

/** Tiny promise mutex used by drivers to serialise transactions on one connection. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
