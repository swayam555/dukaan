import { applyOp, getBill, holdBill, insertOpLog, listHeldBills, resumeHeldBill, saveBill, scalar, stockOf, voidBill, type Cart, type Op } from '../src';
import { deviceDb, line } from './helpers';

const cart = (over: Partial<Cart> = {}): Cart => ({ lines: [line('salt', 2000), line('rice', 1500)], billDiscount: null, customerId: null, interstate: false, placeOfSupply: '27', ...over });

describe('saveBill', () => {
  it('writes bill, lines, payments, stock and op log in one go', async () => {
    const { db, writer } = await deviceDb();
    const bill = await saveBill(db, writer, 'C1', { cart: cart(), payments: [{ mode: 'cash', amountPaise: 23600, ref: '' }], cashier: 'owner' });
    expect(bill.localNo).toBe('C1-000001');
    expect(bill.totalPaise).toBe(23600); // 2×28 + 1.5×120 = 236
    expect(await stockOf(db, 'salt')).toBe(-2000);
    expect(await stockOf(db, 'rice')).toBe(-1500);
    expect(await scalar(db, 'SELECT qty_milli FROM item_stock WHERE item_id = ?', ['rice'])).toBe(-1500);
    expect(await scalar(db, "SELECT count(*) FROM op_log WHERE type = 'bill.create' AND server_seq IS NULL")).toBe(1);
    const stored = await getBill(db, bill.id);
    expect(stored?.lines).toHaveLength(2);
    expect(stored?.payments).toEqual([{ mode: 'cash', amount_paise: 23600, ref: '' }]);
  });

  it('numbers bills sequentially per counter prefix', async () => {
    const { db, writer } = await deviceDb();
    const nos = [];
    for (let i = 0; i < 3; i++) nos.push((await saveBill(db, writer, 'C2', { cart: cart({ lines: [line('salt', 1000)] }), payments: [{ mode: 'upi', amountPaise: 2800, ref: '' }], cashier: 'c' })).localNo);
    expect(nos).toEqual(['C2-000001', 'C2-000002', 'C2-000003']);
  });

  it('splits payment and puts the credit part on the customer khata', async () => {
    const { db, writer } = await deviceDb();
    const bill = await saveBill(db, writer, 'C1', {
      cart: cart({ customerId: 'cust-1' }),
      payments: [{ mode: 'cash', amountPaise: 10000, ref: '' }, { mode: 'credit', amountPaise: 13600, ref: '' }],
      cashier: 'owner',
    });
    expect(await scalar(db, 'SELECT sum(amount_paise) FROM ledger_entry WHERE customer_id = ?', ['cust-1'])).toBe(13600);
    await voidBill(db, writer, bill.id, 'customer returned');
    expect(await scalar(db, 'SELECT sum(amount_paise) FROM ledger_entry WHERE customer_id = ?', ['cust-1'])).toBe(0);
    expect(await stockOf(db, 'salt')).toBe(0);
    expect(await scalar(db, 'SELECT status FROM bill WHERE id = ?', [bill.id])).toBe('void');
    await voidBill(db, writer, bill.id, 'again');
    expect(await stockOf(db, 'salt')).toBe(0);
  });

  it('rejects mismatched payments, empty bills and credit without a customer', async () => {
    const { db, writer } = await deviceDb();
    await expect(saveBill(db, writer, 'C1', { cart: cart(), payments: [{ mode: 'cash', amountPaise: 100, ref: '' }], cashier: 'c' })).rejects.toThrow(/do not match/);
    await expect(saveBill(db, writer, 'C1', { cart: cart({ lines: [] }), payments: [], cashier: 'c' })).rejects.toThrow(/no items/);
    await expect(saveBill(db, writer, 'C1', { cart: cart(), payments: [{ mode: 'credit', amountPaise: 23600, ref: '' }], cashier: 'c' })).rejects.toThrow(/customer/);
    expect(await scalar(db, 'SELECT count(*) FROM bill')).toBe(0);
    expect(await scalar(db, 'SELECT next_seq FROM bill_series WHERE prefix = ?', ['C1'])).toBe(undefined);
  });

  it('only owners can void', async () => {
    const { db, writer } = await deviceDb('dev-c', 'cashier');
    const bill = await saveBill(db, writer, 'C3', { cart: cart(), payments: [{ mode: 'cash', amountPaise: 23600, ref: '' }], cashier: 'c' });
    await expect(voidBill(db, writer, bill.id, 'x')).rejects.toThrow(/owner/);
  });

  it('replaying the op log on another device reproduces the same state', async () => {
    const a = await deviceDb('dev-a');
    const b = await deviceDb('dev-b');
    await saveBill(a.db, a.writer, 'C1', { cart: cart({ customerId: 'k' }), payments: [{ mode: 'credit', amountPaise: 23600, ref: '' }], cashier: 'o' });
    const { rows } = await a.db.execute<{ op_id: string; device_id: string; entity: Op['entity']; entity_id: string; type: Op['type']; payload: string; hlc: string; role: Op['role'] }>('SELECT * FROM op_log');
    const ops = rows.map((r) => ({ opId: r.op_id, shopId: 'shop-1', deviceId: r.device_id, entity: r.entity, entityId: r.entity_id, type: r.type, payload: JSON.parse(r.payload), hlc: r.hlc, role: r.role }) as Op);
    for (let pass = 0; pass < 2; pass++) {
      await b.db.transaction(async (tx) => {
        for (const op of ops) if (await insertOpLog(tx, op, false, 1)) await applyOp(tx, op);
      });
    }
    for (const sql of ['SELECT total_paise FROM bill', 'SELECT sum(qty_milli) FROM item_stock', 'SELECT sum(amount_paise) FROM ledger_entry', 'SELECT count(*) FROM bill_line']) {
      expect(await scalar(b.db, sql)).toEqual(await scalar(a.db, sql));
    }
  });
});

describe('held bills', () => {
  it('parks and resumes a cart', async () => {
    const { db } = await deviceDb();
    const id = await holdBill(db, 'Customer in blue shirt', cart());
    expect((await listHeldBills(db)).map((h) => h.label)).toEqual(['Customer in blue shirt']);
    expect((await resumeHeldBill(db, id))?.lines).toHaveLength(2);
    expect(await listHeldBills(db)).toEqual([]);
  });
});
