import type { Discount, LineInput } from './gst';
import { isLoose, type Milli } from './units';

export type CartLine = LineInput & { key: string };
export type CartState = { lines: CartLine[]; billDiscount: Discount | null; customerId: string | null };

export const EMPTY_CART: CartState = { lines: [], billDiscount: null, customerId: null };

export type CatalogueItem = {
  id: string; name: string; hsn: string; unit: LineInput['unit']; sale_paise: number; mrp_paise: number; gst_bp: number;
  cess_bp: number; price_incl_tax: number; cost_paise: number;
};

/**
 * Scanning/tapping a packaged item again bumps its quantity (one line per item, newest on top).
 * Loose items always open a new line, since each weighing is its own entry.
 */
export function addItem(cart: CartState, item: CatalogueItem, qtyMilli?: Milli): CartState {
  const loose = isLoose(item.unit);
  const qty = qtyMilli ?? (loose ? 0 : 1000);
  if (!loose) {
    const existing = cart.lines.find((l) => l.itemId === item.id && !l.discount);
    if (existing) {
      const bumped = { ...existing, qtyMilli: existing.qtyMilli + qty };
      return { ...cart, lines: [bumped, ...cart.lines.filter((l) => l !== existing)] };
    }
  }
  const line: CartLine = {
    key: `${item.id}:${Date.now().toString(36)}:${cart.lines.length}`,
    itemId: item.id, name: item.name, hsn: item.hsn, unit: item.unit, qtyMilli: qty, unitPaise: item.sale_paise,
    mrpPaise: item.mrp_paise, gstBp: item.gst_bp, cessBp: item.cess_bp, priceInclTax: item.price_incl_tax !== 0,
    costPaise: item.cost_paise, discount: null,
  };
  return { ...cart, lines: [line, ...cart.lines] };
}

export function updateLine(cart: CartState, key: string, patch: Partial<Pick<CartLine, 'qtyMilli' | 'unitPaise' | 'discount'>>): CartState {
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) };
}

export function removeLine(cart: CartState, key: string): CartState {
  return { ...cart, lines: cart.lines.filter((l) => l.key !== key) };
}

/** Lines with zero quantity (a loose item added but never weighed) block checkout. */
export function cartProblems(cart: CartState): string[] {
  return cart.lines.filter((l) => l.qtyMilli <= 0).map((l) => `${l.name}: enter quantity`);
}

/** NPCI UPI deep link for an exact amount. `pa` keeps its '@' — some apps reject %40. */
export function upiUri(p: { vpa: string; payee: string; amountPaise: number; note: string; ref?: string }): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  const amount = (p.amountPaise / 100).toFixed(2);
  const parts = [`pa=${p.vpa.trim()}`, `pn=${enc(p.payee)}`, `am=${amount}`, 'cu=INR', `tn=${enc(p.note)}`];
  if (p.ref) parts.push(`tr=${enc(p.ref)}`);
  return `upi://pay?${parts.join('&')}`;
}

export function isValidVpa(vpa: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(vpa.trim());
}
