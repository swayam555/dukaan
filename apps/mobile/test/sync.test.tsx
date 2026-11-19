import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createShop, getDevice, getMeta, getShop, MemorySyncServer, type Role } from '@dukaan/db';
import SetupScreen from '@/app/setup';
import { getDb } from '@/lib/db';
import { startSync, stopSync, syncNow, useSync } from '@/lib/sync';
import { getWriter, resetWriter } from '@/lib/writer';
import { useSession } from '@/state/session';
import { SyncCard } from '@/ui/SyncCard';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
    __store: store,
  };
});

/** A fetch that answers like services/sync, backed by the in-memory reference server. */
const server = new MemorySyncServer('shop-owner');
const devices: Record<string, { deviceId: string; role: Role }> = {};
const calls: { path: string; body: any; auth?: string }[] = [];
const respond = (status: number, j?: unknown) => new Response(j === undefined ? null : JSON.stringify(j), { status });

beforeAll(() => {
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string>).Authorization?.slice(7);
    calls.push({ path: u.pathname, body, auth });
    switch (u.pathname) {
      case '/v1/auth/otp/request': return respond(200, { sent: true, devOtp: '123456' });
      case '/v1/auth/otp/verify':
        if (body.otp !== '123456') return respond(401, { error: 'otp_invalid', message: 'wrong or expired code' });
        devices['jwt-owner'] = { deviceId: body.device.id, role: 'owner' };
        return respond(200, { token: 'jwt-owner', shopId: body.shop.id, role: 'owner' });
      case '/v1/pairing/claim':
        if (body.token !== 'PAIR-CODE-1') return respond(401, { error: 'unauthorized', message: 'pairing token expired or already used' });
        devices['jwt-cashier'] = { deviceId: body.device.id, role: 'cashier' };
        return respond(200, { token: 'jwt-cashier', shopId: 'shop-owner', shopName: 'Sharma Kirana', gstin: '', stateCode: '27', role: 'cashier' });
    }
    const dev = auth ? devices[auth] : undefined;
    if (!dev) return respond(401, { error: 'unauthorized', message: 'bad token' });
    if (u.pathname === '/v1/sync/push') return respond(200, server.push(dev, body.ops));
    if (u.pathname === '/v1/sync/pull') return respond(200, server.pull(Number(u.searchParams.get('since')), Number(u.searchParams.get('limit'))));
    if (u.pathname === '/v1/sync/ack') { server.ack(dev.deviceId, body.seq); return respond(204); }
    if (u.pathname === '/v1/pairing/token') return respond(200, { token: 'PAIR-CODE-1', expiresInSec: 300 });
    return respond(404);
  }) as unknown as typeof fetch;
});

afterEach(() => stopSync());

test('a counter phone joins with a pairing code and pushes its bill-ready writes', async () => {
  useSession.getState().set({ status: 'needs-setup', shop: null, device: null });
  await render(<SetupScreen />);
  await fireEvent.press(screen.getByTestId('setup-join'));
  await fireEvent.changeText(screen.getByTestId('join-url'), 'http://sync.test');
  await fireEvent.changeText(screen.getByTestId('join-code'), 'WRONG-CODE');
  await fireEvent.changeText(screen.getByTestId('setup-pin'), '2468');
  await fireEvent.changeText(screen.getByTestId('setup-pin2'), '2468');
  await fireEvent.press(screen.getByTestId('join-submit'));
  await waitFor(() => expect(screen.getByTestId('join-error')).toHaveTextContent('pairing token expired or already used'));
  expect(await getShop(await getDb())).toBeNull();

  await fireEvent.changeText(screen.getByTestId('join-code'), 'PAIR-CODE-1');
  await fireEvent.press(screen.getByTestId('join-submit'));
  await waitFor(() => expect(useSession.getState().status).toBe('ready'));
  const db = await getDb();
  expect(await getShop(db)).toMatchObject({ id: 'shop-owner', name: 'Sharma Kirana', stateCode: '27' });
  expect(await getDevice(db)).toMatchObject({ role: 'cashier', prefix: 'C2' });
  expect(calls.find((c) => c.path === '/v1/pairing/claim')!.body.device).toMatchObject({ prefix: 'C2', name: 'Counter C2' });
  expect(await getMeta(db, 'sync')).toMatchObject({ url: 'http://sync.test', phone: null });

  // the counter phone's writes reach the server under its token
  await startSync();
  const writer = await getWriter();
  await writer.write(db, [{ type: 'customer.upsert', entity: 'customer', entityId: 'cust-1', payload: { name: 'Ramesh', phone: '9876500000' } }]);
  await act(() => syncNow());
  expect(server.pull(0, 100).ops.map((o) => o.type)).toContain('customer.upsert');
  expect(useSync.getState()).toMatchObject({ pending: 0, lastError: null });

  await render(<SyncCard />);
  expect(screen.getByTestId('sync-status')).toHaveTextContent(/0 waiting to upload/);
  expect(screen.queryByTestId('sync-pair')).toBeNull(); // cashiers cannot add phones
});

test('owner connects an offline shop with OTP, then gets a pairing code', async () => {
  const mock = jest.requireMock('@/lib/db') as { __resetDb: () => void };
  mock.__resetDb();
  resetWriter();
  useSync.getState().set({ config: null, state: 'off', lastOkAt: null, lastError: null, pending: 0 });
  const db = await getDb();
  const { shop, device } = await createShop(db, {
    name: 'Gupta Store', gstin: '', stateCode: '09', address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '',
    prefix: 'G1', pinHash: 'x', pinLength: 4, deviceName: 'Counter 1',
  });
  useSession.getState().set({ status: 'ready', shop: { ...shop }, device: { id: device.id, prefix: 'G1', role: 'owner' } });

  await render(<SyncCard />);
  await fireEvent.changeText(screen.getByTestId('sync-url'), 'http://sync.test');
  await fireEvent.changeText(screen.getByTestId('sync-phone'), '98765 43210');
  await fireEvent.press(screen.getByTestId('sync-send'));
  await waitFor(() => expect(screen.getByTestId('sync-otp').props.value).toBe('123456')); // dev OTP prefilled
  await fireEvent.changeText(screen.getByTestId('sync-otp'), '000000');
  await fireEvent.press(screen.getByTestId('sync-connect'));
  await waitFor(() => expect(screen.getByTestId('sync-error')).toHaveTextContent('wrong or expired code'));

  await fireEvent.changeText(screen.getByTestId('sync-otp'), '123456');
  await fireEvent.press(screen.getByTestId('sync-connect'));
  await waitFor(() => expect(screen.getByTestId('sync-status')).toBeTruthy());
  const verify = calls.filter((c) => c.path === '/v1/auth/otp/verify').at(-1)!;
  expect(verify.body).toMatchObject({ shop: { id: shop.id, name: 'Gupta Store', stateCode: '09' }, device: { id: device.id, prefix: 'G1' } });
  expect(verify.auth).toBeUndefined();

  await fireEvent.press(screen.getByTestId('sync-pair'));
  await waitFor(() => expect(screen.getByTestId('sync-pair-code')).toHaveTextContent('PAIR-CODE-1'));
  expect(calls.find((c) => c.path === '/v1/pairing/token')!.auth).toBe('jwt-owner');
});
