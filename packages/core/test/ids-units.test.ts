import fc from 'fast-check';
import { uuidv7, uuidv7Timestamp } from '../src/ids';
import { convert, formatQuantity, lineAmount, parseQuantity } from '../src/units';

describe('uuidv7', () => {
  it('has version 7 / variant 10 and embeds the timestamp', () => {
    const id = uuidv7(1_700_000_000_123);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7Timestamp(id)).toBe(1_700_000_000_123);
  });

  it('is strictly increasing within the same millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7(1_800_000_000_000));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('units', () => {
  it('converts between compatible units', () => {
    expect(convert(250, 'g', 'kg')).toBe(0); // 0.25 g is below 1 milli-kg
    expect(convert(250_000, 'g', 'kg')).toBe(250); // 250 g = 0.25 kg = 250 milli-kg
    expect(convert(1500, 'l', 'ml')).toBe(1_500_000);
    expect(() => convert(1000, 'kg', 'l')).toThrow();
    expect(() => convert(1000, 'pcs', 'pack')).toThrow();
  });

  it('parses keypad quantities into base-unit milli', () => {
    expect(parseQuantity('1.25', 'kg')).toBe(1250);
    expect(parseQuantity('250g', 'kg')).toBe(250);
    expect(parseQuantity('2', 'pcs')).toBe(2000);
    expect(parseQuantity('0.5 l', 'ml')).toBe(500_000);
    expect(() => parseQuantity('1.2345', 'kg')).toThrow();
  });

  it('kg→g→kg round-trips exactly', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e9 }), (q) => convert(convert(q, 'kg', 'g'), 'g', 'kg') === q));
  });

  it('computes line amounts in paise with half-up rounding', () => {
    expect(lineAmount(6000, 1250)).toBe(7500); // ₹60/kg × 1.25 kg
    expect(lineAmount(9999, 333)).toBe(3330); // 3329.667 → 3330
    expect(formatQuantity(1250, 'kg')).toBe('1.25 kg');
    expect(formatQuantity(3000, 'pcs')).toBe('3 pcs');
  });
});
