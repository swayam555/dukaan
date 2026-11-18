export type Paise = number;

export function assertPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) throw new RangeError(`paise must be a safe integer, got ${value}`);
  return value;
}

/** Parses "12", "12.5", "12.50", "₹1,234.05" into paise. Rejects more than 2 decimals. */
export function parseRupees(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new RangeError(`not a rupee amount: "${input}"`);
  const [, sign, whole, frac = ''] = match;
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return assertPaise(sign ? -paise : paise);
}

export function formatRupees(paise: Paise, opts: { symbol?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const body = `${groupIndian(rupees)}.${frac}`;
  return `${negative ? '-' : ''}${opts.symbol === false ? '' : '₹'}${body}`;
}

/** Indian digit grouping: 12,34,567 */
export function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Integer division with round-half-up away from zero (the convention GST invoices use
 * for paise). Works on safe integers only.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const q = Math.floor(abs / denominator);
  const r = abs - q * denominator;
  return sign * (r * 2 >= denominator ? q + 1 : q);
}

/** Rounds paise to the nearest whole rupee (half-up); returns { rounded, roundOff }. */
export function roundToRupee(paise: Paise): { rounded: Paise; roundOff: Paise } {
  const rounded = divRoundHalfUp(paise, 100) * 100;
  return { rounded, roundOff: rounded - paise };
}

/** Splits `total` across `weights` so the parts sum exactly to total (largest-remainder method). */
export function allocate(total: Paise, weights: readonly number[]): Paise[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}
