/**
 * Component tests run the real SQL: `getDb()` is backed by better-sqlite3 (same schema, FTS5 and
 * repos as on device), only the op-sqlite/SQLCipher opener is swapped out.
 */
jest.mock('@/lib/db', () => {
  const { migrate, MIGRATIONS, upsertItems } = jest.requireActual('@dukaan/db');
  const { openNodeDb } = jest.requireActual('@dukaan/db/src/drivers/node');
  let db: Promise<unknown> | null = null;
  return {
    getDb: () =>
      (db ??= (async () => {
        const d = openNodeDb();
        await migrate(d, MIGRATIONS);
        await d.transaction((tx: never) => upsertItems(tx, [
          { id: 'salt', name: 'Tata Salt 1kg', salePaise: 2800, mrpPaise: 2800, gstBp: 0, hsn: '2501', costPaise: 2300, barcode: '8901058000016' },
          { id: 'rice', name: 'Basmati Rice (Loose)', unit: 'kg', salePaise: 12000, gstBp: 500, hsn: '1006', costPaise: 9800 },
          { id: 'soap', name: 'Lux Soap 100g', salePaise: 4500, gstBp: 1800, hsn: '3401', costPaise: 3600 },
        ]));
        return d;
      })()),
    __resetDb: () => { db = null; },
  };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
  Stack: { Screen: () => null },
}));

/** Native printer + HID scanner: tests drive the scanner callback directly and record printer writes.
 *  (No type annotations inside the factory: babel-plugin-jest-hoist reads type-param names as variable refs.) */
jest.mock('@dukaan/native', () => {
  const hid: any = { onScan: null, isActive: false };
  hid.start = (cb: any) => { hid.onScan = cb; hid.isActive = true; };
  hid.stop = () => { hid.onScan = null; hid.isActive = false; };
  const printer: any = { isEnabled: true, connectedAddress: undefined, writes: [] };
  printer.listPaired = jest.fn(async () => [{ address: 'AA:BB', name: 'MTP-II' }]);
  printer.connect = jest.fn(async (a: any) => { printer.connectedAddress = a; });
  printer.write = jest.fn(async (buf: any) => { printer.writes.push(new Uint8Array(buf)); });
  printer.disconnect = jest.fn(() => { printer.connectedAddress = undefined; });
  return { getHidScanner: () => hid, getPrinter: () => printer, __hid: hid, __printer: printer };
}, { virtual: true });

/** Camera: CodeScanner renders nothing; tests call the captured onBarcodeScanned with fake frames. */
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: jest.fn(async () => true) }),
}), { virtual: true });
jest.mock('react-native-vision-camera-barcode-scanner', () => {
  const cam: any = { props: null };
  return { CodeScanner: (p: any) => { cam.props = p; return null; }, __cam: cam };
}, { virtual: true });
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));
