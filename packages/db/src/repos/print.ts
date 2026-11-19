import { uuidv7, upiUri, type Receipt, type Unit } from '@dukaan/core';
import { one, type SqlExecutor } from '../driver';
import { getBill } from './bills';
import { getShop } from './shop';

export type PrintJob = { id: string; kind: 'receipt'; ref_id: string; attempts: number; status: 'queued' | 'printing' | 'done' | 'failed'; last_error: string; created_at: number; next_at: number };

/** Attempts before a job stops retrying on its own (it stays visible and can be retried by hand). */
export const MAX_PRINT_ATTEMPTS = 5;
/** 2 s, 4 s, 8 s, 16 s … capped at 60 s. */
export const printBackoffMs = (attempts: number) => Math.min(2000 * 2 ** Math.max(attempts - 1, 0), 60_000);

export async function enqueuePrint(db: SqlExecutor, billId: string, now = Date.now()): Promise<string> {
  const id = uuidv7(now);
  await db.execute(
    "INSERT INTO print_job(id, kind, ref_id, attempts, status, created_at, next_at) VALUES (?, 'receipt', ?, 0, 'queued', ?, ?)",
    [id, billId, now, now],
  );
  return id;
}

/**
 * Takes the oldest due job and marks it `printing`. A job left `printing` by a crash is due again
 * once its backoff has passed (the app may have died mid-write; reprinting beats losing a receipt).
 */
export async function claimPrintJob(db: SqlExecutor, now = Date.now()): Promise<PrintJob | null> {
  const job = await one<PrintJob>(
    db,
    `SELECT * FROM print_job
     WHERE (status = 'queued' OR (status = 'printing' AND next_at <= ?)) AND next_at <= ?
     ORDER BY created_at LIMIT 1`,
    [now - 60_000, now],
  );
  if (!job) return null;
  const attempts = job.attempts + 1;
  await db.execute("UPDATE print_job SET status = 'printing', attempts = ?, next_at = ? WHERE id = ?", [attempts, now, job.id]);
  return { ...job, status: 'printing', attempts, next_at: now };
}

export async function finishPrintJob(db: SqlExecutor, id: string): Promise<void> {
  await db.execute("UPDATE print_job SET status = 'done', last_error = '' WHERE id = ?", [id]);
}

/** Back to `queued` with exponential backoff, or `failed` after {@link MAX_PRINT_ATTEMPTS}. */
export async function failPrintJob(db: SqlExecutor, id: string, error: string, now = Date.now()): Promise<'queued' | 'failed'> {
  const job = await one<{ attempts: number }>(db, 'SELECT attempts FROM print_job WHERE id = ?', [id]);
  const attempts = job?.attempts ?? MAX_PRINT_ATTEMPTS;
  const status = attempts >= MAX_PRINT_ATTEMPTS ? 'failed' : 'queued';
  await db.execute('UPDATE print_job SET status = ?, last_error = ?, next_at = ? WHERE id = ?', [status, error.slice(0, 300), now + printBackoffMs(attempts), id]);
  return status;
}

export async function retryPrintJob(db: SqlExecutor, id: string, now = Date.now()): Promise<void> {
  await db.execute("UPDATE print_job SET status = 'queued', attempts = 0, next_at = ? WHERE id = ?", [now, id]);
}

export async function listPrintJobs(db: SqlExecutor, limit = 20): Promise<(PrintJob & { local_no: string | null })[]> {
  const { rows } = await db.execute<PrintJob & { local_no: string | null }>(
    `SELECT j.*, b.local_no FROM print_job j LEFT JOIN bill b ON b.id = j.ref_id
     WHERE j.status != 'done' OR j.created_at > ? ORDER BY j.created_at DESC LIMIT ?`,
    [Date.now() - 86_400_000, limit],
  );
  return rows;
}

/** Everything the thermal receipt needs, from the stored bill (not the cart — reprints must match). */
export async function receiptForBill(db: SqlExecutor, billId: string): Promise<Receipt | null> {
  const [stored, shop] = await Promise.all([getBill(db, billId), getShop(db)]);
  if (!stored || !shop) return null;
  const b = stored.bill as Record<string, number | string>;
  const owed = stored.payments.filter((p) => p.mode === 'credit').reduce((s, p) => s + p.amount_paise, 0);
  return {
    shopName: shop.name,
    address: shop.address,
    gstin: shop.gstin,
    billNo: String(b.local_no),
    createdAt: Number(b.created_at),
    lines: stored.lines.map((l) => ({
      name: String(l.name), unit: l.unit as Unit, qtyMilli: Number(l.qty_milli), unitPaise: Number(l.unit_paise), totalPaise: Number(l.total_paise),
    })),
    taxPaise: Number(b.cgst_paise) + Number(b.sgst_paise) + Number(b.igst_paise) + Number(b.cess_paise),
    discountPaise: Number(b.discount_paise),
    roundOffPaise: Number(b.round_off_paise),
    totalPaise: Number(b.total_paise),
    payments: stored.payments.map((p) => ({ mode: p.mode === 'credit' ? 'khata' : p.mode, amountPaise: p.amount_paise })),
    footer: b.status === 'void' ? '*** VOID ***' : shop.invoiceFooter,
    // A QR only helps when something is still owed: the customer can settle the khata later.
    upiUri: owed > 0 && shop.upiVpa ? upiUri({ vpa: shop.upiVpa, payee: shop.name, amountPaise: owed, note: `Bill ${b.local_no}` }) : undefined,
  };
}
