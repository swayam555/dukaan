import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { createCustomer, lastReminded } from '@dukaan/db';
import KhataScreen from '@/app/(main)/khata';
import CustomerScreen from '@/app/customer/[id]';
import { getDb } from '@/lib/db';
import { getWriter } from '@/lib/writer';
import { cartLine, freshShop, sell } from './fixtures';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///cache/statement.pdf' })) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }));

beforeEach(async () => {
  jest.clearAllMocks();
  await freshShop('owner', { upiVpa: 'sharma@okaxis' });
});

test('khata list: total due, due filter, search and add customer', async () => {
  const db = await getDb();
  const w = await getWriter();
  const ramesh = await createCustomer(db, w, { name: 'Ramesh', phone: '9876543210' });
  await createCustomer(db, w, { name: 'Suresh' });
  await sell([cartLine('soap', 2000)], { customerId: ramesh, mode: 'credit' }); // ₹90 on khata

  await render(<KhataScreen />);
  expect(await screen.findByTestId('khata-total')).toHaveTextContent('₹90.00');
  expect(screen.getByTestId('khata-count')).toHaveTextContent('1 customers');
  expect(screen.getByTestId(`khata-${ramesh}`)).toBeTruthy();
  expect(screen.queryByText('Suresh')).toBeNull(); // "owes money" filter is the default

  await fireEvent.press(screen.getByTestId('khata-filter-all'));
  expect(await screen.findByText('Suresh')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('khata-search'), '98765');
  await waitFor(() => expect(screen.queryByText('Suresh')).toBeNull());
  expect(screen.getByText('Ramesh')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('khata-add'));
  await fireEvent.changeText(screen.getByTestId('khata-name'), 'Geeta');
  await fireEvent.changeText(screen.getByTestId('khata-phone'), '12345');
  await fireEvent.press(screen.getByTestId('khata-save'));
  expect(await screen.findByText('Phone must be 10 digits')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('khata-phone'), '91234 56789');
  await fireEvent.press(screen.getByTestId('khata-save'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/customer/[id]' })));
  const row = (await db.execute<{ phone: string }>("SELECT phone FROM customer WHERE name = 'Geeta'")).rows[0];
  expect(row).toEqual({ phone: '9123456789' });
});

test('customer ledger: payment, opening balance, WhatsApp reminder, statement PDF', async () => {
  const db = await getDb();
  const id = await createCustomer(db, await getWriter(), { name: 'Ramesh', phone: '9876543210' });
  await sell([cartLine('soap', 2000)], { customerId: id, mode: 'credit' }); // +₹90
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

  await render(<CustomerScreen />);
  expect(await screen.findByTestId('cust-balance')).toHaveTextContent('₹90.00');

  await fireEvent.press(screen.getByTestId('cust-pay'));
  await fireEvent.changeText(screen.getByTestId('cust-amount'), '40');
  await fireEvent.press(screen.getByTestId('cust-mode-upi'));
  await fireEvent.press(screen.getByTestId('cust-save'));
  await waitFor(() => expect(screen.getByTestId('cust-balance')).toHaveTextContent('₹50.00'));
  expect(screen.getByTestId('cust-notice')).toHaveTextContent('Received ₹40.00 (UPI)');

  await fireEvent.press(screen.getByTestId('cust-opening'));
  await fireEvent.changeText(screen.getByTestId('cust-amount'), '150');
  await fireEvent.changeText(screen.getByTestId('cust-note'), 'old diary');
  await fireEvent.press(screen.getByTestId('cust-save'));
  await waitFor(() => expect(screen.getByTestId('cust-balance')).toHaveTextContent('₹200.00'));
  expect(screen.getByText(/Opening balance · old diary/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('cust-remind'));
  await waitFor(() => expect(open).toHaveBeenCalled());
  const url = open.mock.calls[0]![0];
  expect(url.startsWith('https://wa.me/919876543210?text=')).toBe(true);
  const text = decodeURIComponent(url.split('text=')[1]!);
  expect(text).toContain('₹200.00 baaki hai');
  expect(text).toContain('upi://pay?pa=sharma@okaxis');
  expect(await lastReminded(db, id)).not.toBeNull();

  await fireEvent.press(screen.getByTestId('cust-statement'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/statement.pdf', expect.objectContaining({ mimeType: 'application/pdf' })));
  const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
  expect(html).toContain('Amount due: ₹200.00');
  expect(html).toContain('Payment received · UPI');
});

test('cashier cannot add an opening balance', async () => {
  await freshShop('cashier');
  const id = await createCustomer(await getDb(), await getWriter(), { name: 'Ramesh' });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id });
  await render(<CustomerScreen />);
  expect(await screen.findByTestId('cust-pay')).toBeTruthy();
  expect(screen.queryByTestId('cust-opening')).toBeNull();
  expect(screen.getByTestId('cust-remind')).toBeDisabled();
});
