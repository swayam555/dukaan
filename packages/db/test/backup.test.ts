import { computeBill } from '@dukaan/core';
import {
  addLedgerAdjustment, adjustStock, BackupError, createBackup, createCustomer, getDevice, getShop, MemorySyncServer, META,
  readBackupHeader, recordPayment, restoreBackup, saveBill, setMeta, SyncEngine, voidBill, type Cart,
} from '../src';
import { deviceDb, dump, line } from './helpers';

const FAST = { N: 2 ** 10, r: 8, p: 1 }; // tests only; the app uses BACKUP_KDF
const LOCK = { pinHash: 'new', pinLength: 4 };
const noTimers = { set: () => 0, clear: () => undefined };
const SHOP = { id: 'shop-1', name: 'Sharma Kirana', gstin: '', stateCode: '27', address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '' };

async function busyShop() {
  const h = await deviceDb('dev-a', 'owner');
  await setMeta(h.db, META.shop, SHOP);
  await setMeta(h.db, META.device, { id: 'dev-a', shopId: 'shop-1', prefix: 'A', role: 'owner', name: 'Owner' });
  await h.db.execute("INSERT INTO bill_series(prefix, next_seq) VALUES ('A', 1)");
  const sell = async (lines: Cart['lines'], customerId: string | null = null) => {
    const cart: Cart = { lines, billDiscount: null, customerId, interstate: false, placeOfSupply: '27' };
    const total = computeBill({ lines, interstate: false, billDiscount: null }).total;
    return saveBill(h.db, h.writer, 'A', { cart, payments: [{ mode: customerId ? 'credit' : 'cash', amountPaise: total, ref: '' }], cashier: 'o' });
  };
  const ramesh = await createCustomer(h.db, h.writer, { name: 'Ramesh', phone: '9876543210' });
  await sell([line('rice', 2500), line('soap', 2000)], ramesh);
  const v = await sell([line('salt', 1000)]);
  await voidBill(h.db, h.writer, v.id, 'wrong item');
  await recordPayment(h.db, h.writer, { customerId: ramesh, amountPaise: 10_000, mode: 'upi' });
  await addLedgerAdjustment(h.db, h.writer, { customerId: ramesh, amountPaise: 15_000, kind: 'opening', note: 'old diary' });
  await adjustStock(h.db, h.writer, { itemId: 'salt', deltaMilli: 24_000, reason: 'opening' });
  // Half of it synced: some ops carry a server seq, the rest are still pending.
  const server = new MemorySyncServer('shop-1');
  await new SyncEngine(h.db, server.transport({ deviceId: 'dev-a', role: 'owner' }), h.writer.clock, { shopId: 'shop-1', deviceId: 'dev-a' }, { timers: noTimers }).sync();
  await sell([line('salt', 3000)]);
  return h;
}

it('round trip: a restored phone has the same items, stock, bills, khata, numbering and sync position', async () => {
  const src = await busyShop();
  const { bytes, header } = await createBackup(src.db, 'chai-paani-2026', { kdf: FAST, now: 1_763_000_000_000 });
  expect(readBackupHeader(bytes)).toEqual(header);
  expect(header).toMatchObject({ shopName: 'Sharma Kirana', ops: 10, createdAt: 1_763_000_000_000 });
  expect(new TextDecoder().decode(bytes)).not.toContain('Ramesh'); // body is encrypted

  const dst = await deviceDb('dev-new', 'owner');
  const res = await restoreBackup(dst.db, bytes, 'chai-paani-2026', LOCK);
  expect(res).toMatchObject({ ops: 10, shop: { name: 'Sharma Kirana' }, device: { id: 'dev-a', prefix: 'A' } });
  expect(await dump(dst.db)).toEqual(await dump(src.db));
  expect(await getShop(dst.db)).toEqual(SHOP);
  expect(await getDevice(dst.db)).toMatchObject({ id: 'dev-a' });
  const q = async (db: typeof src.db, sql: string) => (await db.execute(sql)).rows;
  for (const sql of ['SELECT * FROM bill_series', 'SELECT key, value FROM sync_state ORDER BY key',
    'SELECT op_id, server_seq, local FROM op_log ORDER BY hlc', 'SELECT * FROM ledger_entry ORDER BY id']) {
    expect(await q(dst.db, sql)).toEqual(await q(src.db, sql));
  }
  expect(await q(dst.db, 'SELECT count(*) AS n FROM op_log WHERE server_seq IS NULL')).toEqual([{ n: 1 }]); // still to push
});

it('refuses a wrong passphrase, a tampered header, a foreign file and a phone that is already set up', async () => {
  const src = await busyShop();
  const { bytes } = await createBackup(src.db, 'chai-paani-2026', { kdf: FAST });
  const dst = await deviceDb('dev-new', 'owner');
  await expect(restoreBackup(dst.db, bytes, 'chai-paani-2025', LOCK)).rejects.toThrow('wrong passphrase, or the file was changed');

  const tampered = bytes.slice();
  const at = new TextDecoder().decode(tampered).indexOf('Sharma');
  tampered[at] = 'X'.charCodeAt(0); // "Xharma Kirana" in the plain header
  expect(readBackupHeader(tampered).shopName).toBe('Xharma Kirana');
  await expect(restoreBackup(dst.db, tampered, 'chai-paani-2026', LOCK)).rejects.toThrow('wrong passphrase, or the file was changed');

  expect(() => readBackupHeader(new TextEncoder().encode('PK\u0003\u0004 zip'))).toThrow('not a Dukaan backup file');
  await expect(restoreBackup(src.db, bytes, 'chai-paani-2026', LOCK)).rejects.toThrow('restore needs a fresh install');
  await expect(createBackup(src.db, 'short')).rejects.toThrow(BackupError);
  expect(await q0(dst.db)).toBe(0); // nothing half-restored
});

const q0 = async (db: Awaited<ReturnType<typeof deviceDb>>['db']) => (await db.execute<{ n: number }>('SELECT count(*) AS n FROM op_log')).rows[0]!.n;
