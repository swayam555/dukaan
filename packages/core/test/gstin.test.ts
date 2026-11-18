import { gstinCheckChar, isValidGstin, stateFromGstin } from '../src/gstin';

describe('GSTIN', () => {
  it('accepts GSTINs with a correct check digit', () => {
    // Check digit computed independently with the published GSTN algorithm.
    const base = '27AAPFU0939F1Z';
    const full = base + gstinCheckChar(base);
    expect(isValidGstin(full)).toBe(true);
    expect(isValidGstin(full.toLowerCase())).toBe(true);
    expect(stateFromGstin(full)).toBe('27');
  });

  it('rejects a wrong check digit, bad shape or unknown state', () => {
    const base = '29ABCDE1234F1Z';
    const good = base + gstinCheckChar(base);
    const wrong = base + (good.endsWith('A') ? 'B' : 'A');
    expect(isValidGstin(wrong)).toBe(false);
    expect(isValidGstin('27ABCDE1234F1Y5')).toBe(false);
    expect(isValidGstin('99ABCDE1234F1Z5')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });

  it('matches the canonical GSTN example 27AAPFU0939F1ZV', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
  });
});
