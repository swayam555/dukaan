import { isValidGstin, uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import { getMeta, setMeta } from './meta';

import type { Role } from '../sync/ops';
export type { Role };
export type ShopProfile = { id: string; name: string; gstin: string; stateCode: string; address: string; phone: string; upiVpa: string; pharmacyMode: boolean; invoiceFooter: string };
export type DeviceIdentity = { id: string; shopId: string; prefix: string; role: Role; name: string };
export type LockSettings = { pinHash: string; pinLength: number; biometric: boolean; failedAttempts: number; lockedUntil: number };

export const META = { shop: 'shop', device: 'device', lock: 'lock', locale: 'locale' } as const;

export const getShop = (db: SqlExecutor) => getMeta<ShopProfile>(db, META.shop);
export const getDevice = (db: SqlExecutor) => getMeta<DeviceIdentity>(db, META.device);
export const getLock = (db: SqlExecutor) => getMeta<LockSettings>(db, META.lock);
export const saveLock = (db: SqlExecutor, lock: LockSettings) => setMeta(db, META.lock, lock);

export function validatePrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{0,3}$/.test(prefix);
}

export type CreateShopInput = Omit<ShopProfile, 'id'> & { prefix: string; pinHash: string; pinLength: number; deviceName: string };

/** First-run setup on the owner's device: shop profile, device identity and its bill series. */
export async function createShop(db: SqlDriver, input: CreateShopInput): Promise<{ shop: ShopProfile; device: DeviceIdentity }> {
  if (!input.name.trim()) throw new Error('shop name required');
  if (input.gstin && !isValidGstin(input.gstin)) throw new Error('invalid GSTIN');
  if (!validatePrefix(input.prefix)) throw new Error('prefix must be 1–4 capital letters/digits starting with a letter');
  const { prefix, pinHash, pinLength, deviceName, ...profile } = input;
  const shop: ShopProfile = { ...profile, gstin: profile.gstin.toUpperCase(), id: uuidv7() };
  const device: DeviceIdentity = { id: uuidv7(), shopId: shop.id, prefix, role: 'owner', name: deviceName };
  await db.transaction(async (tx) => {
    await setMeta(tx, META.shop, shop);
    await setMeta(tx, META.device, device);
    await setMeta(tx, META.lock, { pinHash, pinLength, biometric: false, failedAttempts: 0, lockedUntil: 0 } satisfies LockSettings);
    await tx.execute('INSERT OR IGNORE INTO bill_series(prefix, next_seq) VALUES (?, 1)', [prefix]);
  });
  return { shop, device };
}

export type JoinShopInput = {
  shop: { id: string; name: string; gstin: string; stateCode: string };
  device: { id: string; prefix: string; name: string };
  pinHash: string;
  pinLength: number;
};

/** A cashier phone joining an existing shop after a pairing claim: same shop id, its own device + bill series.
 *  The catalogue, stock and khata arrive through the first sync pull. */
export async function joinShop(db: SqlDriver, input: JoinShopInput): Promise<{ shop: ShopProfile; device: DeviceIdentity }> {
  if (!validatePrefix(input.device.prefix)) throw new Error('prefix must be 1–4 capital letters/digits starting with a letter');
  const shop: ShopProfile = { ...input.shop, address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '' };
  const device: DeviceIdentity = { ...input.device, shopId: shop.id, role: 'cashier' };
  await db.transaction(async (tx) => {
    await setMeta(tx, META.shop, shop);
    await setMeta(tx, META.device, device);
    await setMeta(tx, META.lock, { pinHash: input.pinHash, pinLength: input.pinLength, biometric: false, failedAttempts: 0, lockedUntil: 0 } satisfies LockSettings);
    await tx.execute('INSERT OR IGNORE INTO bill_series(prefix, next_seq) VALUES (?, 1)', [input.device.prefix]);
  });
  return { shop, device };
}

export type ShopPatch = Partial<Omit<ShopProfile, 'id' | 'stateCode'>>;

/** Owner edits the shop profile. State code is fixed at setup (it decides CGST/SGST vs IGST on every past bill). */
export async function updateShop(db: SqlExecutor, patch: ShopPatch): Promise<ShopProfile> {
  const cur = await getShop(db);
  if (!cur) throw new Error('shop not set up');
  const next: ShopProfile = { ...cur, ...patch, id: cur.id, stateCode: cur.stateCode };
  next.name = next.name.trim();
  next.gstin = next.gstin.trim().toUpperCase();
  next.upiVpa = next.upiVpa.trim();
  if (!next.name) throw new Error('shop name required');
  if (next.gstin && !isValidGstin(next.gstin)) throw new Error('invalid GSTIN');
  if (next.gstin && next.gstin.slice(0, 2) !== next.stateCode) throw new Error(`GSTIN state ${next.gstin.slice(0, 2)} does not match shop state ${next.stateCode}`);
  if (next.upiVpa && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(next.upiVpa)) throw new Error('invalid UPI ID');
  await setMeta(db, META.shop, next);
  return next;
}
