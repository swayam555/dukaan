import { applyOp, insertOpLog, saveBill, voidBill, type Op } from '../src';
import { deviceDb, line } from './helpers';

/** Applies the same ops in every order on fresh devices; the resulting state must be identical. */
async function stateAfter(ops: Op[]) {
  const { db } = await deviceDb('dev-x');
  await db.transaction(async (tx) => {
    for (const op of ops) if (await insertOpLog(tx, op, false, null)) await applyOp(tx, op);
  });
  return {
    bill: (await db.execute('SELECT id, status, status_hlc, global_no FROM bill')).rows,
    ledger: (await db.execute('SELECT id, amount_paise, hlc, created_at FROM ledger_entry ORDER BY id')).rows,
    cells: (await db.execute('SELECT * FROM stock_cell ORDER BY item_id, device_id')).rows,
  };
}

const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

async function opsOf(db: Awaited<ReturnType<typeof deviceDb>>['db']): Promise<Op[]> {
  const { rows } = await db.execute<Record<string, string>>('SELECT * FROM op_log ORDER BY hlc');
  return rows.map((r) => ({ opId: r.op_id, shopId: 'shop-1', deviceId: r.device_id, entity: r.entity, entityId: r.entity_id, type: r.type, payload: JSON.parse(r.payload!), hlc: r.hlc, role: r.role }) as Op);
}

describe('apply is order-insensitive', () => {
  it('bill.create + two voids from different owner devices + server number: same state in all 24 orders', async () => {
    const a = await deviceDb('dev-a', 'owner', () => 1_000);
    const b = await deviceDb('dev-b', 'owner', () => 2_000);
    const bill = await saveBill(a.db, a.writer, 'A', {
      cart: { lines: [line('salt', 1000)], billDiscount: null, customerId: 'cust-1', interstate: false, placeOfSupply: '27' },
      payments: [{ mode: 'credit', amountPaise: 2800, ref: '' }], cashier: 'a',
    });
    const [create] = await opsOf(a.db);
    await b.db.transaction(async (tx) => { await insertOpLog(tx, create!, false, 1); await applyOp(tx, create!); });
    await voidBill(a.db, a.writer, bill.id, 'a');
    await voidBill(b.db, b.writer, bill.id, 'b');
    const voids = [...(await opsOf(a.db)).filter((o) => o.type === 'bill.void'), ...(await opsOf(b.db)).filter((o) => o.type === 'bill.void')];
    const number: Op = { type: 'bill.number', entity: 'bill', entityId: bill.id, payload: { globalNo: 7, fy: '2026-27' }, opId: 'n1', shopId: 'shop-1', deviceId: 'server', hlc: '000000000003000:00000:server', role: 'owner' };
    const all = [create!, ...voids, number];
    const expected = await stateAfter(all);
    expect(expected.bill).toEqual([{ id: bill.id, status: 'void', status_hlc: voids[0]!.hlc, global_no: 7 }]);
    for (const order of perms(all)) expect(await stateAfter(order)).toEqual(expected);
  });
});
