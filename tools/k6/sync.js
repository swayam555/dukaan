// k6 load test for the sync API: many shops, two phones each, pushing bill batches and pulling peers' ops.
//
//   docker compose up -d   (core stack only)
//   docker run --rm --network host -v "$PWD/tools/k6:/k6" grafana/k6:1.4.2 run /k6/sync.js
//
// Env: SYNC (default http://localhost:4780, through nginx), AUTH (default http://localhost:4781, straight to the API
// because nginx allows 10 auth requests/min per IP), SHOPS (50), RATE (pushes/s, 40), DURATION (2m), BATCH (ops per push, 12).
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const SYNC = __ENV.SYNC || 'http://localhost:4780';
const AUTH = __ENV.AUTH || 'http://localhost:4781';
const SHOPS = Number(__ENV.SHOPS || 50);
const RATE = Number(__ENV.RATE || 40);
const DURATION = __ENV.DURATION || '2m';
const BATCH = Number(__ENV.BATCH || 12);

export const options = {
  setupTimeout: '5m',
  scenarios: {
    push: { executor: 'constant-arrival-rate', exec: 'push', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 40, maxVUs: 200 },
    pull: { executor: 'constant-arrival-rate', exec: 'pull', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 40, maxVUs: 200 },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'push_ms': ['p(95)<250'],
    'pull_ms': ['p(95)<150'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pushMs = new Trend('push_ms', true);
const pullMs = new Trend('pull_ms', true);
const opsStored = new Counter('ops_stored');
const opsPulled = new Counter('ops_pulled');
const rejected = new Counter('ops_rejected');

const json = (body, token, deviceId) => ({
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId } : {}) },
});

export function setup() {
  const devices = [];
  const run = Date.now() % 1e6;
  for (let s = 0; s < SHOPS; s++) {
    const phone = `9${String(run).padStart(6, '0')}${String(s).padStart(3, '0')}`;
    const shop = { id: crypto.randomUUID(), name: `Load Kirana ${s}`, gstin: '', stateCode: '27' };
    const owner = { id: crypto.randomUUID(), name: 'Counter 1', prefix: 'A' };
    const otp = http.post(`${AUTH}/v1/auth/otp/request`, JSON.stringify({ phone }), json()).json('devOtp');
    const v = http.post(`${AUTH}/v1/auth/otp/verify`, JSON.stringify({ phone, otp, shop, device: owner }), json());
    if (!check(v, { 'owner registered': (r) => r.status === 200 })) throw new Error(`verify ${v.status} ${v.body}`);
    const ownerToken = v.json('token');
    devices.push({ shopId: shop.id, deviceId: owner.id, token: ownerToken });
    const pair = http.post(`${AUTH}/v1/pairing/token`, null, json(null, ownerToken, owner.id)).json('token');
    const cashier = { id: crypto.randomUUID(), name: 'Counter 2', prefix: 'B' };
    const c = http.post(`${AUTH}/v1/pairing/claim`, JSON.stringify({ token: pair, device: cashier }), json());
    if (!check(c, { 'cashier paired': (r) => r.status === 200 })) throw new Error(`claim ${c.status} ${c.body}`);
    devices.push({ shopId: shop.id, deviceId: cashier.id, token: c.json('token') });
  }
  return { devices };
}

let counter = 0;
const hlc = (deviceId) => `${String(Date.now()).padStart(15, '0')}:${String(counter++ % 10000).padStart(4, '0')}:${deviceId}`;
const day = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** One push = what a till sends after a few bills: bill.create (+ its ledger entry for khata sales). */
function batchFor(d) {
  const ops = [];
  while (ops.length < BATCH) {
    const billId = crypto.randomUUID();
    const total = 5000 + Math.floor(Math.random() * 90000);
    const lines = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, (_, i) => ({
      itemId: `item-${Math.floor(Math.random() * 5000)}`, name: `Item ${i}`, qtyMilli: 1000 * (1 + (i % 3)), unitPaise: 2500 + i * 700,
      gstBp: 500, hsn: '1006', taxablePaise: Math.round(total / 1.05 / 2), cgstPaise: Math.round(total * 0.012), sgstPaise: Math.round(total * 0.012),
    }));
    ops.push({
      opId: crypto.randomUUID(), shopId: d.shopId, deviceId: d.deviceId, entity: 'bill', entityId: billId, type: 'bill.create', hlc: hlc(d.deviceId),
      role: 'owner', payload: { day: day(), localNo: `X-${counter}`, lines, totalPaise: total, payments: [{ mode: 'cash', amountPaise: total }], customerId: null },
    });
    if (Math.random() < 0.25) {
      ops.push({
        opId: crypto.randomUUID(), shopId: d.shopId, deviceId: d.deviceId, entity: 'ledger', entityId: crypto.randomUUID(), type: 'ledger.add', hlc: hlc(d.deviceId),
        role: 'owner', payload: { kind: 'payment', customerId: 'c-1', amountPaise: 10000, mode: 'upi' },
      });
    }
  }
  return ops.slice(0, BATCH);
}

const pick = (data) => data.devices[exec.scenario.iterationInTest % data.devices.length];
const cursors = {};

export function push(data) {
  const d = pick(data);
  const r = http.post(`${SYNC}/v1/sync/push`, JSON.stringify({ ops: batchFor(d) }), { ...json(null, d.token, d.deviceId), tags: { name: 'push' } });
  if (check(r, { 'push 200': (x) => x.status === 200 })) {
    pushMs.add(r.timings.duration);
    opsStored.add(r.json('acks').length);
    rejected.add(r.json('rejects').length);
  }
}

export function pull(data) {
  const d = pick(data);
  const since = cursors[d.deviceId] || 0;
  const r = http.get(`${SYNC}/v1/sync/pull?since=${since}&limit=500`, { ...json(null, d.token, d.deviceId), tags: { name: 'pull' } });
  if (check(r, { 'pull 200': (x) => x.status === 200 })) {
    pullMs.add(r.timings.duration);
    opsPulled.add(r.json('ops').length);
    cursors[d.deviceId] = r.json('nextSeq');
  }
}
