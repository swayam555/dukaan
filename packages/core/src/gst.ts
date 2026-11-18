import { allocate, divRoundHalfUp, roundToRupee, type Paise } from './money';
import type { Milli, Unit } from './units';
import { lineAmount } from './units';

/** GST 2.0 slabs (effective 22 Sep 2025) in basis points, plus special and legacy rates. */
export const GST_SLABS_BP = [0, 500, 1800, 4000] as const;
export const SPECIAL_RATES_BP = [25, 300] as const; // 0.25 % rough diamonds, 3 % gold/silver
export const LEGACY_RATES_BP = [1200, 2800] as const; // pre-Sep-2025 purchase bills only

export type Discount = { kind: 'pct'; bp: number } | { kind: 'amt'; paise: Paise };

export type LineInput = {
  itemId: string;
  name: string;
  hsn: string;
  unit: Unit;
  qtyMilli: Milli;
  /** Price per base unit. Tax-inclusive when `priceInclTax` (the kirana norm: MRP includes GST). */
  unitPaise: Paise;
  mrpPaise: Paise;
  gstBp: number;
  cessBp?: number;
  priceInclTax?: boolean;
  discount?: Discount | null;
  costPaise?: Paise;
  batchId?: string;
};

export type LineTax = {
  gross: Paise;
  lineDiscount: Paise;
  billDiscount: Paise;
  /** What the customer pays for this line (after all discounts, tax included). */
  net: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  cost: Paise;
};

export type BillInput = {
  lines: readonly LineInput[];
  interstate: boolean;
  billDiscount?: Discount | null;
  roundOff?: boolean;
};

export type RateSummary = { gstBp: number; taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise; cess: Paise };

export type BillTotals = {
  lines: LineTax[];
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  roundOff: Paise;
  total: Paise;
  cost: Paise;
  byRate: RateSummary[];
};

function discountAmount(base: Paise, d: Discount | null | undefined): Paise {
  if (!d || base <= 0) return 0;
  const raw = d.kind === 'pct' ? divRoundHalfUp(base * Math.min(Math.max(d.bp, 0), 10_000), 10_000) : Math.max(d.paise, 0);
  return Math.min(raw, base);
}

/**
 * Splits tax so that, per line, taxable + cgst + sgst + igst + cess === net exactly (the invoice always
 * adds up). Inclusive prices are back-calculated: taxable = net × 100 / (100 + rate), rounded half-up.
 * An odd paisa of intra-state GST goes to CGST.
 */
function splitTax(net: Paise, gstBp: number, cessBp: number, inclusive: boolean, interstate: boolean) {
  const rate = gstBp + cessBp;
  const taxable = inclusive ? divRoundHalfUp(net * 10_000, 10_000 + rate) : net;
  const totalTax = inclusive ? net - taxable : divRoundHalfUp(taxable * rate, 10_000);
  const cess = rate === 0 ? 0 : Math.min(totalTax, divRoundHalfUp(taxable * cessBp, 10_000));
  const gst = totalTax - cess;
  if (interstate) return { taxable, cgst: 0, sgst: 0, igst: gst, cess };
  const cgst = Math.ceil(gst / 2);
  return { taxable, cgst, sgst: gst - cgst, igst: 0, cess };
}

export function computeBill(input: BillInput): BillTotals {
  const grossAfterLine = input.lines.map((l) => {
    const gross = lineAmount(l.unitPaise, l.qtyMilli);
    const lineDiscount = discountAmount(gross, l.discount);
    return { gross, lineDiscount, afterLine: gross - lineDiscount };
  });
  const subtotal = grossAfterLine.reduce((s, x) => s + x.afterLine, 0);
  const billDiscountTotal = discountAmount(subtotal, input.billDiscount);
  const billShares = allocate(billDiscountTotal, grossAfterLine.map((x) => x.afterLine));

  const lines: LineTax[] = input.lines.map((l, i) => {
    const { gross, lineDiscount, afterLine } = grossAfterLine[i]!;
    const billDiscount = billShares[i] ?? 0;
    const discounted = afterLine - billDiscount;
    const inclusive = l.priceInclTax !== false;
    const t = splitTax(discounted, l.gstBp, l.cessBp ?? 0, inclusive, input.interstate);
    const net = t.taxable + t.cgst + t.sgst + t.igst + t.cess;
    return { gross, lineDiscount, billDiscount, net, ...t, cost: lineAmount(l.costPaise ?? 0, l.qtyMilli) };
  });

  const sum = (k: keyof LineTax) => lines.reduce((s, l) => s + l[k], 0);
  const beforeRound = sum('net');
  const { rounded, roundOff } = input.roundOff === false ? { rounded: beforeRound, roundOff: 0 } : roundToRupee(beforeRound);

  const byRateMap = new Map<number, RateSummary>();
  input.lines.forEach((l, i) => {
    const t = lines[i]!;
    const r = byRateMap.get(l.gstBp) ?? { gstBp: l.gstBp, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
    r.taxable += t.taxable;
    r.cgst += t.cgst;
    r.sgst += t.sgst;
    r.igst += t.igst;
    r.cess += t.cess;
    byRateMap.set(l.gstBp, r);
  });

  return {
    lines,
    gross: sum('gross'),
    discount: sum('lineDiscount') + sum('billDiscount'),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    cess: sum('cess'),
    roundOff,
    total: rounded,
    cost: sum('cost'),
    byRate: [...byRateMap.values()].sort((a, b) => a.gstBp - b.gstBp),
  };
}

/**
 * Place of supply for goods sold over the counter is the shop's state (intra-state → CGST+SGST).
 * Only a registered buyer in another state with delivery there makes it inter-state (IGST).
 */
export function isInterstate(shopState: string, buyer?: { stateCode?: string; deliverOutOfState?: boolean }): boolean {
  if (!buyer?.stateCode || !buyer.deliverOutOfState) return false;
  return buyer.stateCode !== shopState;
}

/** Indian financial year label for a date, e.g. 2026-11-18 → "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getFullYear();
  const start = date.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
