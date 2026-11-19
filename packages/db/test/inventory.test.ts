import { HlcClock } from '@dukaan/core';
import {
  adjustStock, createSupplier, expiringBatches, listPurchases, listSuppliers, lowStock, OpWriter, purchaseTotals, recordPurchase, scalar, stockOf,
} from '../src';
import { deviceDb } from './helpers';

describe('purchases', () => {
  it('adds stock per batch, records totals, updates cost, and lists the purchase', async () => {
    const { db, writer } = await deviceDb();
    const sup = await createSupplier(db, writer, { name: 'Gupta Traders', phone: '+91 98111 22233', gstin: '27aaacg1234a1z5' });
    expect(await listSuppliers(db)).toEqual([{ id: sup, name: 'Gupta Traders', phone: '9811122233', gstin: '27AAACG1234A1Z5' }]);

    const p = await recordPurchase(db, writer, {
      supplierId: sup, invoiceNo: ' GT/881 ',
      lines: [
        { itemId: 'soap', qtyMilli: 24_000, costPaise: 3500, gstBp: 1800, batch: { batchNo: 'L1', expiry: '2027-03-31', mrpPaise: 4500 } },
        { itemId: 'rice', qtyMilli: 25_000, costPaise: 9800, gstBp: 500 },
      ],
    });
    // soap 24×35 = 840 + 18% = 151.20; rice 25×98 = 2450 + 5% = 122.50
    expect(purchaseTotals([{ itemId: 'x', qtyMilli: 24_000, costPaise: 3500, gstBp: 1800 }])).toEqual({ taxablePaise: 84_000, taxPaise: 15_120, totalPaise: 99_120 });
    expect(p).toMatchObject({ invoiceNo: 'GT/881', totalPaise: 84_000 + 15_120 + 245_000 + 12_250, taxPaise: 27_370 });
    expect(await stockOf(db, 'soap')).toBe(24_000);
    expect(await stockOf(db, 'rice')).toBe(25_000);
    expect(await scalar(db, 'SELECT cost_paise FROM item WHERE id = ?', ['soap'])).toBe(3500); // was 3600
    expect(await scalar(db, "SELECT count(*) FROM op_log WHERE type = 'item.upsert'")).toBe(1); // rice cost unchanged → no op
    expect(await scalar(db, 'SELECT count(*) FROM item_batch WHERE item_id = ?', ['soap'])).toBe(1);
    expect(await listPurchases(db)).toMatchObject([{ supplier: 'Gupta Traders', invoice_no: 'GT/881', lines: 2 }]);
  });

  it('rejects bad input and cashiers', async () => {
    const { db, writer } = await deviceDb();
    await expect(recordPurchase(db, writer, { supplierId: null, invoiceNo: '', lines: [] })).rejects.toThrow(/at least one/);
    await expect(recordPurchase(db, writer, { supplierId: null, invoiceNo: '', lines: [{ itemId: 'salt', qtyMilli: 0, costPaise: 1, gstBp: 0 }] })).rejects.toThrow(/more than zero/);
    await expect(recordPurchase(db, writer, { supplierId: null, invoiceNo: '', lines: [{ itemId: 'nope', qtyMilli: 1000, costPaise: 1, gstBp: 0 }] })).rejects.toThrow(/unknown item/);
    await expect(recordPurchase(db, writer, { supplierId: null, invoiceNo: '', lines: [{ itemId: 'salt', qtyMilli: 1000, costPaise: 1, gstBp: 0, batch: { batchNo: 'x', expiry: '31/03/2027', mrpPaise: 0 } }] })).rejects.toThrow(/YYYY-MM-DD/);
    const cashier = new OpWriter({ shopId: 'shop-1', deviceId: 'dev-c', role: 'cashier' }, new HlcClock('dev-c'));
    await expect(recordPurchase(db, cashier, { supplierId: null, invoiceNo: '', lines: [{ itemId: 'salt', qtyMilli: 1000, costPaise: 2300, gstBp: 0 }] })).rejects.toThrow(/owner role/);
    expect(await stockOf(db, 'salt')).toBe(0);
  });
});

describe('stock health', () => {
  it('adjustments move stock and feed the low-stock list', async () => {
    const { db, writer } = await deviceDb();
    await writer.write(db, [
      { type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { lowStockMilli: 10_000 } },
      { type: 'item.upsert', entity: 'item', entityId: 'rice', payload: { lowStockMilli: 5_000 } },
    ]);
    await adjustStock(db, writer, { itemId: 'salt', deltaMilli: 12_000, reason: 'opening' });
    await adjustStock(db, writer, { itemId: 'rice', deltaMilli: 4_000, reason: 'count', note: 'recount' });
    expect((await lowStock(db)).map((r) => r.id)).toEqual(['rice']);
    await adjustStock(db, writer, { itemId: 'salt', deltaMilli: -3_000, reason: 'damage' });
    expect(await stockOf(db, 'salt')).toBe(9_000);
    expect((await lowStock(db)).map((r) => [r.id, r.qty_milli])).toEqual([['rice', 4_000], ['salt', 9_000]]); // 80% then 90% of level
    expect(await scalar(db, "SELECT reason FROM stock_adjustment WHERE delta_milli = -3000")).toBe('damage');
    await expect(adjustStock(db, writer, { itemId: 'salt', deltaMilli: 0, reason: 'count' })).rejects.toThrow(/quantity/);
  });

  it('lists batches expiring soon that still have stock', async () => {
    const { db, writer } = await deviceDb();
    const mk = (batchNo: string, expiry: string, qty: number) => ({ itemId: 'soap', qtyMilli: qty, costPaise: 3600, gstBp: 1800, batch: { batchNo, expiry, mrpPaise: 4500 } });
    await recordPurchase(db, writer, { supplierId: null, invoiceNo: '1', lines: [mk('OLD', '2026-11-10', 2000), mk('SOON', '2026-12-01', 5000), mk('LATER', '2027-06-01', 9000), mk('GONE', '2026-11-25', 1000)] });
    const gone = (await expiringBatches(db, '2026-11-19')).find((b) => b.batch_no === 'GONE')!;
    await adjustStock(db, writer, { itemId: 'soap', batchId: gone.batch_id, deltaMilli: -1000, reason: 'expiry' });
    const rows = await expiringBatches(db, '2026-11-19', 30);
    expect(rows.map((r) => [r.batch_no, r.days_left, r.qty_milli])).toEqual([['OLD', -9, 2000], ['SOON', 12, 5000]]);
  });
});
