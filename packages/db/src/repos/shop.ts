import { isValidGstin, uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import { getMeta, setMeta } from './meta';

export type Role = 'owner' | 'cashier';
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
