import { render, screen } from '@testing-library/react-native';
import DiagnosticsScreen from '@/app/diagnostics';
import { getDb } from '@/lib/db';
import { cartLine, freshShop, sell } from './fixtures';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

test('diagnostics shows pending, rejected and refused sync counts', async () => {
  await freshShop('owner');
  await sell([cartLine('soap', 1000)]);
  await sell([cartLine('rice', 1000)]);
  const db = await getDb();
  const { rows } = await db.execute<{ op_id: string }>('SELECT op_id FROM op_log ORDER BY hlc LIMIT 1');
  await db.execute('UPDATE op_log SET server_seq = -1 WHERE op_id = ?', [rows[0]!.op_id]);
  await db.execute('INSERT INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)', ['peer-1', '{}', 'bad op', Date.now()]);
  await db.execute("INSERT INTO sync_state(key, value) VALUES ('pull_seq', '42') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const total = (await db.execute<{ n: number }>('SELECT count(*) AS n FROM op_log')).rows[0]!.n;

  await render(<DiagnosticsScreen />);
  expect(await screen.findByText(`Changes in the log: ${total}`)).toBeTruthy();
  expect(screen.getByText(`Waiting to send: ${total - 1}`)).toBeTruthy();
  expect(screen.getByText('Rejected by the server: 1')).toBeTruthy();
  expect(screen.getByText('Refused from other phones: 1')).toBeTruthy();
  expect(screen.getByText('Server position: 42')).toBeTruthy();
});
