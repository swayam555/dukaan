/** Quantities are integer milli-units of the item's base unit: 1 pcs = 1000, 1 kg = 1000, 250 g = 250 (of g). */
export type Milli = number;

export type Unit = 'pcs' | 'pack' | 'kg' | 'g' | 'l' | 'ml';

export const UNITS: readonly Unit[] = ['pcs', 'pack', 'kg', 'g', 'l', 'ml'];

type Dimension = 'count' | 'mass' | 'volume';

const DIMENSION: Record<Unit, Dimension> = { pcs: 'count', pack: 'count', kg: 'mass', g: 'mass', l: 'volume', ml: 'volume' };
/** grams per unit for mass, millilitres per unit for volume. */
const FACTOR: Record<Unit, number> = { pcs: 1, pack: 1, kg: 1000, g: 1, l: 1000, ml: 1 };

export function isLoose(unit: Unit): boolean {
  return DIMENSION[unit] !== 'count';
}

export function canConvert(from: Unit, to: Unit): boolean {
  return DIMENSION[from] === DIMENSION[to] && !(DIMENSION[from] === 'count' && from !== to);
}

/** Converts milli-quantity between compatible units, rounding half-up to the nearest milli. */
export function convert(qty: Milli, from: Unit, to: Unit): Milli {
  if (from === to) return qty;
  if (!canConvert(from, to)) throw new RangeError(`cannot convert ${from} to ${to}`);
  const num = qty * FACTOR[from];
  const den = FACTOR[to];
  const q = Math.floor(Math.abs(num) / den);
  const r = Math.abs(num) - q * den;
  return Math.sign(num) * (r * 2 >= den ? q + 1 : q);
}

/** Parses keypad input like "1.25", "250g", "0.5 kg" into milli of `baseUnit`. */
export function parseQuantity(input: string, baseUnit: Unit): Milli {
  const match = /^\s*(\d+)(?:\.(\d{1,3}))?\s*([a-z]*)\s*$/i.exec(input);
  if (!match) throw new RangeError(`not a quantity: "${input}"`);
  const [, whole, frac = '', unitRaw = ''] = match;
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  const unit = (unitRaw.toLowerCase() || baseUnit) as Unit;
  if (!UNITS.includes(unit)) throw new RangeError(`unknown unit "${unitRaw}"`);
  return convert(milli, unit, baseUnit);
}

export function formatQuantity(qty: Milli, unit: Unit): string {
  if (!isLoose(unit) && qty % 1000 === 0) return `${qty / 1000} ${unit}`;
  const whole = Math.trunc(qty / 1000);
  const frac = String(Math.abs(qty % 1000)).padStart(3, '0').replace(/0+$/, '');
  return `${qty < 0 && whole === 0 ? '-' : ''}${whole}${frac ? `.${frac}` : ''} ${unit}`;
}

/** price per base unit × milli quantity → paise, half-up. */
export function lineAmount(unitPricePaise: number, qty: Milli): number {
  const num = unitPricePaise * qty;
  const q = Math.floor(Math.abs(num) / 1000);
  const r = Math.abs(num) - q * 1000;
  return Math.sign(num) * (r * 2 >= 1000 ? q + 1 : q);
}
