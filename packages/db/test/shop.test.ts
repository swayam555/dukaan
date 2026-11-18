import { createShop, getDevice, getShop, migrate, MIGRATIONS, scalar } from '../src';
import { openNodeDb } from '../src/drivers/node';

async function fresh() {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  return db;
}

const base = { name: 'Sharma Kirana', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: '', phone: '', upiVpa: 'sharma@upi', pharmacyMode: false, invoiceFooter: '', prefix: 'C1', pinHash: 'x', pinLength: 4, deviceName: 'Counter 1' };

describe('shop setup', () => {
  it('creates shop, owner device and bill series atomically', async () => {
    const db = await fresh();
    const { shop, device } = await createShop(db, base);
    expect(await getShop(db)).toEqual(shop);
    expect(await getDevice(db)).toMatchObject({ role: 'owner', prefix: 'C1', shopId: shop.id });
    expect(await scalar(db, "SELECT next_seq FROM bill_series WHERE prefix = 'C1'")).toBe(1);
    expect(device.id).not.toBe(shop.id);
  });

  it('rejects bad GSTIN and prefix', async () => {
    const db = await fresh();
    await expect(createShop(db, { ...base, gstin: '27AAPFU0939F1ZA' })).rejects.toThrow(/GSTIN/);
    await expect(createShop(db, { ...base, prefix: 'c-1' })).rejects.toThrow(/prefix/);
    expect(await getShop(db)).toBeNull();
  });
});
