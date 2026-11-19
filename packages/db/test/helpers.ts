import { HlcClock } from '@dukaan/core';
import { migrate, MIGRATIONS, OpWriter, upsertItems, type ItemInput, type Role, type SqlDriver } from '../src';
import { openNodeDb } from '../src/drivers/node';

export const ITEMS: ItemInput[] = [
  { id: 'salt', name: 'Tata Salt 1kg', salePaise: 2800, mrpPaise: 2800, gstBp: 0, hsn: '2501', costPaise: 2300 },
  { id: 'rice', name: 'Basmati Rice (Loose)', unit: 'kg', salePaise: 12000, gstBp: 500, hsn: '1006', costPaise: 9800 },
  { id: 'soap', name: 'Lux Soap 100g', salePaise: 4500, gstBp: 1800, hsn: '3401', costPaise: 3600 },
];

export async function deviceDb(deviceId = 'dev-a', role: Role = 'owner', wall: () => number = Date.now) {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  await db.transaction((tx) => upsertItems(tx, ITEMS));
  const writer = new OpWriter({ shopId: 'shop-1', deviceId, role }, new HlcClock(deviceId, wall));
  return { db, writer };
}

export const line = (itemId: string, qtyMilli: number) => {
  const item = ITEMS.find((i) => i.id === itemId)!;
  return { itemId, name: item.name, hsn: item.hsn ?? '', unit: item.unit ?? 'pcs', qtyMilli, unitPaise: item.salePaise, mrpPaise: item.mrpPaise ?? item.salePaise, gstBp: item.gstBp ?? 0, costPaise: item.costPaise ?? 0 };
};

/** Everything sync must converge, in a stable order (3-device sim, live e2e). */
export async function dump(db: SqlDriver) {
  const q = async (sql: string) => (await db.execute(sql)).rows;
  return {
    item: await q('SELECT id, name, name_hi, translit, name_key, barcode, hsn, unit, mrp_paise, sale_paise, cost_paise, gst_bp, deleted, updated_hlc FROM item ORDER BY id'),
    stock: await q('SELECT item_id, qty_milli FROM item_stock ORDER BY item_id'),
    cells: await q('SELECT * FROM stock_cell ORDER BY item_id, batch_id, device_id'),
    bill: await q('SELECT id, local_no, device_id, status, status_hlc, global_no, total_paise, customer_id FROM bill ORDER BY id'),
    lines: await q('SELECT bill_id, line_no, item_id, qty_milli, total_paise FROM bill_line ORDER BY bill_id, line_no'),
    ledger: await q('SELECT id, customer_id, amount_paise, kind, bill_id, created_at, hlc FROM ledger_entry ORDER BY id'),
    customer: await q('SELECT * FROM customer ORDER BY id'),
    adjustments: await q('SELECT id, item_id, delta_milli, device_id FROM stock_adjustment ORDER BY id'),
  };
}
