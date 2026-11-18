import { computeBill, uuidv7, type BillTotals, type Discount, type LineInput } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import { tablesChanged } from '../changes';
import type { BillPayload, PaymentPayload } from '../sync/ops';
import type { OpWriter } from '../sync/writer';

export type Cart = {
  lines: LineInput[];
  billDiscount: Discount | null;
  customerId: string | null;
  interstate: boolean;
  placeOfSupply: string;
};

export type SaveBillInput = { cart: Cart; payments: PaymentPayload[]; cashier: string; now?: number };

export class BillError extends Error {}

export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function validatePayments(totals: BillTotals, payments: readonly PaymentPayload[], customerId: string | null): void {
  if (totals.total < 0) throw new BillError('bill total is negative');
  const paid = payments.reduce((s, p) => s + p.amountPaise, 0);
  if (payments.some((p) => p.amountPaise <= 0)) throw new BillError('payment amounts must be positive');
  if (paid !== totals.total) throw new BillError(`payments ₹${paid / 100} do not match total ₹${totals.total / 100}`);
  if (payments.some((p) => p.mode === 'credit') && !customerId) throw new BillError('credit (khata) needs a customer');
}

async function nextBillNo(tx: SqlExecutor, prefix: string): Promise<string> {
  await tx.execute('INSERT OR IGNORE INTO bill_series(prefix, next_seq) VALUES (?, 1)', [prefix]);
  const { rows } = await tx.execute<{ seq: number }>('UPDATE bill_series SET next_seq = next_seq + 1 WHERE prefix = ? RETURNING next_seq - 1 AS seq', [prefix]);
  return `${prefix}-${String(rows[0]!.seq).padStart(6, '0')}`;
}

/**
 * Saves a bill in one transaction: number from this device's series (no collisions offline), GST totals,
 * lines, payments, stock decrements, khata credit and the op-log entry. Returns the stored payload.
 */
export async function saveBill(db: SqlDriver, writer: OpWriter, prefix: string, input: SaveBillInput): Promise<BillPayload> {
  const { cart } = input;
  if (cart.lines.length === 0) throw new BillError('bill has no items');
  if (cart.lines.some((l) => l.qtyMilli <= 0)) throw new BillError('quantities must be positive');
  const totals = computeBill({ lines: cart.lines, interstate: cart.interstate, billDiscount: cart.billDiscount });
  validatePayments(totals, input.payments, cart.customerId);
  const now = input.now ?? Date.now();
  const id = uuidv7(now);

  const { payload, tables } = await db.transaction(async (tx) => {
    const localNo = await nextBillNo(tx, prefix);
    const payload: BillPayload = {
      id, localNo, createdAt: now, day: localDay(now), customerId: cart.customerId, placeOfSupply: cart.placeOfSupply, interstate: cart.interstate,
      grossPaise: totals.gross, discountPaise: totals.discount, taxablePaise: totals.taxable, cgstPaise: totals.cgst, sgstPaise: totals.sgst,
      igstPaise: totals.igst, cessPaise: totals.cess, roundOffPaise: totals.roundOff, totalPaise: totals.total, costPaise: totals.cost,
      cashier: input.cashier, billDiscount: cart.billDiscount,
      lines: cart.lines.map((l, i) => {
        const t = totals.lines[i]!;
        return {
          itemId: l.itemId, batchId: l.batchId ?? '', name: l.name, hsn: l.hsn, unit: l.unit, qtyMilli: l.qtyMilli, unitPaise: l.unitPaise,
          mrpPaise: l.mrpPaise, discountPaise: t.lineDiscount + t.billDiscount, taxablePaise: t.taxable, gstBp: l.gstBp, cgstPaise: t.cgst,
          sgstPaise: t.sgst, igstPaise: t.igst, cessPaise: t.cess, totalPaise: t.net, costPaise: t.cost,
        };
      }),
      payments: input.payments,
    };
    const { tables } = await writer.writeIn(tx, [{ type: 'bill.create', entity: 'bill', entityId: id, payload }]);
    return { payload, tables };
  });
  tablesChanged(...tables);
  return payload;
}

export async function voidBill(db: SqlDriver, writer: OpWriter, billId: string, reason: string): Promise<void> {
  if (writer.ctx.role !== 'owner') throw new BillError('only the owner can void a bill');
  await writer.write(db, [{ type: 'bill.void', entity: 'bill', entityId: billId, payload: { reason, at: Date.now() } }]);
}

// ── Parked bills (local to this counter, never synced) ────────────────────────────────────────────────
export type HeldBill = { id: string; label: string; cart: Cart; createdAt: number };

export async function holdBill(db: SqlExecutor, label: string, cart: Cart): Promise<string> {
  const id = uuidv7();
  await db.execute('INSERT INTO held_bill(id, label, payload, created_at) VALUES (?, ?, ?, ?)', [id, label, JSON.stringify(cart), Date.now()]);
  tablesChanged('held');
  return id;
}

export async function listHeldBills(db: SqlExecutor): Promise<HeldBill[]> {
  const { rows } = await db.execute<{ id: string; label: string; payload: string; created_at: number }>('SELECT id, label, payload, created_at FROM held_bill ORDER BY created_at');
  return rows.map((r) => ({ id: r.id, label: r.label, cart: JSON.parse(r.payload) as Cart, createdAt: r.created_at }));
}

export async function resumeHeldBill(db: SqlExecutor, id: string): Promise<Cart | null> {
  const { rows } = await db.execute<{ payload: string }>('DELETE FROM held_bill WHERE id = ? RETURNING payload', [id]);
  tablesChanged('held');
  return rows[0] ? (JSON.parse(rows[0].payload) as Cart) : null;
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────
export type BillSummary = { id: string; local_no: string; global_no: number | null; created_at: number; total_paise: number; status: string; customer_id: string | null; lines: number };

/** Recent bills, keyset-paginated on (created_at DESC, id). */
export async function listBills(db: SqlExecutor, opts: { before?: { createdAt: number; id: string } | null; limit?: number } = {}): Promise<BillSummary[]> {
  const limit = opts.limit ?? 50;
  const cursor = opts.before;
  const { rows } = await db.execute<BillSummary>(
    `SELECT b.id, b.local_no, b.global_no, b.created_at, b.total_paise, b.status, b.customer_id,
       (SELECT count(*) FROM bill_line l WHERE l.bill_id = b.id) AS lines
     FROM bill b ${cursor ? 'WHERE (b.created_at, b.id) < (?, ?)' : ''}
     ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
    cursor ? [cursor.createdAt, cursor.id, limit] : [limit],
  );
  return rows;
}

export async function getBill(db: SqlExecutor, id: string) {
  const [{ rows: bills }, { rows: lines }, { rows: payments }] = await Promise.all([
    db.execute<Record<string, unknown> & { id: string; local_no: string; total_paise: number; status: string }>('SELECT * FROM bill WHERE id = ?', [id]),
    db.execute<Record<string, unknown>>('SELECT * FROM bill_line WHERE bill_id = ? ORDER BY line_no', [id]),
    db.execute<{ mode: string; amount_paise: number; ref: string }>('SELECT mode, amount_paise, ref FROM bill_payment WHERE bill_id = ? ORDER BY seq', [id]),
  ]);
  return bills[0] ? { bill: bills[0], lines, payments } : null;
}
