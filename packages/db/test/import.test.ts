import { HlcClock } from '@dukaan/core';
import { importItemsCsv, migrate, MIGRATIONS, OpWriter, scalar, searchItems, type ByteSource } from '../src';
import { openNodeDb } from '../src/drivers/node';

function memorySource(text: string): ByteSource & { reads: number } {
  const bytes = new TextEncoder().encode(text);
  const src = { size: bytes.length, reads: 0, async read(offset: number, length: number) { src.reads++; return bytes.slice(offset, offset + length); } };
  return src;
}

function csv(n: number) {
  const lines = ['﻿Item Name,Hindi Name,Barcode,HSN,MRP,Selling Price,Purchase Price,GST %,Unit,Opening Stock'];
  for (let i = 0; i < n; i++) lines.push(`Product ${i},सामान ${i},890${String(i).padStart(10, '0')},1006,${(i % 90) + 10}.00,${(i % 90) + 9}.50,${(i % 90) + 7},5,pcs,${i % 7}`);
  return lines.join('\r\n') + '\r\n';
}

const writer = () => new OpWriter({ shopId: 'shop-1', deviceId: 'd1', role: 'owner' }, new HlcClock('d1'));

async function fresh() {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  return db;
}

describe('CSV item import', () => {
  it('imports, maps headers, converts money/GST/stock and indexes for search', async () => {
    const db = await fresh();
    const res = await importItemsCsv(db, { jobId: 'j1', source: memorySource(csv(2500)), sourceName: 'items.csv', writer: writer(), chunkBytes: 4096, batchRows: 400 });
    expect(res.status).toBe('done');
    expect(res.progress.rowsDone).toBe(2500);
    expect(await scalar(db, 'SELECT count(*) FROM item')).toBe(2500);
    const row = (await db.execute<{ sale_paise: number; mrp_paise: number; gst_bp: number; qty_milli: number }>(
      "SELECT sale_paise, mrp_paise, gst_bp, qty_milli FROM item JOIN item_stock ON item_stock.item_id = item.id WHERE name = 'Product 3'")).rows[0];
    expect(row).toEqual({ sale_paise: 1250, mrp_paise: 1300, gst_bp: 500, qty_milli: 3000 });
    expect((await searchItems(db, 'Product 1234'))[0]?.name).toBe('Product 1234');
  });

  it('resumes after being stopped without duplicating or skipping rows', async () => {
    const db = await fresh();
    const text = csv(3000);
    let batches = 0;
    const first = await importItemsCsv(db, {
      jobId: 'j2', source: memorySource(text), sourceName: 'items.csv', writer: writer(), chunkBytes: 3000, batchRows: 250,
      onProgress: () => { batches++; }, shouldStop: () => batches >= 3,
    });
    expect(first.status).toBe('stopped');
    const partial = await scalar<number>(db, 'SELECT count(*) FROM item');
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(3000);
    const second = await importItemsCsv(db, { jobId: 'j2', source: memorySource(text), sourceName: 'items.csv', writer: writer(), chunkBytes: 3000, batchRows: 250 });
    expect(second.status).toBe('done');
    expect(await scalar(db, 'SELECT count(*) FROM item')).toBe(3000);
    expect(await scalar(db, 'SELECT count(DISTINCT barcode) FROM item')).toBe(3000);
    expect(await scalar(db, 'SELECT sum(qty_milli) FROM item_stock')).toBe(Array.from({ length: 3000 }, (_, i) => (i % 7) * 1000).reduce((a, b) => a + b, 0));
  });

  it('reports bad rows and keeps going; re-import with same barcode updates in place', async () => {
    const db = await fresh();
    const text = 'name,price,gst,barcode\nGood,10,18,111\n,5,5,222\nBad price,abc,5,333\nWeird unit,5,5,444\nOK2,7.5,0,555\n';
    const res = await importItemsCsv(db, { jobId: 'j3', source: memorySource(text), sourceName: 'x.csv', writer: writer() });
    expect(res.progress).toMatchObject({ rowsDone: 3, rowsFailed: 2 });
    expect(res.errors.map((e) => e.error)).toEqual(['missing name', expect.stringMatching(/rupee/)]);
    await importItemsCsv(db, { jobId: 'j4', source: memorySource('name,price,barcode\nGood v2,12,111\n'), sourceName: 'y.csv', writer: writer() });
    expect(await scalar(db, "SELECT name FROM item WHERE barcode = '111'")).toBe('Good v2');
    expect(await scalar(db, 'SELECT count(*) FROM item')).toBe(3);
  });

  it('rejects files without the minimum columns', async () => {
    const db = await fresh();
    await expect(importItemsCsv(db, { jobId: 'j5', source: memorySource('foo,bar\n1,2\n'), sourceName: 'z.csv', writer: writer() })).rejects.toThrow(/name column/);
  });
});

describe('CSV import syncs', () => {
  it('logs one item.bulk op per committed batch, which rebuilds the same catalogue and stock on another device', async () => {
    const a = await fresh();
    await importItemsCsv(a, { jobId: 'j1', source: memorySource(csv(1000)), sourceName: 'items.csv', writer: writer(), batchRows: 300 });
    const ops = (await a.execute<{ type: string; payload: string }>('SELECT type, payload FROM op_log ORDER BY hlc')).rows;
    expect(ops.map((o) => o.type)).toEqual(['item.bulk', 'item.bulk', 'item.bulk', 'item.bulk']);
    expect(await scalar(a, 'SELECT count(*) FROM field_clock')).toBe(0); // one row clock per item, not 13 field clocks

    const b = await fresh();
    const { applyOp } = await import('../src/sync/apply');
    const full = (await a.execute<Record<string, unknown>>('SELECT * FROM op_log ORDER BY hlc')).rows.map((r) => ({
      opId: r.op_id, shopId: 'shop-1', deviceId: r.device_id, entity: r.entity, entityId: r.entity_id, type: r.type, payload: JSON.parse(r.payload as string), hlc: r.hlc, role: r.role,
    }));
    await b.transaction(async (tx) => { for (const op of full.reverse()) await applyOp(tx, op as never); });
    const dump = (db: typeof a) => db.execute('SELECT i.id, name, translit, sale_paise, base_hlc, qty_milli FROM item i LEFT JOIN item_stock s ON s.item_id = i.id ORDER BY i.id');
    expect((await dump(b)).rows).toEqual((await dump(a)).rows);
  });
});
