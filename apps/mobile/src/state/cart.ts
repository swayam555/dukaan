import { create } from 'zustand';
import { addItem, EMPTY_CART, removeLine, updateLine, type CartLine, type CartState, type CatalogueItem, type Discount } from '@dukaan/core';

type CartStore = CartState & {
  add: (item: CatalogueItem, qtyMilli?: number) => void;
  update: (key: string, patch: Partial<Pick<CartLine, 'qtyMilli' | 'unitPaise' | 'discount'>>) => void;
  remove: (key: string) => void;
  setBillDiscount: (d: Discount | null) => void;
  setCustomer: (id: string | null) => void;
  load: (cart: CartState) => void;
  clear: () => void;
};

export const useCart = create<CartStore>((set) => ({
  ...EMPTY_CART,
  add: (item, qty) => set((s) => addItem(s, item, qty)),
  update: (key, patch) => set((s) => updateLine(s, key, patch)),
  remove: (key) => set((s) => removeLine(s, key)),
  setBillDiscount: (billDiscount) => set({ billDiscount }),
  setCustomer: (customerId) => set({ customerId }),
  load: (cart) => set({ ...EMPTY_CART, ...cart }),
  clear: () => set(EMPTY_CART),
}));
