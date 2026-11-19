import { uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import type { CustomerFields } from '../sync/ops';
import type { OpWriter } from '../sync/writer';
import { getMeta, setMeta } from './meta';

export type KhataRow = { id: string; name: string; phone: string; balance_paise: number; last_at: number | null; last_payment_at: number | null };

/**
 * Customers with their derived balance. `dueOnly` keeps those who owe; ordered by biggest due first,
 * otherwise by name. Balance is always SUM(ledger_entry) — never a stored number that could drift.
 */
export async function khataList(db: SqlExecutor, opts: { q?: string; dueOnly?: boolean; limit?: number } = {}): Promise<KhataRow[]> {
  const term = (opts.q ?? '').trim();
  const where = ['c.deleted = 0'];
  const args: (string | number)[] = [];
  if (term) {
    where.push('(c.name LIKE ? OR c.phone LIKE ?)');
    args.push(`%${term}%`, `${term.replace(/\D/g, '') || term}%`);
  }
  const { rows } = await db.execute<KhataRow>(
    `SELECT * FROM (
       SELECT c.id, c.name, c.phone,
              coalesce(sum(l.amount_paise), 0) AS balance_paise,
              max(l.created_at) AS last_at,
              max(CASE WHEN l.kind = 'payment' THEN l.created_at END) AS last_payment_at
       FROM customer c LEFT JOIN ledger_entry l ON l.customer_id = c.id
       WHERE ${where.join(' AND ')} GROUP BY c.id)
     ${opts.dueOnly ? 'WHERE balance_paise > 0 ORDER BY balance_paise DESC' : 'ORDER BY name COLLATE NOCASE'} LIMIT ?`,
    [...args, opts.limit ?? 500],
  );
  return rows;
}

export async function khataTotals(db: SqlExecutor): Promise<{ duePaise: number; customersDue: number }> {
  const { rows } = await db.execute<{ due: number; n: number }>(
    `SELECT coalesce(sum(b), 0) AS due, count(*) AS n FROM (
       SELECT sum(l.amount_paise) AS b FROM ledger_entry l JOIN customer c ON c.id = l.customer_id AND c.deleted = 0
       GROUP BY l.customer_id HAVING b > 0)`,
  );
  return { duePaise: rows[0]?.due ?? 0, customersDue: rows[0]?.n ?? 0 };
}

export type CustomerDetail = { id: string; name: string; phone: string; gstin: string; state_code: string; address: string; credit_limit_paise: number };

export async function getCustomer(db: SqlExecutor, id: string): Promise<CustomerDetail | null> {
  const { rows } = await db.execute<CustomerDetail>(
    'SELECT id, name, phone, gstin, state_code, address, credit_limit_paise FROM customer WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function updateCustomer(db: SqlDriver, writer: OpWriter, id: string, fields: CustomerFields): Promise<void> {
  const clean: CustomerFields = { ...fields };
  if (clean.name !== undefined) {
    clean.name = clean.name.trim();
    if (!clean.name) throw new Error('customer name required');
  }
  if (clean.phone !== undefined) clean.phone = clean.phone.replace(/\D/g, '').slice(-10);
  if (clean.gstin !== undefined) clean.gstin = clean.gstin.trim().toUpperCase();
  await writer.write(db, [{ type: 'customer.upsert', entity: 'customer', entityId: id, payload: clean }]);
}

export type LedgerRow = {
  id: string; created_at: number; kind: string; note: string; mode: string; amount_paise: number; bill_id: string | null;
  bill_no: string | null; balance_paise: number;
};

/** Oldest first, with the running balance after each entry (window SUM; ties broken by id = uuidv7 order). */
export async function ledgerFor(db: SqlExecutor, customerId: string): Promise<LedgerRow[]> {
  const { rows } = await db.execute<LedgerRow>(
    `SELECT l.id, l.created_at, l.kind, l.note, l.mode, l.amount_paise, l.bill_id,
            coalesce(CAST(b.global_no AS TEXT), b.local_no) AS bill_no,
            sum(l.amount_paise) OVER (ORDER BY l.created_at, l.id ROWS UNBOUNDED PRECEDING) AS balance_paise
     FROM ledger_entry l LEFT JOIN bill b ON b.id = l.bill_id
     WHERE l.customer_id = ? ORDER BY l.created_at, l.id`,
    [customerId],
  );
  return rows;
}

export type PaymentMode = 'cash' | 'upi' | 'card';

/** Money received against khata. Stored as a negative ledger entry; any device may record it. */
export async function recordPayment(
  db: SqlDriver, writer: OpWriter,
  input: { customerId: string; amountPaise: number; mode: PaymentMode; note?: string; now?: number },
): Promise<string> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error('enter the amount received');
  const now = input.now ?? Date.now();
  const id = uuidv7(now);
  await writer.write(db, [{
    type: 'ledger.add', entity: 'ledger', entityId: id,
    payload: { id, customerId: input.customerId, amountPaise: -input.amountPaise, kind: 'payment', note: (input.note ?? '').trim(), mode: input.mode, createdAt: now, billId: null },
  }]);
  return id;
}

/** Opening balance (moving an old paper khata in) or a correction. Positive = customer owes more. */
export async function addLedgerAdjustment(
  db: SqlDriver, writer: OpWriter,
  input: { customerId: string; amountPaise: number; kind: 'opening' | 'adjust'; note?: string; now?: number },
): Promise<string> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise === 0) throw new Error('enter an amount');
  const now = input.now ?? Date.now();
  const id = uuidv7(now);
  await writer.write(db, [{
    type: 'ledger.add', entity: 'ledger', entityId: id,
    payload: { id, customerId: input.customerId, amountPaise: input.amountPaise, kind: input.kind, note: (input.note ?? '').trim(), mode: '', createdAt: now, billId: null },
  }]);
  return id;
}

/* Reminders: when a reminder was last sent is a per-device nudge, not shop data, so it lives in meta (never synced). */
const REMINDED = 'khata.reminded';

async function remindedMap(db: SqlExecutor): Promise<Record<string, number>> {
  return (await getMeta<Record<string, number>>(db, REMINDED)) ?? {};
}

export async function markReminded(db: SqlExecutor, customerId: string, at = Date.now()): Promise<void> {
  const m = await remindedMap(db);
  m[customerId] = at;
  await setMeta(db, REMINDED, m);
}

export async function lastReminded(db: SqlExecutor, customerId: string): Promise<number | null> {
  return (await remindedMap(db))[customerId] ?? null;
}

export type ReminderDue = KhataRow & { reminded_at: number | null };

/**
 * Who to nudge: owes at least `minPaise`, has not paid in `quietDays`, and was not reminded in the last
 * `gapDays`. Biggest dues first.
 */
export async function remindersDue(
  db: SqlExecutor, opts: { now?: number; minPaise?: number; quietDays?: number; gapDays?: number } = {},
): Promise<ReminderDue[]> {
  const now = opts.now ?? Date.now();
  const day = 86_400_000;
  const quiet = now - (opts.quietDays ?? 7) * day;
  const gap = now - (opts.gapDays ?? 3) * day;
  const reminded = await remindedMap(db);
  return (await khataList(db, { dueOnly: true }))
    .filter((r) => r.balance_paise >= (opts.minPaise ?? 1) && (r.last_payment_at ?? 0) < quiet && (reminded[r.id] ?? 0) < gap)
    .map((r) => ({ ...r, reminded_at: reminded[r.id] ?? null }));
}
