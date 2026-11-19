import { HlcClock } from '@dukaan/core';
import {
  AuthError, HttpTransport, SyncApi, MemorySyncServer, migrate, MIGRATIONS, OpWriter, RequestError, SyncEngine, TransportError, upsertItems,
  type Role,
} from '../src';
import { openNodeDb } from '../src/drivers/node';
import { ITEMS } from './helpers';

/** A fetch that speaks the Spring service's wire contract, backed by the in-memory server. */
function fakeFetch(server: MemorySyncServer, tokens: Record<string, { deviceId: string; role: Role }>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url, body });
    const auth = (init.headers as Record<string, string>).Authorization?.replace('Bearer ', '') ?? '';
    const dev = tokens[auth];
    const json = (status: number, j?: unknown) => new Response(j === undefined ? null : JSON.stringify(j), { status });
    if (!dev) return json(401, { error: 'unauthorized' });
    const u = new URL(url);
    if (u.pathname === '/v1/sync/push') {
      if (body.ops.length > 500) return json(400, { error: 'batch_too_large' });
      return json(200, server.push(dev, body.ops));
    }
    if (u.pathname === '/v1/sync/pull') return json(200, server.pull(Number(u.searchParams.get('since')), Number(u.searchParams.get('limit'))));
    if (u.pathname === '/v1/sync/ack') { server.ack(dev.deviceId, body.seq); return json(204); }
    return json(404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function device(id: string, role: Role, server: MemorySyncServer, fetchFn: typeof fetch, token = `tok-${id}`) {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  await db.transaction((tx) => upsertItems(tx, ITEMS));
  const clock = new HlcClock(id);
  const writer = new OpWriter({ shopId: server.shopId, deviceId: id, role }, clock);
  const transport = new HttpTransport({ baseUrl: 'http://sync.test/', token: () => token, fetch: fetchFn });
  const engine = new SyncEngine(db, transport, clock, { shopId: server.shopId, deviceId: id }, { timers: { set: () => 0, clear: () => undefined } });
  return { db, writer, engine, transport };
}

describe('HttpTransport', () => {
  test('two devices converge through the HTTP wire contract', async () => {
    const server = new MemorySyncServer('shop-1');
    const { fn, calls } = fakeFetch(server, { 'tok-a': { deviceId: 'a', role: 'owner' }, 'tok-b': { deviceId: 'b', role: 'cashier' } });
    const a = await device('a', 'owner', server, fn);
    const b = await device('b', 'cashier', server, fn);
    await a.writer.write(a.db, [{ type: 'item.upsert', entity: 'item', entityId: 'salt', payload: { salePaise: 3100 } }]);
    const ra = await a.engine.sync();
    expect(ra.pushed).toBe(1);
    const rb = await b.engine.sync();
    expect(rb.applied).toBeGreaterThanOrEqual(1);
    const { rows } = await b.db.execute<{ sale_paise: number }>('SELECT sale_paise FROM item WHERE id = ?', ['salt']);
    expect(rows[0]!.sale_paise).toBe(3100);
    // wire shape: no double slash, auth header, ack body
    expect(calls.every((c) => c.url.startsWith('http://sync.test/v1/sync/'))).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/ack'))?.body).toEqual({ seq: expect.any(Number) });
  });

  test('a demoted device\'s owner-only op comes back as a reject, not an error', async () => {
    const server = new MemorySyncServer('shop-1');
    // locally still thinks it is owner; the server knows it as a cashier
    const { fn } = fakeFetch(server, { 'tok-b': { deviceId: 'b', role: 'cashier' } });
    const b = await device('b', 'owner', server, fn);
    await b.writer.write(b.db, [{ type: 'stock.adjust', entity: 'stock', entityId: 'salt',
      payload: { itemId: 'salt', batchId: '', deltaMilli: 1000, reason: 'count', note: '', createdAt: Date.now() } }]);
    const r = await b.engine.sync();
    expect(r.rejected).toBe(1);
  });

  test('error mapping: network/timeout/5xx → TransportError, 401 → AuthError, 400 → RequestError', async () => {
    const mk = (f: () => Promise<Response>, timeoutMs?: number) =>
      new HttpTransport({ baseUrl: 'http://x', token: () => 't', fetch: f as unknown as typeof fetch, timeoutMs });
    await expect(mk(async () => { throw new TypeError('Network request failed'); }).pull(0, 10)).rejects.toBeInstanceOf(TransportError);
    await expect(mk(async () => new Response('', { status: 503 })).pull(0, 10)).rejects.toBeInstanceOf(TransportError);
    await expect(mk(async () => new Response('', { status: 429 })).pull(0, 10)).rejects.toBeInstanceOf(TransportError);
    await expect(mk(async () => new Response('', { status: 401 })).pull(0, 10)).rejects.toBeInstanceOf(AuthError);
    const bad = mk(async () => new Response(JSON.stringify({ error: 'batch_too_large' }), { status: 400 })).push([]);
    await expect(bad).rejects.toBeInstanceOf(RequestError);
    await expect(bad).rejects.toMatchObject({ status: 400, code: 'batch_too_large' });
    const hang = (_u: unknown, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(mk(hang as never, 20).pull(0, 10)).rejects.toThrow(/timeout after 20 ms/);
    const noTok = new HttpTransport({ baseUrl: 'http://x', token: () => null, fetch: (async () => new Response('{}')) as unknown as typeof fetch });
    await expect(noTok.ack(1)).rejects.toBeInstanceOf(AuthError);
  });

  test('engine backs off on 5xx and recovers on the next run', async () => {
    const server = new MemorySyncServer('shop-1');
    const { fn } = fakeFetch(server, { 'tok-a': { deviceId: 'a', role: 'owner' } });
    let down = true;
    const flaky = (async (u: string, i: RequestInit) => (down ? new Response('', { status: 502 }) : fn(u, i))) as unknown as typeof fetch;
    const a = await device('a', 'owner', server, flaky);
    await a.writer.write(a.db, [{ type: 'item.upsert', entity: 'item', entityId: 'rice', payload: { salePaise: 12500 } }]);
    await expect(a.engine.sync()).rejects.toBeInstanceOf(TransportError);
    expect(a.engine.state).toBe('backoff');
    down = false;
    expect((await a.engine.sync()).pushed).toBe(1);
    expect(a.engine.state).toBe('idle');
  });

  test('SyncApi: OTP and claim go unauthenticated, pairing carries the owner token, errors keep the server message', async () => {
    const seen: { url: string; auth?: string; body?: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      seen.push({ url, auth: h.Authorization, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/claim')) return new Response(JSON.stringify({ error: 'device_exists', message: 'bill prefix C2 already used' }), { status: 409 });
      if (url.endsWith('/verify')) return new Response(JSON.stringify({ error: 'otp_invalid', message: 'wrong code' }), { status: 401 });
      return new Response(JSON.stringify({ token: 'p', expiresInSec: 300, sent: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new SyncApi({ baseUrl: 'http://s', token: () => 'owner-jwt', fetch: f });
    await api.requestOtp('9876543210');
    expect(seen[0]!.auth).toBeUndefined();
    await expect(api.verifyOtp('9876543210', '000000', { id: 's', name: 'n', gstin: '', stateCode: '27' }, { id: 'd', name: 'x', prefix: 'C1' }))
      .rejects.toThrow('wrong code');
    expect((await api.createPairing()).token).toBe('p');
    expect(seen[2]!.auth).toBe('Bearer owner-jwt');
    await expect(api.claimPairing(' abc ', { id: 'd2', name: 'y', prefix: 'C2' })).rejects.toMatchObject({ status: 409, code: 'device_exists', message: 'bill prefix C2 already used' });
    expect(seen[3]!.body).toMatchObject({ token: 'abc' });
  });
});
