import { computeBill } from '@dukaan/core';
import { addLedgerAdjustment, adjustStock, auditTrail, createCustomer, MemorySyncServer, recordPayment, roleViolation, saveBill, SyncEngine, voidBill, type Cart } from '../src';
import { deviceDb, line } from './helpers';

const noTimers = { set: () => 0, clear: () => undefined };

async function sell(h: Awaited<ReturnType<typeof deviceDb>>, lines: Cart['lines'], billDiscount: Cart['billDiscount'] = null) {
  const cart: Cart = { lines, billDiscount, customerId: null, interstate: false, placeOfSupply: '27' };
  const total = computeBill({ lines, interstate: false, billDiscount }).total;
  return saveBill(h.db, h.writer, 'A', { cart, payments: [{ mode: 'cash', amountPaise: total, ref: '' }], cashier: 'o' });
}

it('role rule: cashier may bill, take payments and fix barcodes, but not touch prices, opening balances or stock', () => {
  const c = (type: string, payload: object) => roleViolation({ type, role: 'cashier', payload });
  expect(c('bill.create', { discountPaise: 0 })).toBeNull();
  expect(c('ledger.add', { kind: 'payment' })).toBeNull();
  expect(c('ledger.add', { kind: 'credit_sale' })).toBeNull();
  expect(c('item.upsert', { barcode: '890' })).toBeNull();
  expect(c('item.upsert', { name: 'x', salePaise: 1 })).toBe('changing item salePaise needs the owner role');
  expect(c('ledger.add', { kind: 'opening' })).toBe('ledger opening needs the owner role');
  expect(c('stock.adjust', {})).toBe('stock.adjust needs the owner role');
  expect(roleViolation({ type: 'stock.adjust', role: 'owner', payload: {} })).toBeNull();
});

it('cashier writer refuses a price change and an opening balance before anything is written', async () => {
  const h = await deviceDb('dev-c', 'cashier');
  const cust = await createCustomer(h.db, h.writer, { name: 'Ramesh' });
  await expect(h.writer.write(h.db, [{ type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { salePaise: 100 } }])).rejects.toThrow('changing item salePaise needs the owner role');
  await expect(addLedgerAdjustment(h.db, h.writer, { customerId: cust, amountPaise: 50_000, kind: 'opening' })).rejects.toThrow(/owner/);
  await h.writer.write(h.db, [{ type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { barcode: '8901058000017' } }]);
  expect((await h.db.execute("SELECT count(*) AS n FROM op_log WHERE type = 'item.upsert'")).rows[0]).toEqual({ n: 1 });
});

it('audit trail lists sensitive actions newest first, in words, and skips ordinary sales and payments', async () => {
  const h = await deviceDb();
  const cust = await createCustomer(h.db, h.writer, { name: 'Ramesh' });
  const plain = await sell(h, [line('salt', 1000)]);
  await recordPayment(h.db, h.writer, { customerId: cust, amountPaise: 1000, mode: 'cash' });
  const disc = await sell(h, [line('rice', 2000)], { kind: 'amt', paise: 2000 });
  await voidBill(h.db, h.writer, plain.id, 'wrong item');
  await adjustStock(h.db, h.writer, { itemId: 'rice', deltaMilli: -1500, reason: 'damage', note: 'rats' });
  await h.writer.write(h.db, [{ type: 'item.upsert', entity: 'item', entityId: 'soap', payload: { salePaise: 4200, gstBp: 1800 } }]);
  await addLedgerAdjustment(h.db, h.writer, { customerId: cust, amountPaise: 15_000, kind: 'opening', note: 'old register' });

  const a = await auditTrail(h.db);
  expect(a.map((e) => [e.kind, e.summary])).toEqual([
    ['ledger', 'Opening balance ₹150.00 for Ramesh · old register'],
    ['price', 'Lux Soap 100g: sale → ₹42.00, GST → 18%'],
    ['stock', 'Removed 1.5 kg Basmati Rice (Loose) (damage) · rats'],
    ['void', `Voided bill ${plain.localNo}: wrong item`],
    ['discount', `Bill ${disc.localNo} with ₹20.00 discount (total ₹220.00)`],
  ]);
  expect(a.every((e) => e.status === 'pending' && e.local && e.role === 'owner')).toBe(true);
  expect((await auditTrail(h.db, { kinds: ['void', 'stock'] })).map((e) => e.kind)).toEqual(['stock', 'void']);
  expect(await auditTrail(h.db, { limit: 2 })).toHaveLength(2);
});

it('shows server rejections with their reason, and peer ops this device refused', async () => {
  const h = await deviceDb('dev-a', 'owner');
  await adjustStock(h.db, h.writer, { itemId: 'salt', deltaMilli: 5000, reason: 'count' });
  // The device was demoted on the server before it synced.
  const server = new MemorySyncServer('shop-1');
  const engine = new SyncEngine(h.db, server.transport({ deviceId: 'dev-a', role: 'cashier' }), h.writer.clock, { shopId: 'shop-1', deviceId: 'dev-a' }, { timers: noTimers });
  await engine.sync();
  // A tampered peer's opening balance that arrived on pull and was quarantined.
  const raw = { opId: 'peer-1', shopId: 'shop-1', deviceId: 'dev-x', entity: 'ledger', entityId: 'l9', type: 'ledger.add', hlc: `${String(Date.now() + 5).padStart(15, '0')}:0000:dev-x`, role: 'cashier', payload: { kind: 'opening', amountPaise: 99_900 } };
  await h.db.execute('INSERT INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)', ['peer-1', JSON.stringify(raw), 'ledger opening needs the owner role', Date.now()]);

  const a = await auditTrail(h.db);
  expect(a.map((e) => [e.kind, e.status, e.reason])).toEqual([
    ['refused', 'quarantined', 'ledger opening needs the owner role'],
    ['stock', 'rejected', 'rejected: stock.adjust needs the owner role'],
  ]);
  expect(a[0]!.summary).toBe('Refused ledger.add from a cashier device');
});
