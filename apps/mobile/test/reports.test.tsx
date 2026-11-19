import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { createCustomer, updateCustomer } from '@dukaan/db';
import ReportsScreen from '@/app/reports';
import { getDb } from '@/lib/db';
import { rangeFor } from '@/lib/ranges';
import { getWriter } from '@/lib/writer';
import { cartLine, freshShop, sell } from './fixtures';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/ui/BarChart', () => ({ BarChart: (p: any) => { (globalThis as any).__bars = p.bars; return null; } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system', () => {
  const files = new Map();
  class Directory {
    uri: any;
    constructor(base: any, name: any) { this.uri = `${base.uri}/${name}`; }
    get exists() { return true; }
    create() {}
  }
  class File {
    uri: any;
    constructor(a: any, b?: any) { this.uri = b === undefined ? a : `${a.uri}/${b}`; }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, ''); }
    write(s: any) { files.set(this.uri, s); }
    delete() { files.delete(this.uri); }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } }, __files: files };
});

test('date presets', () => {
  expect(rangeFor('7d', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  expect(rangeFor('month', '2026-03-03')).toEqual({ from: '2026-03-01', to: '2026-03-03' });
  expect(rangeFor('lastMonth', '2026-03-03')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  expect(rangeFor('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
});

test('summary, modes, top items, chart series and GSTR-1 CSV share', async () => {
  await freshShop('owner');
  const db = await getDb();
  const w = await getWriter();
  const b2b = await createCustomer(db, w, { name: 'Hotel Annapurna' });
  await updateCustomer(db, w, b2b, { gstin: '27AAPFU0939F1ZV' });
  await sell([cartLine('salt', 2000)]);                         // ₹56 cash
  await sell([cartLine('rice', 1500)], { mode: 'upi' });        // ₹180 upi
  await sell([cartLine('soap', 1000)], { customerId: b2b, mode: 'credit' }); // ₹45 B2B on credit

  await render(<ReportsScreen />);
  await fireEvent.press(screen.getByTestId('range-today'));
  await waitFor(() => expect(screen.getByTestId('rep-sales')).toHaveTextContent('₹281.00'));
  expect(screen.getByTestId('rep-bills')).toHaveTextContent('3');
  expect(screen.getByTestId('mode-upi')).toHaveTextContent(/UPI · 1 bills/);
  expect(screen.getByTestId('top-rice')).toHaveTextContent(/Basmati Rice/);

  await fireEvent.press(screen.getByTestId('range-7d'));
  await waitFor(() => expect((globalThis as any).__bars).toHaveLength(7));
  expect((globalThis as any).__bars[6].value).toBe(28_100);

  expect(await screen.findByText('B2B invoices · 1 rows')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('gstr1-b2b'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  const [uri] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/cache\/gstr1_\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d\/b2b\.csv$/);
  const csv = (jest.requireMock('expo-file-system') as { __files: Map<string, string> }).__files.get(uri)!;
  expect(csv.split('\n')[0]).toContain('GSTIN/UIN of Recipient');
  expect(csv).toContain('27AAPFU0939F1ZV');
  expect(screen.getByTestId('gstr1-notice')).toHaveTextContent('b2b.csv shared (1 rows)');
});

test('cashier sees sales but not profit or GST export', async () => {
  await freshShop('cashier');
  await render(<ReportsScreen />);
  expect(await screen.findByTestId('rep-sales')).toBeTruthy();
  expect(screen.queryByTestId('rep-profit')).toBeNull();
  expect(screen.queryByTestId('gstr1-b2b')).toBeNull();
});
