import { computeBill } from '@dukaan/core';
import { createCustomer, gstDate, gstr1, paymentSplit, salesByDay, salesSummary, saveBill, topItems, updateCustomer, voidBill, type Cart } from '../src';
import { deviceDb, line } from './helpers';

const at = (day: string) => new Date(`${day}T12:00:00`).getTime(); // local noon → bill.day = day

async function shop() {
  const { db, writer } = await deviceDb();
  const sell = async (day: string, lines: Cart['lines'], o: Partial<Cart> & { mode?: 'cash' | 'upi' | 'credit' } = {}) => {
    const cart: Cart = { lines, billDiscount: null, customerId: null, interstate: false, placeOfSupply: '27', ...o };
    const total = computeBill({ lines, interstate: cart.interstate, billDiscount: null }).total;
    return saveBill(db, writer, 'A', { cart, payments: [{ mode: o.mode ?? 'cash', amountPaise: total, ref: '' }], cashier: 'o', now: at(day) });
  };
  return { db, writer, sell };
}

it('daily series (zero-filled), summary, mode split and top items skip void bills', async () => {
  const { db, writer, sell } = await shop();
  await sell('2026-11-01', [line('salt', 2000)]);                              // ₹56 (prices are MRP, GST-inclusive)
  await sell('2026-11-01', [line('rice', 1500)], { mode: 'upi' });             // ₹180
  const v = await sell('2026-11-03', [line('soap', 1000)]);                    // ₹45, voided below
  await sell('2026-11-03', [line('salt', 1000)], { mode: 'upi' });             // 28
  await voidBill(db, writer, v.id, 'mistake');

  const r = { from: '2026-11-01', to: '2026-11-04' };
  expect((await salesByDay(db, r)).map((d) => [d.day, d.bills, d.total_paise])).toEqual([
    ['2026-11-01', 2, 23_600], ['2026-11-02', 0, 0], ['2026-11-03', 1, 2800], ['2026-11-04', 0, 0],
  ]);
  const s = await salesSummary(db, r);
  expect(s).toMatchObject({ bills: 3, voids: 1, total_paise: 26_400, tax_paise: 857, avg_bill_paise: 8800 });
  expect(s.profit_paise).toBe((5600 - 4600) + (17_143 - 14_700) + (2800 - 2300)); // taxable − cost; rice taxable = 180/1.05
  expect(await paymentSplit(db, r)).toEqual([{ mode: 'upi', amount_paise: 20_800, bills: 2 }, { mode: 'cash', amount_paise: 5600, bills: 1 }]);
  expect((await topItems(db, r)).map((t) => [t.item_id, t.qty_milli])).toEqual([['rice', 1500], ['salt', 3000]]);
  expect((await topItems(db, r, 'qty')).map((t) => t.item_id)).toEqual(['salt', 'rice']);
});

it('GSTR-1 splits B2B / B2CL / B2CS / HSN and lists the document series', async () => {
  const { db, writer, sell } = await shop();
  const firm = await createCustomer(db, writer, { name: 'Hotel Annapurna, Pune' });
  await updateCustomer(db, writer, firm, { gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  await sell('2026-11-02', [line('rice', 10_000), line('soap', 2000)], { customerId: firm });          // B2B, two rates
  await sell('2026-11-05', [line('rice', 900_000)], { interstate: true, placeOfSupply: '29' });         // ₹1,08,000 incl. IGST → B2CL
  await sell('2026-11-05', [line('rice', 1000)], { interstate: true, placeOfSupply: '29' });            // small inter-state → B2CS
  await sell('2026-11-06', [line('salt', 3000), line('soap', 1000)]);                                   // B2CS intra
  const v = await sell('2026-11-07', [line('soap', 1000)]);
  await voidBill(db, writer, v.id, 'x');
  await sell('2026-12-01', [line('salt', 1000)]);                                                       // next period

  const g = await gstr1(db, { from: '2026-11-01', to: '2026-11-30' });
  expect(gstDate('2026-11-05')).toBe('05-Nov-2026');
  expect(g.b2b.split('\n')).toEqual([
    'GSTIN/UIN of Recipient,Receiver Name,Invoice Number,Invoice date,Invoice Value,Place Of Supply,Reverse Charge,Applicable % of Tax Rate,Invoice Type,E-Commerce GSTIN,Rate,Taxable Value,Cess Amount',
    '27AAPFU0939F1ZV,"Hotel Annapurna, Pune",A-000001,02-Nov-2026,1290.00,27-Maharashtra,N,,Regular B2B,,5,1142.86,0.00',
    '27AAPFU0939F1ZV,"Hotel Annapurna, Pune",A-000001,02-Nov-2026,1290.00,27-Maharashtra,N,,Regular B2B,,18,76.27,0.00',
    '',
  ]);
  expect(g.b2cl.split('\n')[1]).toBe('A-000002,05-Nov-2026,108000.00,29-Karnataka,,5,102857.14,0.00,');
  expect(g.b2cs.split('\n').slice(1, -1)).toEqual(['OE,27-Maharashtra,,0,84.00,0.00,', 'OE,27-Maharashtra,,18,38.14,0.00,', 'OE,29-Karnataka,,5,114.29,0.00,']);
  expect(g.hsn_b2b.split('\n')[1]).toBe('1006,Basmati Rice (Loose),KGS-KILOGRAMS,10,1200.00,5,1142.86,0.00,28.57,28.57,0.00');
  expect(g.hsn_b2c).toContain('1006,Basmati Rice (Loose),KGS-KILOGRAMS,901,');
  expect(g.hsn_b2c).toContain('2501,Tata Salt 1kg,NOS-NUMBERS,3,84.00,0,84.00,0.00,0.00,0.00,0.00');
  expect(g.docs.split('\n')[1]).toBe('Invoices for outward supply,A-000001,A-000005,5,1');
  expect(g.counts).toEqual({ b2b: 2, b2cl: 1, b2cs: 3, hsn_b2b: 2, hsn_b2c: 3, docs: 1 });
});
