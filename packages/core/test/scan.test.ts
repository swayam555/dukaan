import fc from 'fast-check';
import { createScanGate, isValidGtin } from '../src';

describe('isValidGtin', () => {
  it.each(['8901058851243', '8901030865237', '036000291452', '96385074', '00012345600012'])('accepts %s', (c) =>
    expect(isValidGtin(c)).toBe(true));
  it.each(['8901058851244', '12345', 'abc', '890105885124', ''])('rejects %s', (c) => expect(isValidGtin(c)).toBe(false));
  it('any single-digit change to a valid EAN-13 is caught', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 9 }), (pos, delta) => {
      const good = '8901058851243';
      const d = (Number(good[pos]) + delta) % 10;
      expect(isValidGtin(good.slice(0, pos) + d + good.slice(pos + 1))).toBe(false);
    }));
  });
});

describe('createScanGate', () => {
  it('counts a code once while it stays in view', () => {
    const g = createScanGate(1000);
    const reads = [0, 33, 66, 100, 500, 900, 1800].map((t) => g.accept('A', t));
    expect(reads).toEqual([true, false, false, false, false, false, false]);
  });
  it('counts it again after it leaves view for the cooldown', () => {
    const g = createScanGate(1000);
    expect(g.accept('A', 0)).toBe(true);
    expect(g.accept('A', 1500)).toBe(true);
  });
  it('a different code is accepted immediately, and switching back counts again', () => {
    const g = createScanGate(1000);
    expect([g.accept('A', 0), g.accept('B', 10), g.accept('A', 20)]).toEqual([true, true, true]);
  });
  it('reset forgets the last code', () => {
    const g = createScanGate(1000);
    g.accept('A', 0); g.reset();
    expect(g.accept('A', 10)).toBe(true);
  });
});
