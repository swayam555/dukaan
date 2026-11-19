import { computeBill } from '@dukaan/core';
import { createShop, saveBill, type Cart } from '@dukaan/db';
import { getDb } from '@/lib/db';
import { getWriter, resetWriter } from '@/lib/writer';
import { useSession } from '@/state/session';

/** Same catalogue as test/setup.ts (salt ₹28 0%, rice ₹120/kg 5%, soap ₹45 18%; prices GST-inclusive). */
const ITEMS = {
  salt: { name: 'Tata Salt 1kg', hsn: '2501', unit: 'pcs', unitPaise: 2800, gstBp: 0, costPaise: 2300 },
  rice: { name: 'Basmati Rice (Loose)', hsn: '1006', unit: 'kg', unitPaise: 12000, gstBp: 500, costPaise: 9800 },
  soap: { name: 'Lux Soap 100g', hsn: '3401', unit: 'pcs', unitPaise: 4500, gstBp: 1800, costPaise: 3600 },
} as const;

export const cartLine = (itemId: keyof typeof ITEMS, qtyMilli: number) => {
  const i = ITEMS[itemId];
  return { itemId, name: i.name, hsn: i.hsn, unit: i.unit, qtyMilli, unitPaise: i.unitPaise, mrpPaise: i.unitPaise, gstBp: i.gstBp, costPaise: i.costPaise } as Cart['lines'][number];
};

/** Fresh DB + shop + device for each test. */
export async function freshShop(role: 'owner' | 'cashier' = 'owner', extra: { upiVpa?: string } = {}) {
  (jest.requireMock('@/lib/db') as { __resetDb: () => void }).__resetDb();
  resetWriter();
  const { shop, device } = await createShop(await getDb(), {
    name: 'Sharma Kirana', gstin: '', stateCode: '27', address: 'MG Road', phone: '', upiVpa: extra.upiVpa ?? '', pharmacyMode: false, invoiceFooter: '',
    prefix: 'A', pinHash: 'x', pinLength: 4, deviceName: 'Owner',
  });
  useSession.getState().set({ status: 'ready', shop: { ...shop }, device: { id: device.id, prefix: 'A', role } });
}

export async function sell(lines: Cart['lines'], o: { customerId?: string; mode?: 'cash' | 'upi' | 'credit'; now?: number } = {}) {
  const cart: Cart = { lines, billDiscount: null, customerId: o.customerId ?? null, interstate: false, placeOfSupply: '27' };
  const total = computeBill({ lines, interstate: false, billDiscount: null }).total;
  return saveBill(await getDb(), await getWriter(), 'A', { cart, payments: [{ mode: o.mode ?? 'cash', amountPaise: total, ref: '' }], cashier: 'o', now: o.now });
}
