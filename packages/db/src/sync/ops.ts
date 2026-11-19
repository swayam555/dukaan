import type { Discount } from '@dukaan/core';
import type { ItemInput } from '../repos/items';

export type Role = 'owner' | 'cashier';

export type Entity = 'item' | 'stock' | 'bill' | 'customer' | 'supplier' | 'ledger' | 'purchase' | 'batch';

export type ItemFields = Partial<{
  name: string; nameHi: string; barcode: string | null; hsn: string; category: string; unit: string; mrpPaise: number;
  salePaise: number; costPaise: number; gstBp: number; cessBp: number; priceInclTax: boolean; trackBatches: boolean;
  lowStockMilli: number; deleted: boolean;
}>;

export type CustomerFields = Partial<{ name: string; phone: string; gstin: string; stateCode: string; address: string; creditLimitPaise: number; deleted: boolean }>;
export type SupplierFields = Partial<{ name: string; phone: string; gstin: string; stateCode: string; deleted: boolean }>;

export type BillLinePayload = {
  itemId: string; batchId: string; name: string; hsn: string; unit: string; qtyMilli: number; unitPaise: number; mrpPaise: number;
  discountPaise: number; taxablePaise: number; gstBp: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
  cessPaise: number; totalPaise: number; costPaise: number;
};
export type PaymentPayload = { mode: 'cash' | 'upi' | 'card' | 'credit'; amountPaise: number; ref: string };

export type BillPayload = {
  id: string; localNo: string; createdAt: number; day: string; customerId: string | null; placeOfSupply: string; interstate: boolean;
  grossPaise: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
  cessPaise: number; roundOffPaise: number; totalPaise: number; costPaise: number; cashier: string;
  billDiscount: Discount | null; lines: BillLinePayload[]; payments: PaymentPayload[];
};

export type PurchasePayload = {
  id: string; supplierId: string | null; invoiceNo: string; createdAt: number; day: string; totalPaise: number; taxPaise: number;
  lines: { itemId: string; batchId: string; qtyMilli: number; costPaise: number; gstBp: number }[];
};

export type OpBody =
  | { type: 'item.upsert'; entity: 'item'; payload: ItemFields }
  /** CSV import batch: whole rows under one clock (item.base_hlc) plus opening stock. entityId = batch id. */
  | { type: 'item.bulk'; entity: 'item'; payload: { items: ItemInput[]; stock: { itemId: string; deltaMilli: number }[] } }
  | { type: 'customer.upsert'; entity: 'customer'; payload: CustomerFields }
  | { type: 'supplier.upsert'; entity: 'supplier'; payload: SupplierFields }
  | { type: 'batch.upsert'; entity: 'batch'; payload: { itemId: string; batchNo: string; expiry: string | null; mrpPaise: number; costPaise: number } }
  | { type: 'stock.adjust'; entity: 'stock'; payload: { itemId: string; batchId: string; deltaMilli: number; reason: string; note: string; createdAt: number } }
  | { type: 'bill.create'; entity: 'bill'; payload: BillPayload }
  | { type: 'bill.void'; entity: 'bill'; payload: { reason: string; at: number } }
  | { type: 'bill.number'; entity: 'bill'; payload: { globalNo: number; fy: string } }
  | { type: 'ledger.add'; entity: 'ledger'; payload: { id: string; customerId: string; amountPaise: number; kind: string; note: string; mode: string; createdAt: number; billId: string | null } }
  | { type: 'purchase.create'; entity: 'purchase'; payload: PurchasePayload };

export type OpType = OpBody['type'];

export type Op = OpBody & {
  opId: string;
  shopId: string;
  deviceId: string;
  entityId: string;
  hlc: string;
  role: Role;
};

/** Op types only an owner device may author (also enforced server-side). */
export const OWNER_ONLY: ReadonlySet<OpType> = new Set(['bill.void', 'stock.adjust', 'purchase.create', 'supplier.upsert', 'item.bulk']);

/** Item fields that move money (price, cost, tax) or remove the item: owner only. A cashier may still fix a name or link a barcode. */
export const OWNER_ITEM_FIELDS: readonly string[] = ['mrpPaise', 'salePaise', 'costPaise', 'gstBp', 'cessBp', 'priceInclTax', 'deleted'];
/** Ledger kinds that create or erase a debt without a bill or a payment: owner only. */
export const OWNER_LEDGER_KINDS: readonly string[] = ['opening', 'adjust'];

/**
 * The one role rule, used when an op is authored (writer), pulled (engine) and pushed (server, same rule in Java).
 * Returns why the op is not allowed for its role, or null.
 */
export function roleViolation(op: { type: string; role: string; payload: unknown }): string | null {
  if (op.role === 'owner') return null;
  if (OWNER_ONLY.has(op.type as OpType)) return `${op.type} needs the owner role`;
  const p = (op.payload ?? {}) as Record<string, unknown>;
  if (op.type === 'item.upsert') {
    const f = OWNER_ITEM_FIELDS.find((k) => k in p);
    if (f) return `changing item ${f} needs the owner role`;
  }
  if (op.type === 'ledger.add' && OWNER_LEDGER_KINDS.includes(String(p.kind))) return `ledger ${String(p.kind)} needs the owner role`;
  return null;
}

export const KNOWN_TYPES: ReadonlySet<string> = new Set<OpType>([
  'item.upsert', 'item.bulk', 'customer.upsert', 'supplier.upsert', 'batch.upsert', 'stock.adjust', 'bill.create', 'bill.void', 'bill.number', 'ledger.add', 'purchase.create',
]);
