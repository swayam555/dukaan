/**
 * Camera scan helpers. A camera reports the same barcode on every frame it is visible (~30/s), and
 * cheap phone cameras occasionally misread a digit. The gate turns a stream of frame reads into
 * discrete "scans"; the GTIN check digit throws away misreads before they hit the database.
 */

/** GS1 mod-10 check digit for EAN-8, UPC-A (12), EAN-13 and GTIN-14. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  let sum = 0;
  // Weights alternate 3,1,3,... starting from the digit just left of the check digit.
  for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += (code.charCodeAt(i) - 48) * w;
  return (10 - (sum % 10)) % 10 === code.charCodeAt(code.length - 1) - 48;
}

export type ScanGate = {
  /** True if this read should count as a new scan. */
  accept(code: string, nowMs: number): boolean;
  reset(): void;
};

/**
 * Accept a code once, then ignore it while it stays in view. It counts again once it has been out of
 * view for `cooldownMs` (so scanning the same product twice in a row works: move it away, bring it back).
 * A different code is accepted immediately.
 */
export function createScanGate(cooldownMs = 1200): ScanGate {
  let last: string | null = null;
  let lastSeen = -Infinity;
  return {
    accept(code, now) {
      const repeat = code === last && now - lastSeen < cooldownMs;
      last = code;
      lastSeen = now;
      return !repeat;
    },
    reset() { last = null; lastSeen = -Infinity; },
  };
}
