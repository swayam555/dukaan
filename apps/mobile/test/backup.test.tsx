import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { createCustomer, customerBalance, getShop } from '@dukaan/db';
import BackupScreen from '@/app/backup';
import SetupScreen from '@/app/setup';
import { getDb } from '@/lib/db';
import { getWriter } from '@/lib/writer';
import { useSession } from '@/state/session';
import { cartLine, freshShop, sell } from './fixtures';

/** In-memory expo-file-system (no type annotations inside the factory: jest-hoist). */
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
    create() { files.set(this.uri, new Uint8Array()); }
    delete() { files.delete(this.uri); }
    async write(b: any) { files.set(this.uri, new Uint8Array(b)); }
    async bytes() { return files.get(this.uri); }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } }, __files: files };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const files = (jest.requireMock('expo-file-system') as { __files: Map<string, Uint8Array> }).__files;
const picker = jest.requireMock('expo-document-picker') as { getDocumentAsync: jest.Mock };

test('owner backs up, the phone is wiped, and setup restores the same shop', async () => {
  await freshShop('owner');
  const db = await getDb();
  const ramesh = await createCustomer(db, await getWriter(), { name: 'Ramesh' });
  await sell([cartLine('rice', 2000)], { customerId: ramesh, mode: 'credit' }); // ₹240 on khata
  await sell([cartLine('soap', 1000)]);

  await render(<BackupScreen />);
  await fireEvent.changeText(screen.getByTestId('backup-pass'), 'chai-paani-2026');
  await fireEvent.changeText(screen.getByTestId('backup-pass2'), 'chai-paani-2025');
  expect(screen.getByText('Passphrases do not match')).toBeTruthy();
  expect(screen.getByTestId('backup-run')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('backup-pass2'), 'chai-paani-2026');
  await fireEvent.press(screen.getByTestId('backup-run'));
  expect(await screen.findByTestId('backup-notice', {}, { timeout: 5000 })).toHaveTextContent(/Backup ready: 3 entries/);
  const uri = (Sharing.shareAsync as jest.Mock).mock.calls[0][0] as string;
  expect(uri).toMatch(/^file:\/\/\/cache\/backups\/dukaan-\d{12}\.dukaan$/);
  const bytes = files.get(uri)!;
  screen.unmount();

  // New phone: empty database, no shop.
  (jest.requireMock('@/lib/db') as { __resetDb: () => void }).__resetDb();
  useSession.getState().set({ status: 'needs-setup', shop: null, device: null });
  expect(await getShop(await getDb())).toBeNull();
  picker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked/backup.dukaan', name: 'backup.dukaan' }] });
  files.set('file:///picked/backup.dukaan', bytes);

  await render(<SetupScreen />);
  await fireEvent.press(screen.getByTestId('setup-restore'));
  await fireEvent.press(screen.getByTestId('restore-pick'));
  expect(await screen.findByTestId('restore-header')).toHaveTextContent(/Sharma Kirana · .* · 3 entries/);
  await fireEvent.changeText(screen.getByTestId('restore-pass'), 'wrong-pass-123');
  await fireEvent.changeText(screen.getByTestId('setup-pin'), '2468');
  await fireEvent.changeText(screen.getByTestId('setup-pin2'), '2468');
  await fireEvent.press(screen.getByTestId('restore-submit'));
  expect(await screen.findByTestId('restore-error', {}, { timeout: 5000 })).toHaveTextContent('wrong passphrase, or the file was changed');

  await fireEvent.changeText(screen.getByTestId('restore-pass'), 'chai-paani-2026');
  await fireEvent.press(screen.getByTestId('restore-submit'));
  await waitFor(() => expect(useSession.getState().status).toBe('ready'), { timeout: 5000 });
  expect(useSession.getState().shop).toMatchObject({ name: 'Sharma Kirana' });
  const restored = await getDb();
  expect(await customerBalance(restored, ramesh)).toBe(24_000);
  expect((await restored.execute('SELECT local_no FROM bill ORDER BY local_no')).rows).toEqual([{ local_no: 'A-000001' }, { local_no: 'A-000002' }]);
});

test('cashier has no backup button', async () => {
  await freshShop('cashier');
  await render(<BackupScreen />);
  expect(await screen.findByText('Only the owner can make a backup.')).toBeTruthy();
});
