import fc from 'fast-check';
import { HlcClock, uuidv7 } from '@dukaan/core';
import {
  createCustomer, migrate, MIGRATIONS, MemorySyncServer, OpWriter, saveBill, SyncEngine, TransportError, upsertItems, voidBill,
  type ItemInput, type Role, type SqlDriver, type SyncTransport,
} from '../src';
import { openNodeDb } from '../src/drivers/node';
import { ITEMS, line } from './helpers';

/**
 * Three devices (two owner phones + a cashier counter) with skewed clocks write concurrently while
 * offline, then sync through a server that drops requests, drops responses and sees duplicates.
 * After the network heals and everyone syncs twice, every device must hold identical state, and the
 * server's bill numbers must be gap-free.
 */

type Fault = 'none' | 'dropRequest' | 'dropResponse' | 'duplicate' | 'offline';

type Device = { id: string; role: Role; db: SqlDriver; writer: OpWriter; engine: SyncEngine; bills: string[]; fault: { mode: Fault }; skew: number };

const T0 = Date.UTC(2026, 10, 19, 6, 0, 0);

function faulty(inner: SyncTransport, fault: { mode: Fault }): SyncTransport {
  const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    const mode = fault.mode;
    if (mode === 'offline' || mode === 'dropRequest') throw new TransportError(mode);
    const r = await fn(...a);
    if (mode === 'dropResponse') throw new TransportError(mode);
    if (mode === 'duplicate') return fn(...a);
    return r;
  };
  return { push: wrap(inner.push.bind(inner)), pull: wrap(inner.pull.bind(inner)), ack: wrap(inner.ack.bind(inner)) };
}

const noTimers = { set: () => 0, clear: () => undefined };

async function world(skews: number[]) {
  let now = T0;
  const server = new MemorySyncServer('shop-1', () => now);
  const roles: Role[] = ['owner', 'owner', 'cashier'];
  const devices: Device[] = [];
  for (const [i, role] of roles.entries()) {
    const id = `dev-${'abc'[i]}`;
    const skew = skews[i]!;
    const wall = () => now + skew;
    const db = openNodeDb();
    await migrate(db, MIGRATIONS);
    await db.transaction((tx) => upsertItems(tx, ITEMS));
    const clock = new HlcClock(id, wall);
    const writer = new OpWriter({ shopId: 'shop-1', deviceId: id, role }, clock);
    const fault = { mode: 'none' as Fault };
    const engine = new SyncEngine(db, faulty(server.transport({ deviceId: id, role }), fault), clock, { shopId: 'shop-1', deviceId: id },
      { timers: noTimers, wallClock: wall, pushBatch: 7, pullLimit: 11 });
    devices.push({ id, role, db, writer, engine, bills: [], fault, skew });
  }
  return { server, devices, tick: (ms: number) => { now += ms; }, now: () => now };
}

const itemId = fc.constantFrom('salt', 'rice', 'soap', 'new-1', 'new-2');
const cmd = fc.oneof(
  { arbitrary: fc.record({ k: fc.constant('edit' as const), dev: fc.nat(2), item: fc.constantFrom('salt', 'rice', 'soap'), price: fc.integer({ min: 100, max: 99_999 }), rename: fc.boolean() }), weight: 4 },
  { arbitrary: fc.record({ k: fc.constant('sell' as const), dev: fc.nat(2), item: fc.constantFrom('salt', 'rice', 'soap'), qty: fc.integer({ min: 1, max: 5 }), credit: fc.boolean() }), weight: 5 },
  { arbitrary: fc.record({ k: fc.constant('adjust' as const), dev: fc.nat(1), item: fc.constantFrom('salt', 'rice', 'soap'), delta: fc.integer({ min: -20_000, max: 50_000 }) }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('void' as const), dev: fc.nat(1), pick: fc.nat() }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('pay' as const), dev: fc.nat(2), amount: fc.integer({ min: 100, max: 50_000 }) }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('import' as const), dev: fc.nat(1), ids: fc.uniqueArray(itemId, { minLength: 1, maxLength: 4 }), price: fc.integer({ min: 100, max: 9_999 }), stock: fc.nat(10_000) }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('sync' as const), dev: fc.nat(2), fault: fc.constantFrom<Fault>('none', 'none', 'dropRequest', 'dropResponse', 'duplicate', 'offline') }), weight: 6 },
  { arbitrary: fc.record({ k: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 120_000 }) }), weight: 3 },
);
type Cmd = typeof cmd extends fc.Arbitrary<infer C> ? C : never;

async function run(w: Awaited<ReturnType<typeof world>>, c: Cmd) {
  if (c.k === 'tick') return w.tick(c.ms);
  const d = w.devices[c.dev]!;
  const wall = w.now() + d.skew;
  switch (c.k) {
    case 'edit':
      await d.writer.write(d.db, [{ type: 'item.upsert', entity: 'item', entityId: c.item, payload: c.rename ? { name: `${c.item} ${c.price}`, salePaise: c.price } : { salePaise: c.price } }]);
      return;
    case 'sell': {
      const l = { ...line(c.item, c.qty * 1000) };
      const { rows } = await d.db.execute<{ sale_paise: number }>('SELECT sale_paise FROM item WHERE id = ?', [c.item]);
      l.unitPaise = rows[0]!.sale_paise;
      const total = (await import('@dukaan/core')).computeBill({ lines: [l], interstate: false, billDiscount: null }).total;
      const bill = await saveBill(d.db, d.writer, d.id.toUpperCase(), {
        cart: { lines: [l], billDiscount: null, customerId: c.credit ? 'cust-1' : null, interstate: false, placeOfSupply: '27' },
        payments: [{ mode: c.credit ? 'credit' : 'cash', amountPaise: total, ref: '' }], cashier: d.id, now: wall,
      });
      d.bills.push(bill.id);
      return;
    }
    case 'adjust':
      await d.writer.write(d.db, [{ type: 'stock.adjust', entity: 'stock', entityId: uuidv7(wall), payload: { itemId: c.item, batchId: '', deltaMilli: c.delta, reason: 'count', note: '', createdAt: wall } }]);
      return;
    case 'void': {
      const { rows } = await d.db.execute<{ id: string }>('SELECT id FROM bill ORDER BY id');
      if (rows.length === 0) return;
      await voidBill(d.db, d.writer, rows[c.pick % rows.length]!.id, 'sim');
      return;
    }
    case 'pay':
      await d.writer.write(d.db, [{ type: 'ledger.add', entity: 'ledger', entityId: 'cust-1', payload: { id: uuidv7(wall), customerId: 'cust-1', amountPaise: -c.amount, kind: 'payment', note: '', mode: 'cash', createdAt: wall, billId: null } }]);
      return;
    case 'import': {
      const items: ItemInput[] = c.ids.map((id) => ({ id, name: `Imported ${id}`, salePaise: c.price, gstBp: 500 }));
      await d.writer.write(d.db, [{ type: 'item.bulk', entity: 'item', entityId: uuidv7(wall), payload: { items, stock: items.map((i) => ({ itemId: i.id, deltaMilli: c.stock })) } }]);
      return;
    }
    case 'sync':
      d.fault.mode = c.fault;
      await d.engine.sync().catch((e: unknown) => { if (!(e instanceof TransportError)) throw e; });
      d.fault.mode = 'none';
      return;
  }
}

async function dump(db: SqlDriver) {
  const q = async (sql: string) => (await db.execute(sql)).rows;
  return {
    item: await q('SELECT id, name, name_hi, translit, name_key, barcode, hsn, unit, mrp_paise, sale_paise, cost_paise, gst_bp, deleted, updated_hlc FROM item ORDER BY id'),
    stock: await q('SELECT item_id, qty_milli FROM item_stock ORDER BY item_id'),
    cells: await q('SELECT * FROM stock_cell ORDER BY item_id, batch_id, device_id'),
    bill: await q('SELECT id, local_no, device_id, status, status_hlc, global_no, total_paise, customer_id FROM bill ORDER BY id'),
    lines: await q('SELECT bill_id, line_no, item_id, qty_milli, total_paise FROM bill_line ORDER BY bill_id, line_no'),
    ledger: await q('SELECT id, customer_id, amount_paise, kind, bill_id, created_at, hlc FROM ledger_entry ORDER BY id'),
    customer: await q('SELECT * FROM customer ORDER BY id'),
    adjustments: await q('SELECT id, item_id, delta_milli, device_id FROM stock_adjustment ORDER BY id'),
  };
}

describe('3-device sync simulation', () => {
  it('converges under skewed clocks, partitions, dropped requests/responses and duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: -300_000, max: 300_000 }), { minLength: 3, maxLength: 3 }), fc.array(cmd, { minLength: 5, maxLength: 60 }), async (skews, cmds) => {
        const w = await world(skews);
        const [a] = w.devices;
        // The khata customer exists everywhere before the run.
        await a!.db.transaction(async () => undefined);
        await a!.writer.write(a!.db, [{ type: 'customer.upsert', entity: 'customer', entityId: 'cust-1', payload: { name: 'Ramesh', phone: '9800000000' } }]);
        for (const c of cmds) await run(w, c);

        // Heal: everyone syncs until nothing new moves (two full rounds suffice: round 1 pushes everything).
        for (let round = 0; round < 2; round++) for (const d of w.devices) await d.engine.sync();

        const dumps = await Promise.all(w.devices.map((d) => dump(d.db)));
        expect(dumps[1]).toEqual(dumps[0]);
        expect(dumps[2]).toEqual(dumps[0]);

        // Every op made it to the server exactly once; nothing left pending anywhere.
        for (const d of w.devices) {
          const { rows } = await d.db.execute<{ n: number }>('SELECT count(*) AS n FROM op_log WHERE server_seq IS NULL');
          expect(rows[0]!.n).toBe(0);
        }
        expect(new Set(w.server.log.map((o) => o.opId)).size).toBe(w.server.log.length);

        // Gap-free invoice numbers per financial year, each bill numbered exactly once.
        const nos = (dumps[0]!.bill as { global_no: number | null }[]).map((b) => b.global_no);
        expect(nos.every((n) => n !== null)).toBe(true);
        expect([...nos].sort((x, y) => x! - y!)).toEqual(nos.map((_, i) => i + 1));
      }),
      { numRuns: Number(process.env.SIM_RUNS ?? 500), seed: process.env.SIM_SEED ? Number(process.env.SIM_SEED) : undefined },
    );
  }, 120_000);
});

describe('SyncEngine', () => {
  it('backs off 2s·2^n with jitter up to 5 min, and a successful run resets it', async () => {
    const { backoffDelay } = await import('../src');
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, () => 0.5))).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffDelay(30, () => 0.5)).toBe(300_000);
    expect(backoffDelay(1, () => 0)).toBe(1600);
    expect(backoffDelay(1, () => 1)).toBe(2400);
  });

  it('is single-flight and schedules a retry after a failure', async () => {
    const w = await world([0, 0, 0]);
    const d = w.devices[0]!;
    const scheduled: number[] = [];
    let fire: (() => void) | null = null;
    const engine = new SyncEngine(d.db, faulty(w.server.transport({ deviceId: d.id, role: 'owner' }), d.fault), d.writer.clock, { shopId: 'shop-1', deviceId: d.id }, {
      timers: { set: (fn, ms) => { scheduled.push(ms); fire = fn; return 1; }, clear: () => undefined }, random: () => 0.5,
    });
    await createCustomer(d.db, d.writer, { name: 'Asha' });
    const p1 = engine.sync();
    const p2 = engine.sync();
    expect(p2).toBe(p1);
    await p1;
    expect(w.server.log).toHaveLength(1);

    d.fault.mode = 'offline';
    await expect(engine.sync()).rejects.toThrow(TransportError);
    expect(engine.state).toBe('backoff');
    await expect(engine.sync()).rejects.toThrow(TransportError);
    expect(scheduled).toEqual([2000, 4000]);
    d.fault.mode = 'none';
    fire!();
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.state).toBe('idle');
    expect(engine.failures).toBe(0);
  });

  it('quarantines ops from a clock more than 24 h ahead and applies them once time catches up', async () => {
    let now = T0;
    const server = new MemorySyncServer('shop-1', () => now);
    const mk = async (id: string, skew: number) => {
      const db = openNodeDb();
      await migrate(db, MIGRATIONS);
      await db.transaction((tx) => upsertItems(tx, ITEMS));
      const clock = new HlcClock(id, () => now + skew);
      return { db, writer: new OpWriter({ shopId: 'shop-1', deviceId: id, role: 'owner' }, clock),
        engine: new SyncEngine(db, server.transport({ deviceId: id, role: 'owner' }), clock, { shopId: 'shop-1', deviceId: id }, { timers: noTimers, wallClock: () => now + skew }) };
    };
    const future = await mk('dev-f', 30 * 3600_000);
    const b = await mk('dev-b', 0);
    await future.writer.write(future.db, [{ type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { salePaise: 9999 } }]);
    await future.engine.sync();
    const r = await b.engine.sync();
    expect(r.quarantined).toBe(1);
    expect((await b.db.execute('SELECT sale_paise FROM item WHERE id = ?', ['salt'])).rows[0]).toEqual({ sale_paise: 2800 });
    // B's HLC was not dragged 30 h into the future.
    expect(Number(b.writer.clock.peek().slice(0, 15))).toBeLessThan(now + 3600_000);

    now += 7 * 3600_000; // 23 h ahead now: within tolerance
    await b.engine.sync();
    expect((await b.db.execute('SELECT sale_paise FROM item WHERE id = ?', ['salt'])).rows[0]).toEqual({ sale_paise: 9999 });
    expect((await b.db.execute('SELECT count(*) AS n FROM op_quarantine')).rows[0]).toEqual({ n: 0 });
  });

  it('server rejects owner-only ops from a cashier; the device parks them instead of resending', async () => {
    const w = await world([0, 0, 0]);
    const c = w.devices[2]!;
    // A cashier device can't author one…
    await expect(c.writer.write(c.db, [{ type: 'stock.adjust', entity: 'stock', entityId: 'x', payload: { itemId: 'salt', batchId: '', deltaMilli: 1, reason: '', note: '', createdAt: 0 } }])).rejects.toThrow(/owner/);
    // …and a device demoted after writing one gets it rejected.
    const demoted = new MemorySyncServer('shop-1');
    const a = w.devices[0]!;
    await a.writer.write(a.db, [{ type: 'stock.adjust', entity: 'stock', entityId: 'x', payload: { itemId: 'salt', batchId: '', deltaMilli: 1, reason: '', note: '', createdAt: 0 } }]);
    const engine = new SyncEngine(a.db, demoted.transport({ deviceId: a.id, role: 'cashier' }), a.writer.clock, { shopId: 'shop-1', deviceId: a.id }, { timers: noTimers });
    const r = await engine.sync();
    expect(r.rejected).toBe(1);
    expect(demoted.log).toHaveLength(0);
    expect((await engine.sync()).pushed).toBe(0);
    expect((await a.db.execute("SELECT reason FROM op_quarantine")).rows[0]).toEqual({ reason: 'rejected: stock.adjust needs owner role' });
  });
});
