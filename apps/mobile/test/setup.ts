/**
 * Component tests run the real SQL: `getDb()` is backed by better-sqlite3 (same schema, FTS5 and
 * repos as on device), only the op-sqlite/SQLCipher opener is swapped out.
 */
jest.mock('@/lib/db', () => {
  const { migrate, MIGRATIONS, upsertItems } = jest.requireActual('@dukaan/db');
  const { openNodeDb } = jest.requireActual('@dukaan/db/src/drivers/node');
  let db: Promise<unknown> | null = null;
  return {
    getDb: () =>
      (db ??= (async () => {
        const d = openNodeDb();
        await migrate(d, MIGRATIONS);
        await d.transaction((tx: never) => upsertItems(tx, [
          { id: 'salt', name: 'Tata Salt 1kg', salePaise: 2800, mrpPaise: 2800, gstBp: 0, hsn: '2501', costPaise: 2300, barcode: '8901058000017' },
          { id: 'rice', name: 'Basmati Rice (Loose)', unit: 'kg', salePaise: 12000, gstBp: 500, hsn: '1006', costPaise: 9800 },
          { id: 'soap', name: 'Lux Soap 100g', salePaise: 4500, gstBp: 1800, hsn: '3401', costPaise: 3600 },
        ]));
        return d;
      })()),
    __resetDb: () => { db = null; },
  };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
  Stack: { Screen: () => null },
}));
