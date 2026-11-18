import fc from 'fast-check';
import { allocate, divRoundHalfUp, formatRupees, groupIndian, parseRupees, roundToRupee } from '../src/money';

describe('money', () => {
  it('parses rupee strings into integer paise', () => {
    expect(parseRupees('12')).toBe(1200);
    expect(parseRupees('12.5')).toBe(1250);
    expect(parseRupees('₹1,234.05')).toBe(123405);
    expect(parseRupees('-0.01')).toBe(-1);
    expect(() => parseRupees('1.234')).toThrow();
    expect(() => parseRupees('abc')).toThrow();
  });

  it('formats with Indian grouping', () => {
    expect(groupIndian(1234567)).toBe('12,34,567');
    expect(groupIndian(999)).toBe('999');
    expect(formatRupees(123456789)).toBe('₹12,34,567.89');
    expect(formatRupees(-5)).toBe('-₹0.05');
  });

  it('parse ∘ format round-trips', () => {
    fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), (p) => parseRupees(formatRupees(p)) === p));
  });

  it('rounds half up away from zero', () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(-5, 10)).toBe(-1);
    expect(roundToRupee(1249)).toEqual({ rounded: 1200, roundOff: -49 });
    expect(roundToRupee(1250)).toEqual({ rounded: 1300, roundOff: 50 });
  });

  it('round-off is always within ±50 paise', () => {
    fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), (p) => {
      const { rounded, roundOff } = roundToRupee(p);
      return rounded % 100 === 0 && Math.abs(roundOff) <= 50 && rounded - roundOff === p;
    }));
  });

  it('allocate preserves the total exactly and stays proportional within 1 paisa', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1e9 }),
      fc.array(fc.integer({ min: 0, max: 1e6 }), { minLength: 1, maxLength: 20 }),
      (total, weights) => {
        const parts = allocate(total, weights);
        const sum = weights.reduce((a, b) => a + b, 0);
        if (parts.reduce((a, b) => a + b, 0) !== total) return false;
        if (sum === 0) return true;
        return parts.every((p, i) => Math.abs(p - (total * weights[i]!) / sum) < 1);
      },
    ));
  });
});
