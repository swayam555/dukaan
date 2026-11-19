/**
 * Live end-to-end: three SQLite "phones" (owner + two paired counters) sync through the real stack
 * (nginx → Spring sync-api → Postgres/Redis/Kafka) using the same SyncEngine + HttpTransport the app
 * ships. Checks convergence, gap-free server bill numbers and the Kafka-fed read model.
 *
 *   docker compose up -d --wait nginx
 *   pnpm --filter @dukaan/db exec tsx scripts/e2e-sync.ts
 */
import { execFileSync } from 'node:child_process';
import { computeBill, HlcClock, uuidv7 } from '@dukaan/core';
import {
  createShop, getDevice, getShop, HttpTransport, joinShop, migrate, MIGRATIONS, OpWriter, saveBill, SyncApi,
  SyncEngine, voidBill, type SqlDriver,
} from '../src';
import { openNodeDb } from '../src/drivers/node';
import { dump, ITEMS, line } from '../test/helpers';

const URL = process.env.SYNC_URL ?? 'http://localhost:4780';
const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`  ok  ${what}`);
};

type Phone = { name: string; db: SqlDriver; writer: OpWriter; engine: SyncEngine; prefix: string };

async function fresh() {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  return db;
}

async function attach(name: string, db: SqlDriver, token: string): Promise<Phone> {
  const shop = (await getShop(db))!;
  const dev = (await getDevice(db))!;
  const clock = new HlcClock(dev.id);
  const writer = new OpWriter({ shopId: shop.id, deviceId: dev.id, role: dev.role }, clock);
  const engine = new SyncEngine(db, new HttpTransport({ baseUrl: URL, token: () => token }), clock, { shopId: shop.id, deviceId: dev.id },
    { timers: { set: () => 0, clear: () => undefined }, pushBatch: 50, pullLimit: 40 });
  return { name, db, writer, engine, prefix: dev.prefix };
}

async function sell(p: Phone, itemId: string, qtyMilli: number, credit = false) {
  const l = line(itemId, qtyMilli);
  const total = computeBill({ lines: [l], interstate: false, billDiscount: null }).total;
  return saveBill(p.db, p.writer, p.prefix, {
    cart: { lines: [l], billDiscount: null, customerId: credit ? 'cust-ramesh' : null, interstate: false, placeOfSupply: '27' },
    payments: [{ mode: credit ? 'credit' : 'cash', amountPaise: total, ref: '' }], cashier: p.name,
  });
}

function psql(sql: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'dukaan', '-d', 'dukaan', '-tAc', sql], { encoding: 'utf8' }).trim();
}

async function main() {
  const t0 = performance.now();
  const anon = new SyncApi({ baseUrl: URL, token: () => null });

  // 1. Owner sets the shop up offline, then connects it with an OTP.
  const ownerDb = await fresh();
  const { shop, device } = await createShop(ownerDb, {
    name: 'E2E Kirana', gstin: '', stateCode: '27', address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '',
    prefix: 'A', pinHash: 'x', pinLength: 4, deviceName: 'Owner',
  });
  const mobile = `9${String(Date.now()).slice(-9)}`;
  const { devOtp } = await anon.requestOtp(mobile);
  const { token: ownerJwt } = await anon.verifyOtp(mobile, devOtp!, { id: shop.id, name: shop.name, gstin: '', stateCode: '27' },
    { id: device.id, name: 'Owner', prefix: 'A' });
  const owner = await attach('owner', ownerDb, ownerJwt);
  const ownerApi = new SyncApi({ baseUrl: URL, token: () => ownerJwt });
  assert(ownerJwt.split('.').length === 3, 'owner connected with OTP (JWT issued)');

  // 2. Owner loads the catalogue + opening stock and a khata customer, syncs.
  await owner.writer.write(owner.db, [
    { type: 'item.bulk', entity: 'item', entityId: uuidv7(), payload: { items: ITEMS, stock: [{ itemId: 'salt', deltaMilli: 100_000 }, { itemId: 'rice', deltaMilli: 50_000 }, { itemId: 'soap', deltaMilli: 40_000 }] } },
    { type: 'customer.upsert', entity: 'customer', entityId: 'cust-ramesh', payload: { name: 'Ramesh', phone: '9800000001' } },
  ]);
  await owner.engine.sync();

  // 3. Two counters pair. A reused code is refused.
  const counters: Phone[] = [];
  for (const prefix of ['B', 'C']) {
    const { token } = await ownerApi.createPairing();
    const id = uuidv7();
    const claim = await anon.claimPairing(token, { id, name: `Counter ${prefix}`, prefix });
    if (prefix === 'B') {
      const again = await anon.claimPairing(token, { id: uuidv7(), name: 'x', prefix: 'Z' }).then(() => 'accepted', (e: Error) => e.constructor.name);
      assert(again === 'AuthError', 'pairing code is single-use');
    }
    const db = await fresh();
    await joinShop(db, { shop: { id: claim.shopId, name: claim.shopName, gstin: claim.gstin, stateCode: claim.stateCode }, device: { id, prefix, name: `Counter ${prefix}` }, pinHash: 'x', pinLength: 4 });
    const p = await attach(`counter-${prefix}`, db, claim.token);
    counters.push(p);
    await p.engine.sync();
  }
  const [b, c] = counters as [Phone, Phone];
  assert((await b.db.execute('SELECT count(*) AS n FROM item')).rows[0]!.n === 3, 'counter B pulled the catalogue on first sync');

  // 4. Everyone bills "offline", owner re-prices and voids; then everyone syncs twice.
  const bills = [];
  for (let i = 0; i < 20; i++) {
    bills.push(await sell(b, 'salt', 1000 * (1 + (i % 3))));
    bills.push(await sell(c, i % 2 ? 'rice' : 'soap', i % 2 ? 750 : 2000, i % 5 === 0));
  }
  bills.push(await sell(owner, 'soap', 1000));
  await owner.writer.write(owner.db, [{ type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { salePaise: 3000 } }]);
  const cashierVoid = await voidBill(b.db, b.writer, bills[0]!.id, 'test').then(() => 'allowed', (e: Error) => e.message);
  assert(/owner/.test(cashierVoid), 'counter cannot void (owner-only, refused locally)');
  await owner.engine.sync();
  const all = [owner, b, c];
  const t1 = performance.now();
  for (let r = 0; r < 2; r++) for (const p of all) await p.engine.sync();
  const syncMs = performance.now() - t1;
  // owner voids a counter's bill after seeing it
  await voidBill(owner.db, owner.writer, bills[1]!.id, 'customer returned');
  for (let r = 0; r < 2; r++) for (const p of all) await p.engine.sync();

  // 5. Convergence.
  const dumps = await Promise.all(all.map((p) => dump(p.db)));
  assert(JSON.stringify(dumps[1]) === JSON.stringify(dumps[0]) && JSON.stringify(dumps[2]) === JSON.stringify(dumps[0]), 'all 3 phones hold identical state');
  const nos = (dumps[0]!.bill as { global_no: number | null }[]).map((x) => x.global_no).sort((x, y) => x! - y!);
  assert(nos.length === 41 && nos.every((n, i) => n === i + 1), `41 bills numbered 1..41 by the server, gap-free`);
  for (const p of all) {
    const pending = (await p.db.execute('SELECT count(*) AS n FROM op_log WHERE server_seq IS NULL')).rows[0]!.n;
    assert(pending === 0, `${p.name}: nothing left to push`);
  }
  const voided = (dumps[0]!.bill as { id: string; status: string }[]).find((x) => x.id === bills[1]!.id)!;
  assert(voided.status === 'void', 'owner void reached every phone');

  // 6. Server: op count and the Kafka → projector read model.
  const serverOps = Number(psql(`SELECT count(*) FROM ops WHERE shop_id = '${shop.id}'`));
  const localOps = (await owner.db.execute('SELECT count(*) AS n FROM op_log')).rows[0]!.n as number;
  assert(serverOps === localOps, `server holds the same ${serverOps} ops as each phone`);
  let projected = '';
  for (let i = 0; i < 50; i++) {
    projected = psql(`SELECT coalesce(sum(bills),0) || '/' || coalesce(sum(voids),0) || '/' || coalesce(sum(total_paise),0) FROM rm_daily_sales WHERE shop_id = '${shop.id}'`);
    if (projected.startsWith('40/1/')) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const live = (dumps[0]!.bill as { status: string; total_paise: number }[]).filter((x) => x.status !== 'void');
  const expected = `40/1/${live.reduce((s, x) => s + x.total_paise, 0)}`;
  assert(projected === expected, `projector read model: bills/voids/total = ${projected} (expected ${expected})`);
  const stock = psql(`SELECT item_id || '=' || qty_milli FROM rm_stock WHERE shop_id = '${shop.id}' ORDER BY item_id`).split('\n').join(' ');
  const localStock = (dumps[0]!.stock as { item_id: string; qty_milli: number }[]).map((s) => `${s.item_id}=${s.qty_milli}`).join(' ');
  assert(stock === localStock, `server stock read model matches phones: ${stock}`);

  console.log(`\nE2E OK in ${Math.round(performance.now() - t0)} ms; 3-phone convergence round (2×3 syncs, ${serverOps} ops) ${Math.round(syncMs)} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
