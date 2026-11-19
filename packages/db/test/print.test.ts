import { encodeReceipt, PAPER, receiptBlocks } from '@dukaan/core';
import { claimPrintJob, createShop, enqueuePrint, failPrintJob, finishPrintJob, listPrintJobs, MAX_PRINT_ATTEMPTS, printBackoffMs, receiptForBill, retryPrintJob, saveBill } from '../src';
import { deviceDb, line } from './helpers';

const shopInput = { name: 'Sharma Kirana', gstin: '', stateCode: '27', address: 'Shop 4, Dadar', phone: '', upiVpa: 'sharma@upi', pharmacyMode: false, invoiceFooter: 'Dhanyavaad', prefix: 'C1', pinHash: 'x', pinLength: 4, deviceName: 'Counter 1' };

async function withBill(payments: { mode: 'cash' | 'credit'; amountPaise: number; ref: string }[], customerId: string | null = null) {
  const { db, writer } = await deviceDb();
  await createShop(db, shopInput);
  const bill = await saveBill(db, writer, 'C1', {
    cart: { lines: [line('salt', 2000), { ...line('soap', 1000), name: 'लक्स साबुन' }], billDiscount: null, customerId, interstate: false, placeOfSupply: '27' },
    payments, cashier: 'owner',
  });
  return { db, writer, bill };
}

describe('print queue', () => {
  it('claims oldest first, backs off exponentially and gives up after MAX attempts', async () => {
    const { db, bill } = await withBill([{ mode: 'cash', amountPaise: 10100, ref: '' }]);
    let t = 1_000_000;
    const a = await enqueuePrint(db, bill.id, t);
    const b = await enqueuePrint(db, bill.id, t + 1);

    const first = await claimPrintJob(db, t + 5);
    expect(first?.id).toBe(a);
    expect(first?.attempts).toBe(1);
    expect((await claimPrintJob(db, t + 5))?.id).toBe(b); // a is 'printing', so b is next
    await finishPrintJob(db, b);
    expect(await claimPrintJob(db, t + 5)).toBeNull();

    for (let n = 1; n < MAX_PRINT_ATTEMPTS; n++) {
      expect(await failPrintJob(db, a, 'socket closed', t)).toBe('queued');
      expect(await claimPrintJob(db, t + printBackoffMs(n) - 1)).toBeNull(); // still backing off
      t += printBackoffMs(n);
      expect((await claimPrintJob(db, t))?.attempts).toBe(n + 1);
    }
    expect(await failPrintJob(db, a, 'socket closed', t)).toBe('failed');
    expect(await claimPrintJob(db, t + 10 * 60_000)).toBeNull();

    await retryPrintJob(db, a, t);
    expect((await claimPrintJob(db, t))?.attempts).toBe(1);
  });

  it('backoff is 2 s doubling, capped at a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(printBackoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  it('re-claims a job stranded in printing after a crash', async () => {
    const { db, bill } = await withBill([{ mode: 'cash', amountPaise: 10100, ref: '' }]);
    await enqueuePrint(db, bill.id, 0);
    expect(await claimPrintJob(db, 10)).not.toBeNull();
    expect(await claimPrintJob(db, 30_000)).toBeNull();
    expect((await claimPrintJob(db, 70_000))?.attempts).toBe(2);
  });

  it('lists jobs with the bill number', async () => {
    const { db, bill } = await withBill([{ mode: 'cash', amountPaise: 10100, ref: '' }]);
    await enqueuePrint(db, bill.id);
    expect((await listPrintJobs(db))[0]).toMatchObject({ local_no: 'C1-000001', status: 'queued' });
  });
});

describe('receiptForBill', () => {
  it('builds the receipt from the stored bill and rasterises the Hindi line only', async () => {
    const { db, bill } = await withBill([{ mode: 'cash', amountPaise: 10100, ref: '' }]);
    const r = (await receiptForBill(db, bill.id))!;
    expect(r).toMatchObject({ shopName: 'Sharma Kirana', billNo: 'C1-000001', totalPaise: 10100, footer: 'Dhanyavaad', upiUri: undefined });
    expect(r.lines.map((l) => l.name)).toEqual(['Tata Salt 1kg', 'लक्स साबुन']);
    const blocks = receiptBlocks(r, '58mm');
    expect(blocks.filter((x) => x.kind === 'raster-text').map((x) => (x as { text: string }).text)).toEqual(['लक्स साबुन']);
    let drawn = 0;
    const bytes = encodeReceipt(blocks, '58mm', (_b, w) => {
      drawn++;
      expect(w).toBe(PAPER['58mm'].dots);
      return { width: w, height: 24, data: new Uint8Array((w / 8) * 24) };
    });
    expect(drawn).toBe(1);
    expect(bytes.length).toBeGreaterThan(48 * 24);
  });

  it('adds a UPI QR for the amount left on khata', async () => {
    const { db, writer } = await deviceDb();
    await createShop(db, shopInput);
    const { createCustomer } = await import('../src');
    const cust = await createCustomer(db, writer, { name: 'Ramesh' });
    const bill = await saveBill(db, writer, 'C1', {
      cart: { lines: [line('salt', 2000)], billDiscount: null, customerId: cust, interstate: false, placeOfSupply: '27' },
      payments: [{ mode: 'cash', amountPaise: 1600, ref: '' }, { mode: 'credit', amountPaise: 4000, ref: '' }], cashier: 'owner',
    });
    const r = (await receiptForBill(db, bill.id))!;
    expect(r.upiUri).toContain('am=40.00');
    expect(r.payments).toEqual([{ mode: 'cash', amountPaise: 1600 }, { mode: 'khata', amountPaise: 4000 }]);
  });
});
