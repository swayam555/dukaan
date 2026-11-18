import fc from 'fast-check';
import { computeBill, financialYear, isInterstate, type Discount, type LineInput } from '../src/gst';

fc.configureGlobal({ numRuns: 1000 });

const RATES = [0, 500, 1800, 4000, 300, 1200, 2800];

const discountArb: fc.Arbitrary<Discount | null> = fc.oneof(
  fc.constant(null),
  fc.record({ kind: fc.constant('pct' as const), bp: fc.integer({ min: 0, max: 10_000 }) }),
  fc.record({ kind: fc.constant('amt' as const), paise: fc.integer({ min: 0, max: 50_000 }) }),
);

const lineArb: fc.Arbitrary<LineInput> = fc.record({
  itemId: fc.uuid(),
  name: fc.constant('x'),
  hsn: fc.constant('1006'),
  unit: fc.constantFrom('pcs' as const, 'kg' as const),
  qtyMilli: fc.integer({ min: 1, max: 50_000 }),
  unitPaise: fc.integer({ min: 0, max: 500_000 }),
  mrpPaise: fc.constant(0),
  gstBp: fc.constantFrom(...RATES),
  cessBp: fc.constantFrom(0, 0, 0, 1200),
  priceInclTax: fc.boolean(),
  discount: discountArb,
  costPaise: fc.integer({ min: 0, max: 400_000 }),
});

const billArb = fc.record({
  lines: fc.array(lineArb, { minLength: 1, maxLength: 25 }),
  interstate: fc.boolean(),
  billDiscount: discountArb,
  roundOff: fc.boolean(),
});

describe('GST engine (property-based)', () => {
  it('every line adds up exactly: taxable + CGST + SGST + IGST + cess = net', () => {
    fc.assert(fc.property(billArb, (bill) => computeBill(bill).lines.every((l) => l.taxable + l.cgst + l.sgst + l.igst + l.cess === l.net)));
  });

  it('bill total = Σ line nets + round-off, and rounds to whole rupees', () => {
    fc.assert(fc.property(billArb, (bill) => {
      const t = computeBill(bill);
      const sumNet = t.lines.reduce((s, l) => s + l.net, 0);
      if (t.total !== sumNet + t.roundOff) return false;
      return bill.roundOff === false ? t.roundOff === 0 : t.total % 100 === 0 && Math.abs(t.roundOff) <= 50;
    }));
  });

  it('intra-state splits CGST/SGST evenly (±1 paisa); inter-state uses IGST only', () => {
    fc.assert(fc.property(billArb, (bill) => computeBill(bill).lines.every((l) =>
      bill.interstate ? l.cgst === 0 && l.sgst === 0 : l.igst === 0 && (l.cgst - l.sgst === 0 || l.cgst - l.sgst === 1))));
  });

  it('tax matches the rate on the taxable value within 1 paisa', () => {
    fc.assert(fc.property(billArb, (bill) => computeBill(bill).lines.every((l, i) => {
      const line = bill.lines[i]!;
      const expected = (l.taxable * (line.gstBp + (line.cessBp ?? 0))) / 10_000;
      return Math.abs(l.cgst + l.sgst + l.igst + l.cess - expected) <= 1;
    })));
  });

  it('discounts never exceed the amount and never make a line negative', () => {
    fc.assert(fc.property(billArb, (bill) => {
      const t = computeBill(bill);
      return t.lines.every((l) => l.lineDiscount + l.billDiscount <= l.gross && l.net >= 0 && l.taxable >= 0) && t.discount <= t.gross;
    }));
  });

  it('inclusive prices: the customer pays exactly the shelf price minus discounts', () => {
    fc.assert(fc.property(billArb, (bill) => {
      const inclusive = { ...bill, lines: bill.lines.map((l) => ({ ...l, priceInclTax: true })) };
      const t = computeBill(inclusive);
      return t.lines.every((l) => l.net === l.gross - l.lineDiscount - l.billDiscount);
    }));
  });

  it('line order does not change the totals', () => {
    fc.assert(fc.property(billArb, (bill) => {
      const a = computeBill(bill);
      const b = computeBill({ ...bill, lines: [...bill.lines].reverse() });
      return a.total === b.total && a.taxable === b.taxable && a.cgst + a.sgst + a.igst === b.cgst + b.sgst + b.igst;
    }));
  });

  it('rate summary reconciles with the bill totals', () => {
    fc.assert(fc.property(billArb, (bill) => {
      const t = computeBill(bill);
      const s = t.byRate.reduce((acc, r) => ({ taxable: acc.taxable + r.taxable, tax: acc.tax + r.cgst + r.sgst + r.igst + r.cess }), { taxable: 0, tax: 0 });
      return s.taxable === t.taxable && s.tax === t.cgst + t.sgst + t.igst + t.cess;
    }));
  });
});

describe('GST engine (worked examples)', () => {
  const base = { itemId: 'a', name: 'Tata Salt 1kg', hsn: '2501', unit: 'pcs' as const, mrpPaise: 2800 };

  it('₹118 inclusive at 18% → ₹100 taxable + ₹9 CGST + ₹9 SGST', () => {
    const t = computeBill({ lines: [{ ...base, qtyMilli: 1000, unitPaise: 11800, gstBp: 1800 }], interstate: false });
    expect(t.lines[0]).toMatchObject({ taxable: 10000, cgst: 900, sgst: 900, igst: 0, net: 11800 });
    expect(t.total).toBe(11800);
  });

  it('loose 1.25 kg at ₹60/kg (5% GST) with a 10% bill discount', () => {
    const t = computeBill({ lines: [{ ...base, unit: 'kg', qtyMilli: 1250, unitPaise: 6000, gstBp: 500 }], interstate: false, billDiscount: { kind: 'pct', bp: 1000 } });
    expect(t.gross).toBe(7500);
    expect(t.discount).toBe(750);
    expect(t.lines[0]!.taxable).toBe(6429); // 6750 / 1.05 = 6428.57
    expect(t.lines[0]!.cgst + t.lines[0]!.sgst).toBe(321);
    expect(t.total).toBe(6800); // ₹67.50 rounds up to ₹68
    expect(t.roundOff).toBe(50);
  });

  it('exclusive (B2B) pricing at 18% IGST', () => {
    const t = computeBill({ lines: [{ ...base, qtyMilli: 3000, unitPaise: 10000, gstBp: 1800, priceInclTax: false }], interstate: true, roundOff: false });
    expect(t.lines[0]).toMatchObject({ taxable: 30000, igst: 5400, net: 35400 });
  });

  it('40% slab for sin goods and 0% for milk', () => {
    const t = computeBill({ lines: [
      { ...base, qtyMilli: 1000, unitPaise: 14000, gstBp: 4000 },
      { ...base, itemId: 'b', qtyMilli: 2000, unitPaise: 3000, gstBp: 0 },
    ], interstate: false });
    expect(t.lines[0]!.taxable).toBe(10000);
    expect(t.lines[1]).toMatchObject({ taxable: 6000, cgst: 0, sgst: 0 });
    expect(t.byRate.map((r) => r.gstBp)).toEqual([0, 4000]);
  });

  it('place of supply and financial year', () => {
    expect(isInterstate('27')).toBe(false);
    expect(isInterstate('27', { stateCode: '29' })).toBe(false);
    expect(isInterstate('27', { stateCode: '29', deliverOutOfState: true })).toBe(true);
    expect(financialYear(new Date(2026, 10, 18))).toBe('2026-27');
    expect(financialYear(new Date(2027, 2, 31))).toBe('2026-27');
    expect(financialYear(new Date(2027, 3, 1))).toBe('2027-28');
  });
});
