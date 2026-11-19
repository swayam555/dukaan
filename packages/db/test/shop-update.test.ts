import { createShop, getShop, updateShop } from '../src';
import { deviceDb } from './helpers';

describe('updateShop', () => {
  it('updates UPI + footer, keeps state, rejects mismatched GSTIN', async () => {
    const { db } = await deviceDb();
    await createShop(db, { name: 'Sharma', gstin: '', stateCode: '27', address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '', prefix: 'C1', pinHash: 'x', pinLength: 4, deviceName: 'c' });
    const s = await updateShop(db, { upiVpa: ' sharma@okaxis ', invoiceFooter: 'Dhanyavaad' });
    expect(s.upiVpa).toBe('sharma@okaxis');
    expect((await getShop(db))!.invoiceFooter).toBe('Dhanyavaad');
    await expect(updateShop(db, { upiVpa: 'nope' })).rejects.toThrow('invalid UPI ID');
    await expect(updateShop(db, { gstin: '29AAPFU0939F1ZV' })).rejects.toThrow();
    await expect(updateShop(db, { gstin: '27AAPFU0939F1ZV' })).resolves.toMatchObject({ gstin: '27AAPFU0939F1ZV' });
  });
});
