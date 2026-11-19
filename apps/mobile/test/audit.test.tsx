import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { adjustStock, voidBill } from '@dukaan/db';
import AuditScreen from '@/app/audit';
import { getDb } from '@/lib/db';
import { getWriter } from '@/lib/writer';
import { cartLine, freshShop, sell } from './fixtures';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

test('owner sees voids, stock adjustments and refused peer ops; filters narrow the list', async () => {
  await freshShop('owner');
  const db = await getDb();
  const w = await getWriter();
  const bill = await sell([cartLine('soap', 1000)]);
  await voidBill(db, w, bill.id, 'wrong item');
  await adjustStock(db, w, { itemId: 'salt', deltaMilli: -2000, reason: 'damage', note: 'wet' });
  const raw = { opId: 'peer-1', deviceId: 'dev-x', entity: 'ledger', entityId: 'l9', type: 'ledger.add', hlc: `${String(Date.now() + 5).padStart(15, '0')}:0000:dev-x`, role: 'cashier', payload: { kind: 'opening', amountPaise: 99_900 } };
  await db.execute('INSERT INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)', ['peer-1', JSON.stringify(raw), 'ledger opening needs the owner role', Date.now()]);

  await render(<AuditScreen />);
  expect(await screen.findByText('Voided bill A-000001: wrong item')).toBeTruthy();
  expect(screen.getByText('Removed 2 pcs Tata Salt 1kg (damage) · wet')).toBeTruthy();
  expect(screen.getByText('Refused ledger.add from a cashier device')).toBeTruthy();
  expect(screen.getByText('ledger opening needs the owner role')).toBeTruthy();
  expect(screen.getAllByText('not synced')).toHaveLength(2);

  await fireEvent.press(screen.getByTestId('audit-filter-stock'));
  await waitFor(() => expect(screen.queryByText('Voided bill A-000001: wrong item')).toBeNull());
  expect(screen.getByText(/Tata Salt 1kg/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('audit-filter-price'));
  expect(await screen.findByTestId('audit-empty')).toBeTruthy();
});

test('cashier cannot open the audit log', async () => {
  await freshShop('cashier');
  await render(<AuditScreen />);
  expect(await screen.findByText('Only the owner can see the audit log.')).toBeTruthy();
});
