import { buildSearchKeys, decodeHlc, nameSortKey } from '@dukaan/core';
import type { SqlExecutor, SqlValue } from '../driver';
import { bumpItemRank, INSERT_ITEM_BASE, itemInputFields, itemParams } from '../repos/items';
import { applyStockDeltas } from '../repos/stock';
import type { Table } from '../changes';
import type { BillPayload, Op } from './ops';

/**
 * Per-field Last-Writer-Wins: newer HLC wins; on an identical (ms, counter) the owner's write wins, then
 * the larger node id. Returns true when the incoming write should replace the stored one.
 */
export function lwwWins(incoming: { hlc: string; owner: boolean }, stored: { hlc: string; owner: boolean } | undefined): boolean {
  if (!stored) return true;
  const a = decodeHlc(incoming.hlc);
  const b = decodeHlc(stored.hlc);
  if (a.ms !== b.ms) return a.ms > b.ms;
  if (a.counter !== b.counter) return a.counter > b.counter;
  if (incoming.owner !== stored.owner) return incoming.owner;
  return a.node > b.node;
}

const ITEM_COLUMNS: Record<string, string> = {
  name: 'name', nameHi: 'name_hi', barcode: 'barcode', hsn: 'hsn', category: 'category', unit: 'unit', mrpPaise: 'mrp_paise',
  salePaise: 'sale_paise', costPaise: 'cost_paise', gstBp: 'gst_bp', cessBp: 'cess_bp', priceInclTax: 'price_incl_tax',
  trackBatches: 'track_batches', lowStockMilli: 'low_stock_milli', deleted: 'deleted',
};
const CUSTOMER_COLUMNS: Record<string, string> = { name: 'name', phone: 'phone', gstin: 'gstin', stateCode: 'state_code', address: 'address', creditLimitPaise: 'credit_limit_paise', deleted: 'deleted' };
const SUPPLIER_COLUMNS: Record<string, string> = { name: 'name', phone: 'phone', gstin: 'gstin', stateCode: 'state_code', deleted: 'deleted' };

function toSql(v: unknown): SqlValue {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v as SqlValue;
}

/** Applies the fields of an upsert op that win their per-field LWW comparison. Returns the winning fields. */
async function applyLww(tx: SqlExecutor, entity: string, table: string, columns: Record<string, string>, op: Op, payload: Record<string, unknown>, entityId = op.entityId): Promise<string[]> {
  const fields = Object.keys(payload).filter((f) => f in columns);
  if (fields.length === 0) return [];
  // Items imported in bulk carry one row clock; a field without its own clock is as old as that.
  let base: { hlc: string; owner: boolean } | undefined;
  if (table === 'item') {
    const { rows: b } = await tx.execute<{ base_hlc: string; base_owner: number }>('SELECT base_hlc, base_owner FROM item WHERE id = ?', [entityId]);
    if (b[0]?.base_hlc) base = { hlc: b[0].base_hlc, owner: b[0].base_owner === 1 };
  }
  const { rows } = await tx.execute<{ field: string; hlc: string; owner: number }>(
    `SELECT field, hlc, owner FROM field_clock WHERE entity = ? AND entity_id = ? AND field IN (${fields.map(() => '?').join(',')})`,
    [entity, entityId, ...fields],
  );
  const clocks = new Map(rows.map((r) => [r.field, { hlc: r.hlc, owner: r.owner === 1 }]));
  const owner = op.role === 'owner';
  const winners = fields.filter((f) => lwwWins({ hlc: op.hlc, owner }, clocks.get(f) ?? base));
  // updated_hlc = newest op ever applied to the row, winning or not: a max over the op set, so arrival order
  // can't change it (the owner tie-break means "won when it arrived" would depend on order).
  if (winners.length === 0) {
    await tx.execute(`UPDATE ${table} SET updated_hlc = max(updated_hlc, ?) WHERE id = ?`, [op.hlc, entityId]);
    return [];
  }
  await tx.execute(`UPDATE ${table} SET ${winners.map((f) => `${columns[f]} = ?`).join(', ')}, updated_hlc = max(updated_hlc, ?) WHERE id = ?`, [
    ...winners.map((f) => toSql(payload[f])), op.hlc, entityId,
  ]);
  await tx.executeMany(
    'INSERT INTO field_clock(entity, entity_id, field, hlc, owner) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity, entity_id, field) DO UPDATE SET hlc = excluded.hlc, owner = excluded.owner',
    winners.map((f) => [entity, entityId, f, op.hlc, owner ? 1 : 0]),
  );
  return winners;
}

async function refreshItemKeys(tx: SqlExecutor, id: string): Promise<void> {
  const { rows } = await tx.execute<{ name: string; name_hi: string }>('SELECT name, name_hi FROM item WHERE id = ?', [id]);
  const r = rows[0]!;
  await tx.execute('UPDATE item SET translit = ?, name_key = ? WHERE id = ?', [buildSearchKeys(r.name, r.name_hi), nameSortKey(r.name), id]);
}

async function applyItemBulk(tx: SqlExecutor, op: Op & { type: 'item.bulk' }): Promise<void> {
  const { items, stock } = op.payload;
  const existing = new Set<string>();
  for (let i = 0; i < items.length; i += 500) {
    const ids = items.slice(i, i + 500).map((it) => it.id);
    const { rows } = await tx.execute<{ id: string }>(`SELECT id FROM item WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const r of rows) existing.add(r.id);
  }
  const fresh = items.filter((it) => !existing.has(it.id));
  const owner = op.role === 'owner' ? 1 : 0;
  await tx.executeMany(INSERT_ITEM_BASE, fresh.map((it) => [...itemParams(it, op.hlc), op.hlc, owner]));
  for (const it of items) {
    if (!existing.has(it.id)) continue;
    const winners = await applyLww(tx, 'item', 'item', ITEM_COLUMNS, op, itemInputFields(it), it.id);
    if (winners.includes('name') || winners.includes('nameHi')) await refreshItemKeys(tx, it.id);
  }
  await applyStockDeltas(tx, stock.filter((s) => s.deltaMilli !== 0).map((s) => ({ itemId: s.itemId, deviceId: op.deviceId, deltaMilli: s.deltaMilli })));
}

async function applyBillEffects(tx: SqlExecutor, op: Op, bill: BillPayload): Promise<void> {
  await tx.executeMany(
    `INSERT OR IGNORE INTO bill_line(bill_id, line_no, item_id, batch_id, name, hsn, unit, qty_milli, unit_paise, mrp_paise, discount_paise,
       taxable_paise, gst_bp, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, cost_paise, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bill.lines.map((l, i) => [bill.id, i + 1, l.itemId, l.batchId, l.name, l.hsn, l.unit, l.qtyMilli, l.unitPaise, l.mrpPaise, l.discountPaise,
      l.taxablePaise, l.gstBp, l.cgstPaise, l.sgstPaise, l.igstPaise, l.cessPaise, l.totalPaise, l.costPaise, bill.day]),
  );
  await tx.executeMany(
    'INSERT OR IGNORE INTO bill_payment(bill_id, seq, mode, amount_paise, ref) VALUES (?, ?, ?, ?, ?)',
    bill.payments.map((p, i) => [bill.id, i + 1, p.mode, p.amountPaise, p.ref]),
  );
  await applyStockDeltas(tx, bill.lines.map((l) => ({ itemId: l.itemId, batchId: l.batchId, deviceId: op.deviceId, deltaMilli: -l.qtyMilli })));
  await bumpItemRank(tx, [...new Set(bill.lines.map((l) => l.itemId))], bill.createdAt);
  const credit = bill.payments.filter((p) => p.mode === 'credit').reduce((s, p) => s + p.amountPaise, 0);
  if (credit > 0 && bill.customerId) {
    await tx.execute(
      `INSERT OR IGNORE INTO ledger_entry(id, customer_id, amount_paise, kind, bill_id, note, mode, created_at, hlc)
       VALUES (?, ?, ?, 'credit_sale', ?, ?, '', ?, ?)`,
      [`${bill.id}:credit`, bill.customerId, credit, bill.id, bill.localNo, bill.createdAt, op.hlc],
    );
  }
}

async function voidBill(tx: SqlExecutor, op: Op, billId: string, at: number): Promise<void> {
  const { rows } = await tx.execute<{ status: string; status_hlc: string; device_id: string; customer_id: string | null; local_no: string }>(
    'SELECT status, status_hlc, device_id, customer_id, local_no FROM bill WHERE id = ?', [billId]);
  const bill = rows[0];
  if (!bill) return; // not here yet: applied when bill.create arrives (from bill_amendment)
  if (bill.status === 'void') {
    // Two devices voided the same bill: effects happen once; the recorded void is the earliest, whatever the arrival order.
    if (op.hlc < bill.status_hlc) {
      await tx.execute('UPDATE bill SET status_hlc = ? WHERE id = ?', [op.hlc, billId]);
      await tx.execute('UPDATE ledger_entry SET hlc = ?, created_at = ? WHERE id = ?', [op.hlc, at, `${billId}:void`]);
    }
    return;
  }
  await tx.execute("UPDATE bill SET status = 'void', status_hlc = ? WHERE id = ?", [op.hlc, billId]);
  const { rows: lines } = await tx.execute<{ item_id: string; batch_id: string; qty_milli: number }>('SELECT item_id, batch_id, qty_milli FROM bill_line WHERE bill_id = ?', [billId]);
  // Restock into the selling device's cell, so the cell is the same whichever device's void applied first.
  await applyStockDeltas(tx, lines.map((l) => ({ itemId: l.item_id, batchId: l.batch_id, deviceId: bill.device_id, deltaMilli: l.qty_milli })));
  if (bill.customer_id) {
    const { rows: credit } = await tx.execute<{ amount_paise: number }>("SELECT amount_paise FROM ledger_entry WHERE id = ?", [`${billId}:credit`]);
    if (credit[0]) {
      await tx.execute(
        `INSERT OR IGNORE INTO ledger_entry(id, customer_id, amount_paise, kind, bill_id, note, mode, created_at, hlc)
         VALUES (?, ?, ?, 'adjust', ?, ?, '', ?, ?)`,
        [`${billId}:void`, bill.customer_id, -credit[0].amount_paise, billId, `Void ${bill.local_no}`, at, op.hlc],
      );
    }
  }
}

/**
 * Applies one op to local state. Must be idempotent and order-insensitive in its final result; callers
 * guarantee exactly-once per op_id via op_log. Returns the tables it touched (for reactive queries).
 */
export async function applyOp(tx: SqlExecutor, op: Op): Promise<Table[]> {
  switch (op.type) {
    case 'item.upsert': {
      await tx.execute("INSERT OR IGNORE INTO item(id, name, deleted) VALUES (?, '', 0)", [op.entityId]);
      const winners = await applyLww(tx, 'item', 'item', ITEM_COLUMNS, op, op.payload);
      if (winners.includes('name') || winners.includes('nameHi')) await refreshItemKeys(tx, op.entityId);
      return ['item'];
    }
    case 'item.bulk':
      await applyItemBulk(tx, op);
      return ['item', 'stock'];
    case 'customer.upsert':
      await tx.execute("INSERT OR IGNORE INTO customer(id, name) VALUES (?, '')", [op.entityId]);
      await applyLww(tx, 'customer', 'customer', CUSTOMER_COLUMNS, op, op.payload);
      return ['customer'];
    case 'supplier.upsert':
      await tx.execute("INSERT OR IGNORE INTO supplier(id, name) VALUES (?, '')", [op.entityId]);
      await applyLww(tx, 'supplier', 'supplier', SUPPLIER_COLUMNS, op, op.payload);
      return ['supplier'];
    case 'batch.upsert': {
      const p = op.payload;
      await tx.execute(
        `INSERT INTO item_batch(id, item_id, batch_no, expiry, mrp_paise, cost_paise, updated_hlc) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET batch_no = excluded.batch_no, expiry = excluded.expiry, mrp_paise = excluded.mrp_paise,
           cost_paise = excluded.cost_paise, updated_hlc = excluded.updated_hlc WHERE excluded.updated_hlc > item_batch.updated_hlc`,
        [op.entityId, p.itemId, p.batchNo, p.expiry, p.mrpPaise, p.costPaise, op.hlc],
      );
      return ['item'];
    }
    case 'stock.adjust': {
      const p = op.payload;
      await tx.execute(
        `INSERT OR IGNORE INTO stock_adjustment(id, item_id, batch_id, delta_milli, reason, note, created_at, hlc, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [op.entityId, p.itemId, p.batchId, p.deltaMilli, p.reason, p.note, p.createdAt, op.hlc, op.deviceId],
      );
      await applyStockDeltas(tx, [{ itemId: p.itemId, batchId: p.batchId, deviceId: op.deviceId, deltaMilli: p.deltaMilli }]);
      return ['stock'];
    }
    case 'bill.create': {
      const b = op.payload;
      const res = await tx.execute(
        `INSERT OR IGNORE INTO bill(id, local_no, device_id, created_at, day, hlc, customer_id, place_of_supply, interstate, gross_paise,
           discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, cost_paise, cashier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.id, b.localNo, op.deviceId, b.createdAt, b.day, op.hlc, b.customerId, b.placeOfSupply, b.interstate ? 1 : 0, b.grossPaise,
          b.discountPaise, b.taxablePaise, b.cgstPaise, b.sgstPaise, b.igstPaise, b.cessPaise, b.roundOffPaise, b.totalPaise, b.costPaise, b.cashier],
      );
      if (res.rowsAffected === 0) return [];
      await applyBillEffects(tx, op, b);
      // The server's bill.number op can arrive first (it sorts by HLC within a page, or the create was held back).
      const { rows: numbered } = await tx.execute<{ payload: string }>("SELECT payload FROM op_log WHERE entity_id = ? AND type = 'bill.number' LIMIT 1", [b.id]);
      if (numbered[0]) await tx.execute('UPDATE bill SET global_no = ? WHERE id = ?', [(JSON.parse(numbered[0].payload) as { globalNo: number }).globalNo, b.id]);
      const { rows: pendingVoid } = await tx.execute<{ id: string; hlc: string; device_id: string; payload: string }>(
        "SELECT id, hlc, device_id, payload FROM bill_amendment WHERE bill_id = ? AND kind = 'void' ORDER BY hlc LIMIT 1", [b.id]);
      if (pendingVoid[0]) {
        const v = pendingVoid[0];
        await voidBill(tx, { ...op, hlc: v.hlc, deviceId: v.device_id }, b.id, (JSON.parse(v.payload) as { at: number }).at);
      }
      return ['bill', 'stock', 'ledger', 'item'];
    }
    case 'bill.void':
      await tx.execute('INSERT OR IGNORE INTO bill_amendment(id, bill_id, hlc, kind, payload, device_id) VALUES (?, ?, ?, ?, ?, ?)', [
        op.opId, op.entityId, op.hlc, 'void', JSON.stringify(op.payload), op.deviceId,
      ]);
      await voidBill(tx, op, op.entityId, op.payload.at);
      return ['bill', 'stock', 'ledger'];
    case 'bill.number':
      await tx.execute('UPDATE bill SET global_no = ? WHERE id = ?', [op.payload.globalNo, op.entityId]);
      return ['bill'];
    case 'ledger.add': {
      const p = op.payload;
      await tx.execute(
        `INSERT OR IGNORE INTO ledger_entry(id, customer_id, amount_paise, kind, bill_id, note, mode, created_at, hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.customerId, p.amountPaise, p.kind, p.billId, p.note, p.mode, p.createdAt, op.hlc],
      );
      return ['ledger'];
    }
    case 'purchase.create': {
      const p = op.payload;
      const res = await tx.execute(
        'INSERT OR IGNORE INTO purchase(id, supplier_id, invoice_no, created_at, day, total_paise, tax_paise, hlc, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.supplierId, p.invoiceNo, p.createdAt, p.day, p.totalPaise, p.taxPaise, op.hlc, op.deviceId],
      );
      if (res.rowsAffected === 0) return [];
      await tx.executeMany(
        'INSERT OR IGNORE INTO purchase_line(purchase_id, line_no, item_id, batch_id, qty_milli, cost_paise, gst_bp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.lines.map((l, i) => [p.id, i + 1, l.itemId, l.batchId, l.qtyMilli, l.costPaise, l.gstBp]),
      );
      await applyStockDeltas(tx, p.lines.map((l) => ({ itemId: l.itemId, batchId: l.batchId, deviceId: op.deviceId, deltaMilli: l.qtyMilli })));
      return ['purchase', 'stock'];
    }
  }
}
