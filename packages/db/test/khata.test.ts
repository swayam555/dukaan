import {
  addLedgerAdjustment, createCustomer, getCustomer, khataList, khataTotals, lastReminded, ledgerFor, markReminded, recordPayment, remindersDue,
  saveBill, updateCustomer, voidBill,
} from '../src';
import { deviceDb, line } from './helpers';

const DAY = 86_400_000;

async function setup() {
  const { db, writer } = await deviceDb();
  const ramesh = await createCustomer(db, writer, { name: 'Ramesh', phone: '9800000001' });
  const sita = await createCustomer(db, writer, { name: 'Sita', phone: '9800000002' });
  await createCustomer(db, writer, { name: 'Zero Balance' });
  const credit = (customerId: string, amountPaise: number, cart = [line('salt', 1000)]) =>
    saveBill(db, writer, 'A', { cart: { lines: cart, billDiscount: null, customerId, interstate: false, placeOfSupply: '27' }, payments: [{ mode: 'credit', amountPaise, ref: '' }], cashier: 'o' });
  return { db, writer, ramesh, sita, credit };
}

it('balances, running ledger, payments and voids', async () => {
  const { db, writer, ramesh, sita, credit } = await setup();
  const b1 = await credit(ramesh, 2800);
  await credit(ramesh, 12_000, [line('rice', 1000)]);
  await recordPayment(db, writer, { customerId: ramesh, amountPaise: 5000, mode: 'upi', note: 'GPay' });
  await addLedgerAdjustment(db, writer, { customerId: sita, amountPaise: 75_000, kind: 'opening', note: 'old register' });

  const ledger = await ledgerFor(db, ramesh);
  expect(ledger.map((l) => [l.kind, l.amount_paise, l.balance_paise])).toEqual([['credit_sale', 2800, 2800], ['credit_sale', 12_000, 14_800], ['payment', -5000, 9800]]);
  expect(ledger[0]!.bill_no).toBe('A-000001');

  expect((await khataList(db)).map((r) => [r.name, r.balance_paise])).toEqual([['Ramesh', 9800], ['Sita', 75_000], ['Zero Balance', 0]]);
  expect((await khataList(db, { dueOnly: true })).map((r) => r.name)).toEqual(['Sita', 'Ramesh']);
  expect((await khataList(db, { q: '98000000' })).length).toBe(2);
  expect(await khataTotals(db)).toEqual({ duePaise: 84_800, customersDue: 2 });

  await voidBill(db, writer, b1.id, 'returned');
  expect((await ledgerFor(db, ramesh)).at(-1)!.balance_paise).toBe(7000);
  await expect(recordPayment(db, writer, { customerId: ramesh, amountPaise: 0, mode: 'cash' })).rejects.toThrow(/amount/);
});

it('customer edits are field-level ops (GSTIN for B2B)', async () => {
  const { db, writer, ramesh } = await setup();
  await updateCustomer(db, writer, ramesh, { gstin: ' 27aapfu0939f1zv ', stateCode: '27' });
  expect(await getCustomer(db, ramesh)).toMatchObject({ name: 'Ramesh', phone: '9800000001', gstin: '27AAPFU0939F1ZV', state_code: '27' });
  await expect(updateCustomer(db, writer, ramesh, { name: '  ' })).rejects.toThrow(/name/);
});

it('reminders: due, quiet, and not nagged twice in a row', async () => {
  const { db, writer, ramesh, sita, credit } = await setup();
  const now = Date.now();
  await credit(ramesh, 2800);
  await addLedgerAdjustment(db, writer, { customerId: sita, amountPaise: 50_000, kind: 'opening' });
  await recordPayment(db, writer, { customerId: sita, amountPaise: 1000, mode: 'cash', now: now - 2 * DAY }); // paid recently
  expect((await remindersDue(db, { now })).map((r) => r.name)).toEqual(['Ramesh']);
  expect((await remindersDue(db, { now: now + 6 * DAY })).map((r) => r.name)).toEqual(['Sita', 'Ramesh']);
  await markReminded(db, ramesh, now);
  expect(await lastReminded(db, ramesh)).toBe(now);
  expect((await remindersDue(db, { now: now + 2 * DAY })).map((r) => r.name)).toEqual([]);
  expect((await remindersDue(db, { now: now + 4 * DAY })).map((r) => r.name)).toEqual(['Ramesh']);
  expect((await remindersDue(db, { now: now + 6 * DAY, minPaise: 10_000 })).map((r) => r.name)).toEqual(['Sita']);
});
