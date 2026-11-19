import { STATES } from '@dukaan/core';
import type { SqlExecutor } from '../driver';

/** Inclusive YYYY-MM-DD range over bill.day (the device's local date at billing time). */
export type DayRange = { from: string; to: string };

export type DaySales = { day: string; bills: number; total_paise: number; profit_paise: number };

/** One row per day in the range, zero-filled so charts get a continuous x-axis. Void bills excluded. */
export async function salesByDay(db: SqlExecutor, r: DayRange): Promise<DaySales[]> {
  const { rows } = await db.execute<DaySales>(
    `WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?)
     SELECT d.day, count(b.id) AS bills, coalesce(sum(b.total_paise), 0) AS total_paise,
            coalesce(sum(b.taxable_paise - b.cost_paise), 0) AS profit_paise
     FROM d LEFT JOIN bill b ON b.day = d.day AND b.status != 'void'
     GROUP BY d.day ORDER BY d.day`,
    [r.from, r.to],
  );
  return rows;
}

export type SalesSummary = { bills: number; total_paise: number; tax_paise: number; profit_paise: number; voids: number; avg_bill_paise: number };

export async function salesSummary(db: SqlExecutor, r: DayRange): Promise<SalesSummary> {
  const { rows } = await db.execute<Omit<SalesSummary, 'avg_bill_paise'>>(
    `SELECT sum(status != 'void') AS bills,
            coalesce(sum(CASE WHEN status != 'void' THEN total_paise END), 0) AS total_paise,
            coalesce(sum(CASE WHEN status != 'void' THEN cgst_paise + sgst_paise + igst_paise + cess_paise END), 0) AS tax_paise,
            coalesce(sum(CASE WHEN status != 'void' THEN taxable_paise - cost_paise END), 0) AS profit_paise,
            sum(status = 'void') AS voids
     FROM bill WHERE day BETWEEN ? AND ?`,
    [r.from, r.to],
  );
  const s = rows[0]!;
  const bills = s.bills ?? 0;
  return { ...s, bills, voids: s.voids ?? 0, avg_bill_paise: bills ? Math.round(s.total_paise / bills) : 0 };
}

export type ModeSplit = { mode: string; amount_paise: number; bills: number };

/** Money in by payment mode. Change returned on cash is already netted out at billing. */
export async function paymentSplit(db: SqlExecutor, r: DayRange): Promise<ModeSplit[]> {
  return (await db.execute<ModeSplit>(
    `SELECT p.mode, sum(p.amount_paise) AS amount_paise, count(DISTINCT p.bill_id) AS bills
     FROM bill_payment p JOIN bill b ON b.id = p.bill_id
     WHERE b.day BETWEEN ? AND ? AND b.status != 'void'
     GROUP BY p.mode ORDER BY amount_paise DESC`,
    [r.from, r.to],
  )).rows;
}

export type TopItem = { item_id: string; name: string; unit: string; qty_milli: number; total_paise: number; profit_paise: number };

export async function topItems(db: SqlExecutor, r: DayRange, by: 'revenue' | 'qty' = 'revenue', limit = 10): Promise<TopItem[]> {
  return (await db.execute<TopItem>(
    `SELECT l.item_id, l.name, l.unit, sum(l.qty_milli) AS qty_milli, sum(l.total_paise) AS total_paise,
            sum(l.taxable_paise - l.cost_paise) AS profit_paise
     FROM bill_line l JOIN bill b ON b.id = l.bill_id
     WHERE l.day BETWEEN ? AND ? AND b.status != 'void'
     GROUP BY l.item_id ORDER BY ${by === 'qty' ? 'qty_milli' : 'total_paise'} DESC LIMIT ?`,
    [r.from, r.to, limit],
  )).rows;
}

/* ───────────────────────────── GSTR-1 (offline-tool CSV layout) ───────────────────────────── */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** GST offline tool date format: 05-Nov-2026. */
export const gstDate = (day: string) => `${day.slice(8, 10)}-${MON[Number(day.slice(5, 7)) - 1]}-${day.slice(0, 4)}`;
const pos = (code: string) => `${code}-${STATES[code] ?? ''}`;
const amt = (paise: number) => (paise / 100).toFixed(2);
const rate = (bp: number) => String(bp / 100);
const qty = (milli: number) => (milli / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
/** App unit → GST Unit Quantity Code, written as the offline tool's "CODE-NAME" list value. */
const UQC: Record<string, string> = { pcs: 'NOS-NUMBERS', pack: 'PAC-PACKS', kg: 'KGS-KILOGRAMS', g: 'GMS-GRAMMES', l: 'LTR-LITRES', ml: 'MLT-MILILITRE' };

function csv(header: readonly string[], rows: readonly (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** B2C invoices above this (inter-state, unregistered buyer) are reported one by one in B2CL (₹1 lakh from Aug 2024). */
export const B2CL_LIMIT_PAISE = 100_000_00;

export type Gstr1 = { b2b: string; b2cl: string; b2cs: string; hsn_b2b: string; hsn_b2c: string; docs: string; counts: Record<string, number> };

type BillRate = {
  id: string; local_no: string; day: string; total_paise: number; place_of_supply: string; interstate: number;
  gstin: string | null; cname: string | null; gst_bp: number; taxable: number; cess: number;
};

/**
 * GSTR-1 sections for a return period as CSVs matching the GST offline utility's import templates:
 * b2b (registered buyers), b2cl (large inter-state B2C), b2cs (rest of B2C, grouped by place of supply + rate),
 * hsn (summary, split B2B / B2C) and docs (invoice series with cancellations). Void bills appear only in docs.
 */
export async function gstr1(db: SqlExecutor, r: DayRange): Promise<Gstr1> {
  const { rows } = await db.execute<BillRate>(
    `SELECT b.id, b.local_no, b.day, b.total_paise, b.place_of_supply, b.interstate,
            nullif(c.gstin, '') AS gstin, c.name AS cname, l.gst_bp,
            sum(l.taxable_paise) AS taxable, sum(l.cess_paise) AS cess
     FROM bill b JOIN bill_line l ON l.bill_id = b.id LEFT JOIN customer c ON c.id = b.customer_id
     WHERE b.day BETWEEN ? AND ? AND b.status != 'void'
     GROUP BY b.id, l.gst_bp ORDER BY b.day, b.local_no, l.gst_bp`,
    [r.from, r.to],
  );

  const b2b: (string | number)[][] = [];
  const b2cl: (string | number)[][] = [];
  const b2cs = new Map<string, { pos: string; bp: number; taxable: number; cess: number }>();
  const b2bIds = new Set<string>();
  for (const x of rows) {
    if (x.gstin) {
      b2bIds.add(x.id);
      b2b.push([x.gstin, x.cname ?? '', x.local_no, gstDate(x.day), amt(x.total_paise), pos(x.place_of_supply), 'N', '', 'Regular B2B', '', rate(x.gst_bp), amt(x.taxable), amt(x.cess)]);
    } else if (x.interstate && x.total_paise > B2CL_LIMIT_PAISE) {
      b2cl.push([x.local_no, gstDate(x.day), amt(x.total_paise), pos(x.place_of_supply), '', rate(x.gst_bp), amt(x.taxable), amt(x.cess), '']);
    } else {
      const k = `${x.place_of_supply}|${x.gst_bp}`;
      const g = b2cs.get(k) ?? { pos: x.place_of_supply, bp: x.gst_bp, taxable: 0, cess: 0 };
      g.taxable += x.taxable;
      g.cess += x.cess;
      b2cs.set(k, g);
    }
  }
  const b2csRows = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.bp - b.bp)
    .map((g) => ['OE', pos(g.pos), '', rate(g.bp), amt(g.taxable), amt(g.cess), '']);

  // HSN summary from line level, split by whether the bill went to a registered buyer.
  const { rows: hsnRows } = await db.execute<{ bill_id: string; hsn: string; name: string; unit: string; gst_bp: number; qty: number; total: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }>(
    `SELECT l.bill_id, l.hsn, l.name, l.unit, l.gst_bp, l.qty_milli AS qty, l.total_paise AS total, l.taxable_paise AS taxable,
            l.igst_paise AS igst, l.cgst_paise AS cgst, l.sgst_paise AS sgst, l.cess_paise AS cess
     FROM bill_line l JOIN bill b ON b.id = l.bill_id WHERE b.day BETWEEN ? AND ? AND b.status != 'void'`,
    [r.from, r.to],
  );
  type H = { hsn: string; desc: string; uqc: string; bp: number; qty: number; total: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number };
  const groups = { b2b: new Map<string, H>(), b2c: new Map<string, H>() };
  for (const l of hsnRows) {
    const g = groups[b2bIds.has(l.bill_id) ? 'b2b' : 'b2c'];
    const uqc = UQC[l.unit] ?? 'OTH-OTHERS';
    const k = `${l.hsn}|${uqc}|${l.gst_bp}`;
    const h = g.get(k) ?? { hsn: l.hsn, desc: l.name, uqc, bp: l.gst_bp, qty: 0, total: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    h.qty += l.qty; h.total += l.total; h.taxable += l.taxable; h.igst += l.igst; h.cgst += l.cgst; h.sgst += l.sgst; h.cess += l.cess;
    g.set(k, h);
  }
  const HSN_HEAD = ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'];
  const hsnCsv = (m: Map<string, H>) => csv(HSN_HEAD, [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.bp - b.bp)
    .map((h) => [h.hsn, h.desc, h.uqc,
      qty(h.qty), amt(h.total), rate(h.bp), amt(h.taxable), amt(h.igst), amt(h.cgst), amt(h.sgst), amt(h.cess)]));

  // Documents issued: one series per device prefix (A-000001…), cancelled = voided bills.
  const { rows: series } = await db.execute<{ prefix: string; first: string; last: string; total: number; cancelled: number }>(
    `SELECT substr(local_no, 1, instr(local_no, '-') - 1) AS prefix, min(local_no) AS first, max(local_no) AS last,
            count(*) AS total, sum(status = 'void') AS cancelled
     FROM bill WHERE day BETWEEN ? AND ? GROUP BY prefix ORDER BY prefix`,
    [r.from, r.to],
  );

  return {
    b2b: csv(['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'], b2b),
    b2cl: csv(['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], b2cl),
    b2cs: csv(['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], b2csRows),
    hsn_b2b: hsnCsv(groups.b2b),
    hsn_b2c: hsnCsv(groups.b2c),
    docs: csv(['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      series.map((s) => ['Invoices for outward supply', s.first, s.last, s.total, s.cancelled])),
    counts: { b2b: b2b.length, b2cl: b2cl.length, b2cs: b2csRows.length, hsn_b2b: groups.b2b.size, hsn_b2c: groups.b2c.size, docs: series.length },
  };
}
