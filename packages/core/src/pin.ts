import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/** Stored as "pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>". */
export type PinHash = string;

export const PIN_ITERATIONS = 60_000;
export const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string, salt: Uint8Array, iterations = PIN_ITERATIONS): PinHash {
  if (!isValidPin(pin)) throw new RangeError('PIN must be 4–6 digits');
  const hash = pbkdf2(sha256, pin, salt, { c: iterations, dkLen: 32 });
  return `pbkdf2-sha256$${iterations}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export function verifyPin(pin: string, stored: PinHash): boolean {
  const [scheme, iter, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iter || !saltHex || !hashHex || !isValidPin(pin)) return false;
  const candidate = pbkdf2(sha256, pin, hexToBytes(saltHex), { c: Number(iter), dkLen: 32 });
  const expected = hexToBytes(hashHex);
  let diff = candidate.length ^ expected.length;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i]! ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Exponential lockout after repeated failures: 30 s, 60 s, 120 s … capped at 1 h. */
export function lockoutMs(failedAttempts: number): number {
  if (failedAttempts < MAX_ATTEMPTS_BEFORE_LOCKOUT) return 0;
  return Math.min(30_000 * 2 ** (failedAttempts - MAX_ATTEMPTS_BEFORE_LOCKOUT), 3_600_000);
}
