import type { SqlExecutor } from '../driver';

export type StockDelta = { itemId: string; batchId?: string; deviceId: string; deltaMilli: number };

/**
 * Op-based PN-counter. Each device owns its (inc, dec) cell per item/batch; deltas commute, and the op
 * log guarantees each delta is applied exactly once, so any application order converges. item_stock is
 * the materialised Σ(inc − dec), updated in the same transaction.
 */
export async function applyStockDeltas(tx: SqlExecutor, deltas: readonly StockDelta[]): Promise<void> {
  const nonZero = deltas.filter((d) => d.deltaMilli !== 0);
  if (nonZero.length === 0) return;
  await tx.executeMany(
    `INSERT INTO stock_cell(item_id, batch_id, device_id, inc_milli, dec_milli) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id, batch_id, device_id) DO UPDATE SET
       inc_milli = stock_cell.inc_milli + excluded.inc_milli,
       dec_milli = stock_cell.dec_milli + excluded.dec_milli`,
    nonZero.map((d) => [d.itemId, d.batchId ?? '', d.deviceId, Math.max(d.deltaMilli, 0), Math.max(-d.deltaMilli, 0)]),
  );
  await tx.executeMany(
    `INSERT INTO item_stock(item_id, qty_milli) VALUES (?, ?)
     ON CONFLICT(item_id) DO UPDATE SET qty_milli = item_stock.qty_milli + excluded.qty_milli`,
    nonZero.map((d) => [d.itemId, d.deltaMilli]),
  );
}

export async function stockOf(db: SqlExecutor, itemId: string): Promise<number> {
  const { rows } = await db.execute<{ q: number }>('SELECT coalesce(sum(inc_milli - dec_milli), 0) AS q FROM stock_cell WHERE item_id = ?', [itemId]);
  return rows[0]?.q ?? 0;
}
