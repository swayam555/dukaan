import { open, type DB } from '@op-engineering/op-sqlite';
import { migrate, MIGRATIONS, Mutex, type QueryResult, type Row, type SqlDriver, type SqlExecutor, type SqlValue } from '@dukaan/db';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY_NAME = 'dukaan.db.key.v1';
const DB_NAME = 'dukaan.sqlite';

async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return key;
}

export type DeviceDb = SqlDriver & { native: DB };

type Executable = Pick<DB, 'execute'>;

function executorFor(target: Executable): SqlExecutor {
  return {
    async execute<R = Row>(sql: string, params: readonly SqlValue[] = []): Promise<QueryResult<R>> {
      const res = await target.execute(sql, params as never);
      return { rows: res.rows as R[], rowsAffected: res.rowsAffected };
    },
    async executeMany(sql, paramSets) {
      for (const p of paramSets) await target.execute(sql, p as never);
    },
  };
}

function adapt(native: DB): DeviceDb {
  const base = executorFor(native);
  const mutex = new Mutex();
  return {
    native,
    execute: base.execute,
    async executeMany(sql, paramSets) {
      if (paramSets.length === 0) return;
      await native.executeBatch(paramSets.map((p) => [sql, p as never]));
    },
    transaction: <T,>(fn: (tx: SqlExecutor) => Promise<T>) =>
      mutex.run(async () => {
        let result!: T;
        await native.transaction(async (tx) => {
          result = await fn(executorFor(tx));
        });
        return result;
      }),
    async close() {
      native.close();
    },
  };
}

let instance: Promise<DeviceDb> | null = null;

/** Opens the SQLCipher database (key held in Keystore/Keychain), sets pragmas and migrates once. */
export function getDb(): Promise<DeviceDb> {
  instance ??= (async () => {
    const native = open({ name: DB_NAME, encryptionKey: await databaseKey() });
    native.executeSync('PRAGMA journal_mode = WAL');
    native.executeSync('PRAGMA synchronous = NORMAL');
    native.executeSync('PRAGMA temp_store = MEMORY');
    native.executeSync('PRAGMA cache_size = -16000'); // decrypted-page cache: SQLCipher decrypts every miss
    const db = adapt(native);
    await migrate(db, MIGRATIONS);
    return db;
  })();
  return instance;
}
