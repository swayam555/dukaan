import { divRoundHalfUp, lineAmount, uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import type { PurchasePayload } from '../sync/ops';
import type { OpDraft, OpWriter } from '../sync/writer';
import { localDay } from './bills';

export type AdjustReason = 'damage' | 'expiry' | 'count' | 'theft' | 'opening' | 'other';
export const ADJUST_REASONS: readonly AdjustReason[] = ['count', 'damage', 'expiry', 'theft', 'opening', 'other'];

export type PurchaseLineInput = {
  itemId: string;
  qtyMilli: number;
  /** Per unit, before GST. */
  costPaise: number;
  gstBp: number;
  /** Optional batch (pharmacy / FMCG with dates). Creates a new batch row. */
  batch?: { batchNo: string; expiry: string | null; mrpPaise: number } | null;
};

export type PurchaseInput = { supplierId: string | null; invoiceNo: string; lines: PurchaseLineInput[]; now?: number };

export function purchaseTotals(lines: readonly PurchaseLineInput[]): { taxablePaise: number; taxPaise: number; totalPaise: number } {
  let taxable = 0;
  let tax = 0;
  for (const l of lines) {
    const t = lineAmount(l.costPaise, l.qtyMilli);
    taxable += t;
    tax += divRoundHalfUp(t * l.gstBp, 10_000);
  }
  return { taxablePaise: taxable, taxPaise: tax, totalPaise: taxable + tax };
}

const EXPIRY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Goods received from a supplier: one purchase.create op (stock in) plus a batch.upsert per dated batch
 * and an item.upsert when the unit cost changed, so margins in reports use the latest cost. Owner only.
 */
export async function recordPurchase(db: SqlDriver, writer: OpWriter, input: PurchaseInput): Promise<PurchasePayload> {
  if (input.lines.length === 0) throw new Error('add at least one item');
  for (const l of input.lines) {
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error('quantity must be more than zero');
    if (!Number.isInteger(l.costPaise) || l.costPaise < 0) throw new Error('cost cannot be negative');
    if (l.batch?.expiry && !EXPIRY_RE.test(l.batch.expiry)) throw new Error(`expiry must be YYYY-MM-DD, got "${l.batch.expiry}"`);
  }
  const now = input.now ?? Date.now();
  const ops: OpDraft[] = [];
  const lines: PurchasePayload['lines'] = [];
  const ids = input.lines.map((l) => l.itemId);
  const { rows: current } = await db.execute<{ id: string; cost_paise: number }>(
    `SELECT id, cost_paise FROM item WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const costOf = new Map(current.map((r) => [r.id, r.cost_paise]));
  for (const l of input.lines) {
    if (!costOf.has(l.itemId)) throw new Error(`unknown item ${l.itemId}`);
    let batchId = '';
    if (l.batch) {
      batchId = uuidv7(now);
      ops.push({ type: 'batch.upsert', entity: 'batch', entityId: batchId,
        payload: { itemId: l.itemId, batchNo: l.batch.batchNo.trim(), expiry: l.batch.expiry || null, mrpPaise: l.batch.mrpPaise, costPaise: l.costPaise } });
    }
    if (costOf.get(l.itemId) !== l.costPaise) {
      ops.push({ type: 'item.upsert', entity: 'item', entityId: l.itemId, payload: { costPaise: l.costPaise } });
      costOf.set(l.itemId, l.costPaise);
    }
    lines.push({ itemId: l.itemId, batchId, qtyMilli: l.qtyMilli, costPaise: l.costPaise, gstBp: l.gstBp });
  }
  const t = purchaseTotals(input.lines);
  const payload: PurchasePayload = {
    id: uuidv7(now), supplierId: input.supplierId, invoiceNo: input.invoiceNo.trim(), createdAt: now, day: localDay(now),
    totalPaise: t.totalPaise, taxPaise: t.taxPaise, lines,
  };
  ops.push({ type: 'purchase.create', entity: 'purchase', entityId: payload.id, payload });
  await writer.write(db, ops);
  return payload;
}

/** Manual correction (count, damage, expiry write-off…). Owner only; reason is kept for the audit trail. */
export async function adjustStock(
  db: SqlDriver, writer: OpWriter,
  input: { itemId: string; batchId?: string; deltaMilli: number; reason: AdjustReason; note?: string; now?: number },
): Promise<string> {
  if (!Number.isInteger(input.deltaMilli) || input.deltaMilli === 0) throw new Error('enter a quantity to add or remove');
  if (!ADJUST_REASONS.includes(input.reason)) throw new Error(`unknown reason ${input.reason}`);
  const id = uuidv7(input.now);
  await writer.write(db, [{
    type: 'stock.adjust', entity: 'stock', entityId: id,
    payload: { itemId: input.itemId, batchId: input.batchId ?? '', deltaMilli: input.deltaMilli, reason: input.reason, note: (input.note ?? '').trim(), createdAt: input.now ?? Date.now() },
  }]);
  return id;
}

export type LowStockRow = { id: string; name: string; unit: string; qty_milli: number; low_stock_milli: number; cost_paise: number };

/** Items at or below their re-order level, emptiest first (by fraction of the level left). */
export async function lowStock(db: SqlExecutor, limit = 200): Promise<LowStockRow[]> {
  const { rows } = await db.execute<LowStockRow>(
    `SELECT i.id, i.name, i.unit, coalesce(s.qty_milli, 0) AS qty_milli, i.low_stock_milli, i.cost_paise
     FROM item i LEFT JOIN item_stock s ON s.item_id = i.id
     WHERE i.deleted = 0 AND i.low_stock_milli > 0 AND coalesce(s.qty_milli, 0) <= i.low_stock_milli
     ORDER BY CAST(coalesce(s.qty_milli, 0) AS REAL) / i.low_stock_milli, i.name LIMIT ?`,
    [limit],
  );
  return rows;
}

export type ExpiringRow = { batch_id: string; item_id: string; name: string; unit: string; batch_no: string; expiry: string; qty_milli: number; days_left: number };

/** Batches still in stock that expire within `days` of `today` (already-expired ones included, days_left < 0). */
export async function expiringBatches(db: SqlExecutor, today: string, days = 30): Promise<ExpiringRow[]> {
  const { rows } = await db.execute<ExpiringRow>(
    `SELECT b.id AS batch_id, b.item_id, i.name, i.unit, b.batch_no, b.expiry,
            coalesce((SELECT sum(c.inc_milli - c.dec_milli) FROM stock_cell c WHERE c.item_id = b.item_id AND c.batch_id = b.id), 0) AS qty_milli,
            CAST(julianday(b.expiry) - julianday(?) AS INTEGER) AS days_left
     FROM item_batch b JOIN item i ON i.id = b.item_id
     WHERE b.deleted = 0 AND b.expiry IS NOT NULL AND b.expiry <= date(?, '+' || ? || ' days')
     ORDER BY b.expiry, i.name`,
    [today, today, days],
  );
  return rows.filter((r) => r.qty_milli > 0);
}

export type SupplierRow = { id: string; name: string; phone: string; gstin: string };

export async function listSuppliers(db: SqlExecutor): Promise<SupplierRow[]> {
  return (await db.execute<SupplierRow>('SELECT id, name, phone, gstin FROM supplier WHERE deleted = 0 ORDER BY name COLLATE NOCASE')).rows;
}

export async function createSupplier(db: SqlDriver, writer: OpWriter, input: { name: string; phone?: string; gstin?: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('supplier name required');
  const id = uuidv7();
  await writer.write(db, [{ type: 'supplier.upsert', entity: 'supplier', entityId: id,
    payload: { name, phone: (input.phone ?? '').replace(/\D/g, '').slice(-10), gstin: (input.gstin ?? '').trim().toUpperCase() } }]);
  return id;
}

export type PurchaseRow = { id: string; supplier: string | null; invoice_no: string; created_at: number; total_paise: number; lines: number };

export async function listPurchases(db: SqlExecutor, limit = 50): Promise<PurchaseRow[]> {
  return (await db.execute<PurchaseRow>(
    `SELECT p.id, s.name AS supplier, p.invoice_no, p.created_at, p.total_paise,
            (SELECT count(*) FROM purchase_line l WHERE l.purchase_id = p.id) AS lines
     FROM purchase p LEFT JOIN supplier s ON s.id = p.supplier_id ORDER BY p.created_at DESC LIMIT ?`, [limit])).rows;
}
