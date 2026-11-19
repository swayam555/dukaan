import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createShop, getMeta } from '@dukaan/db';
import ImportScreen from '@/app/import';
import { getDb } from '@/lib/db';
import { loadActiveImport, pickCsv, runImport } from '@/lib/csv-import';
import { resetWriter } from '@/lib/writer';
import { useSession } from '@/state/session';

/** expo-file-system's File/Directory/FileHandle over an in-memory byte map. (No type annotations: jest-hoist.) */
jest.mock('expo-file-system', () => {
  const files = new Map();
  class Directory {
    constructor(base: any, name: any) { (this as any).uri = `${base.uri}/${name}`; }
    get exists() { return true; }
    create() {}
  }
  class File {
    uri: any;
    constructor(a: any, b?: any) { this.uri = b === undefined ? a : `${a.uri}/${b}`; }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri).length; }
    async copy(dest: any) { files.set(dest.uri, files.get(this.uri)); }
    delete() { files.delete(this.uri); }
    open() {
      const bytes = files.get(this.uri);
      return { offset: 0, async readBytes(n: any) { const b = bytes.slice(this.offset, this.offset + n); this.offset += b.length; return b; }, close() {} };
    }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///doc' } }, __files: files };
});

const picked = { uri: 'file:///cache/items.csv', name: 'items.csv' };
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [picked] })),
}));

const files = (jest.requireMock('expo-file-system') as { __files: Map<string, Uint8Array> }).__files;
const putCsv = (text: string) => files.set(picked.uri, new TextEncoder().encode(text));
const count = async (sql: string) => ((await (await getDb()).execute(sql)).rows[0] as { n: number }).n;

function catalogueCsv(rows: number): string {
  const out = ['Item Name,Barcode,MRP,Sale Price,GST %,Opening Stock'];
  for (let i = 1; i <= rows; i++) {
    out.push(i === 7 ? 'Broken row,,abc,,18,1' : `Item ${i},89000${String(i).padStart(8, '0')},${(i % 90) + 10},${(i % 90) + 9},${i % 2 ? 5 : 18},${i % 13}`);
  }
  return out.join('\n') + '\n';
}

async function ownerShop(role: 'owner' | 'cashier' = 'owner') {
  (jest.requireMock('@/lib/db') as { __resetDb: () => void }).__resetDb();
  resetWriter();
  files.clear();
  const { shop, device } = await createShop(await getDb(), {
    name: 'Import Kirana', gstin: '', stateCode: '27', address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '',
    prefix: 'A', pinHash: 'x', pinLength: 4, deviceName: 'Owner',
  });
  useSession.getState().set({ status: 'ready', shop: { ...shop }, device: { id: device.id, prefix: 'A', role } });
}

test('a killed import resumes from the checkpoint and finishes without duplicates', async () => {
  await ownerShop();
  putCsv(catalogueCsv(2500));
  const base = await count('SELECT count(*) AS n FROM item');

  // first run is cut short after one batch, like the app being killed mid-import
  const active = (await pickCsv())!;
  let batches = 0;
  const first = await runImport(active, { onProgress: () => { batches++; }, shouldStop: () => batches >= 1 });
  expect(first.status).toBe('stopped');
  expect(first.errors).toEqual([{ row: 7, error: expect.stringMatching(/rupee amount/) }]);
  expect(await count('SELECT count(*) AS n FROM item')).toBe(base + first.progress.rowsDone);
  expect(await loadActiveImport()).toMatchObject({ jobId: active.jobId, name: 'items.csv' });

  // reopening the screen offers to resume
  await render(<ImportScreen />);
  await waitFor(() => expect(screen.getByTestId('import-resume-card')).toHaveTextContent(/items\.csv/));
  await fireEvent.press(screen.getByTestId('import-resume'));
  await waitFor(() => expect(screen.getByTestId('import-done-text')).toHaveTextContent('2,499 items imported · 1 rows skipped'));

  expect(await count('SELECT count(*) AS n FROM item')).toBe(base + 2499);
  expect(await count("SELECT count(DISTINCT barcode) AS n FROM item WHERE barcode LIKE '89000%'")).toBe(2499);
  expect(await count("SELECT count(*) AS n FROM op_log WHERE type = 'item.bulk'")).toBeGreaterThanOrEqual(3); // one op per batch, syncs like any edit
  expect(await getMeta(await getDb(), 'import.active')).toBeNull();
  expect([...files.keys()]).toEqual([picked.uri]); // the app's working copy is cleaned up
});

test('a CSV without a price column is refused with a clear message', async () => {
  await ownerShop();
  putCsv('Item Name,Barcode\nSugar,123\n');
  await render(<ImportScreen />);
  await fireEvent.press(screen.getByTestId('import-choose'));
  await waitFor(() => expect(screen.getByTestId('import-error')).toHaveTextContent(/name column and a price or MRP column/));
});

test('cashiers cannot import', async () => {
  await ownerShop('cashier');
  await render(<ImportScreen />);
  expect(screen.getByTestId('import-owner-only')).toBeTruthy();
  expect(screen.queryByTestId('import-choose')).toBeNull();
});
