import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import PayScreen from '@/app/pay';
import { getDb } from '@/lib/db';
import { useCart } from '@/state/cart';
import { useSession } from '@/state/session';

const SOAP = { id: 'soap', name: 'Lux Soap 100g', hsn: '3401', unit: 'pcs' as const, sale_paise: 4500, mrp_paise: 4500, gst_bp: 1800, cess_bp: 0, price_incl_tax: 1, cost_paise: 3600 };

beforeEach(() => {
  useCart.getState().clear();
  useSession.getState().set({
    status: 'ready',
    shop: { id: 'shop-1', name: 'Sharma Kirana', gstin: '', stateCode: '09', upiVpa: 'sharma@okaxis' },
    device: { id: 'dev-a', prefix: 'A', role: 'owner' },
  });
  jest.clearAllMocks();
});

test('split cash + UPI with change, saved as a real bill', async () => {
  useCart.getState().add(SOAP, 2000); // 2 × ₹45 = ₹90
  await render(<PayScreen />);
  expect(screen.getByTestId('pay-due')).toHaveTextContent('₹90.00');
  await fireEvent.changeText(screen.getByTestId('pay-cash'), '50');
  expect(screen.getByTestId('pay-remaining')).toHaveTextContent('₹40.00 remaining');
  expect(screen.getByTestId('pay-confirm')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('pay-upi'), '40');
  expect(screen.getByTestId('pay-remaining')).toHaveTextContent('Fully paid');
  await fireEvent.changeText(screen.getByTestId('pay-tendered'), '100');
  expect(screen.getByTestId('pay-change')).toHaveTextContent('Change ₹50.00');

  await fireEvent.press(screen.getByTestId('pay-confirm'));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  const { params } = (router.replace as jest.Mock).mock.calls[0][0];
  expect(params.change).toBe('5000');
  expect(useCart.getState().lines).toHaveLength(0);

  const db = await getDb();
  const bill = (await db.execute<{ local_no: string; total_paise: number }>('SELECT local_no, total_paise FROM bill WHERE id = ?', [params.id])).rows[0];
  expect(bill).toEqual({ local_no: 'A-000001', total_paise: 9000 });
  const pays = (await db.execute<{ mode: string; amount_paise: number }>('SELECT mode, amount_paise FROM bill_payment WHERE bill_id = ? ORDER BY mode', [params.id])).rows;
  expect(pays).toEqual([{ mode: 'cash', amount_paise: 5000 }, { mode: 'upi', amount_paise: 4000 }]);
});

test('khata: credit to a new customer opens their ledger', async () => {
  useCart.getState().add(SOAP);
  await render(<PayScreen />);
  await fireEvent.press(screen.getByTestId('pay-only-credit'));
  await fireEvent.changeText(screen.getByTestId('pay-customer'), 'Ramesh');
  expect(await screen.findByText(/new khata will be opened/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('pay-confirm'));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  const db = await getDb();
  const row = (await db.execute<{ name: string; bal: number }>(
    `SELECT c.name, (SELECT SUM(amount_paise) FROM ledger_entry l WHERE l.customer_id = c.id) AS bal FROM customer c WHERE c.name = 'Ramesh'`,
  )).rows[0];
  expect(row).toEqual({ name: 'Ramesh', bal: 4500 });
});

test('over-payment is refused', async () => {
  useCart.getState().add(SOAP);
  await render(<PayScreen />);
  await fireEvent.changeText(screen.getByTestId('pay-upi'), '10');
  expect(screen.getByTestId('pay-remaining')).toHaveTextContent('Over by ₹10.00');
  expect(screen.getByTestId('pay-confirm')).toBeDisabled();
});
