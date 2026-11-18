import type { Unit } from '@dukaan/core';
import { BRANDS, CATEGORIES, VARIANTS, FIRST_NAMES, LAST_NAMES, type Category } from './catalog-data';

export type SeedItem = {
  id: string;
  name: string;
  nameHi: string;
  barcode: string | null;
  hsn: string;
  category: string;
  unit: Unit;
  mrpPaise: number;
  salePaise: number;
  costPaise: number;
  gstBp: number;
  lowStockMilli: number;
  openingStockMilli: number;
  trackBatches: boolean;
};

export type SeedCustomer = { id: string; name: string; phone: string };

/** mulberry32: tiny deterministic PRNG so the same seed always produces the same shop. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytesFrom(rand: () => number) {
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.floor(rand() * 256);
    return out;
  };
}

/** Deterministic UUIDv7-shaped id: fixed timestamp base + counter, random tail from the PRNG. */
export function seededId(rand: () => number, n: number, baseMs = 1_767_225_600_000): string {
  const ms = baseMs + n;
  const hex = ms.toString(16).padStart(12, '0');
  const tail = Array.from({ length: 10 }, () => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${tail.slice(0, 3)}-${((parseInt(tail[3]!, 16) & 0x3) | 0x8).toString(16)}${tail.slice(4, 7)}-${tail.slice(7, 19).padEnd(12, '0')}`;
}

export function ean13(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return body12 + String((10 - (sum % 10)) % 10);
}

const pick = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

function brandsFor(category: Category, rand: () => number): string[] {
  const n = 10 + Math.floor(rand() * 6);
  const pool = [...BRANDS];
  const out: string[] = ['Local'];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return category.pharmacy ? out.filter((b) => b !== 'Local') : out;
}

function* combinations(rand: () => number): Generator<{ category: Category; brand: string; product: readonly [string, string]; variant: string; size: readonly [string, number] }> {
  const perCategory = CATEGORIES.map((category) => ({ category, brands: brandsFor(category, rand) }));
  // Round-robin across categories so any prefix of the stream has a realistic category mix.
  const iters = perCategory.map(({ category, brands }) => (function* () {
    for (const variant of VARIANTS) for (const brand of brands) for (const product of category.products) for (const size of category.sizes) yield { category, brand, product, variant, size };
  })());
  let alive = iters.length;
  while (alive > 0) {
    alive = 0;
    for (const it of iters) {
      const next = it.next();
      if (!next.done) {
        alive += 1;
        yield next.value;
      }
    }
  }
}

export function generateItems(count: number, seed = 42): SeedItem[] {
  const rand = prng(seed);
  const items: SeedItem[] = [];
  const looseDone = new Set<string>();
  for (const c of combinations(rand)) {
    if (items.length >= count) break;
    const { category, brand, product, variant, size } = c;
    const n = items.length;
    const [lo, hi] = category.price;
    const perUnitRupees = lo + rand() * (hi - lo);
    const isMassOrVolume = category.unit === 'kg' || category.unit === 'l';
    // Loose (sold by weight) SKU once per product, from the shop's own stock.
    if (category.loose && brand === 'Local' && !looseDone.has(product[0])) {
      looseDone.add(product[0]);
      const sale = Math.round(perUnitRupees) * 100;
      items.push({
        id: seededId(rand, n), name: `${product[0]} (Loose)`, nameHi: `${product[1]} खुला`, barcode: null, hsn: category.hsn,
        category: category.name, unit: category.unit, mrpPaise: sale, salePaise: sale, costPaise: Math.round(sale * 0.86),
        gstBp: category.gstBp, lowStockMilli: 5000, openingStockMilli: 25000 + Math.floor(rand() * 50) * 1000, trackBatches: false,
      });
      continue;
    }
    const factor = isMassOrVolume ? size[1] / 1000 : 1;
    const mrp = Math.max(5, Math.round(perUnitRupees * factor)) * 100;
    const sale = rand() < 0.35 ? Math.round((mrp * (0.9 + rand() * 0.08)) / 100) * 100 : mrp;
    const name = [brand === 'Local' ? '' : brand, product[0], variant, size[0]].filter(Boolean).join(' ');
    items.push({
      id: seededId(rand, n),
      name,
      nameHi: [product[1], size[0]].join(' '),
      barcode: brand === 'Local' ? null : ean13(`890${String(1_000_000_000 + n).slice(1)}`),
      hsn: category.hsn,
      category: category.name,
      unit: 'pcs',
      mrpPaise: mrp,
      salePaise: sale,
      costPaise: Math.round(sale * (0.78 + rand() * 0.12)),
      gstBp: category.gstBp,
      lowStockMilli: (2 + Math.floor(rand() * 8)) * 1000,
      openingStockMilli: Math.floor(rand() * 60) * 1000,
      trackBatches: !!category.pharmacy,
    });
  }
  if (items.length < count) throw new Error(`catalogue space exhausted at ${items.length}`);
  return items;
}

export function generateCustomers(count: number, seed = 7): SeedCustomer[] {
  const rand = prng(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: seededId(rand, 10_000_000 + i),
    name: `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`,
    phone: `9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`,
  }));
}
