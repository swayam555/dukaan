import { hashPin, isValidPin, lockoutMs, verifyPin } from '../src/pin';

const salt = new Uint8Array(16).fill(7);

describe('pin', () => {
  it('verifies the right PIN and rejects others', () => {
    const stored = hashPin('2468', salt, 1000);
    expect(verifyPin('2468', stored)).toBe(true);
    expect(verifyPin('2469', stored)).toBe(false);
    expect(verifyPin('', stored)).toBe(false);
    expect(verifyPin('2468', 'garbage')).toBe(false);
  });

  it('validates PIN shape', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(() => hashPin('12', salt)).toThrow();
  });

  it('locks out exponentially after 5 failures', () => {
    expect(lockoutMs(4)).toBe(0);
    expect(lockoutMs(5)).toBe(30_000);
    expect(lockoutMs(7)).toBe(120_000);
    expect(lockoutMs(50)).toBe(3_600_000);
  });
});
