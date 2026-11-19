import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { act } from 'react';
import { router } from 'expo-router';
import BillingScreen from '@/app/(main)/billing';
import { useCart } from '@/state/cart';
import { useSession } from '@/state/session';

beforeEach(() => {
  useCart.getState().clear();
  useSession.getState().set({
    status: 'ready',
    shop: { id: 'shop-1', name: 'Sharma Kirana', gstin: '', stateCode: '09', upiVpa: 'sharma@okaxis' },
    device: { id: 'dev-a', prefix: 'A', role: 'owner' },
  });
  jest.clearAllMocks();
});

test('search → tap adds a packaged item and the footer total updates', async () => {
  await render(<BillingScreen />);
  await fireEvent.changeText(screen.getByTestId('billing-search'), 'salt');
  await fireEvent.press(await screen.findByTestId('item-salt'));
  await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹28.00'));
  expect(screen.getByTestId('cart-salt')).toBeTruthy();
});

test('picking a loose item opens the weight editor and blocks checkout until weighed', async () => {
  await render(<BillingScreen />);
  await fireEvent.changeText(screen.getByTestId('billing-search'), 'basmati');
  await fireEvent.press(await screen.findByTestId('item-rice'));
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/line/[key]' }));
  expect(await screen.findByText(/enter quantity/i)).toBeTruthy();
  expect(screen.getByTestId('billing-charge')).toBeDisabled();
});

test('keyboard-wedge fallback: barcode typed into search + Enter adds the item', async () => {
  await render(<BillingScreen />);
  const input = screen.getByTestId('billing-search');
  await fireEvent.changeText(input, '8901058000016');
  await fireEvent(input, 'submitEditing');
  await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹28.00'));
});

test('hold parks the bill; tapping the chip resumes it', async () => {
  useCart.getState().add({ id: 'soap', name: 'Lux Soap 100g', hsn: '3401', unit: 'pcs', sale_paise: 4500, mrp_paise: 4500, gst_bp: 1800, cess_bp: 0, price_incl_tax: 1, cost_paise: 3600 });
  await render(<BillingScreen />);
  await fireEvent.press(screen.getByTestId('billing-hold'));
  expect(useCart.getState().lines).toHaveLength(0);
  const chip = await screen.findByText(/1 items · ₹45.00/);
  await fireEvent.press(chip);
  await waitFor(() => expect(useCart.getState().lines.map((l) => l.itemId)).toEqual(['soap']));
});

test('native HID scanner: a captured burst adds by barcode; unknown codes are reported; stops on unmount', async () => {
  const { __hid: hid } = jest.requireMock('@dukaan/native');
  const view = await render(<BillingScreen />);
  expect(hid.isActive).toBe(true);
  await act(async () => hid.onScan('8901058000016', 38));
  await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹28.00'));
  await act(async () => hid.onScan('8901058000016', 41));
  await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹56.00'));
  await act(async () => hid.onScan('0000000000000', 40));
  expect(await screen.findByTestId('billing-scan-msg')).toHaveTextContent('No item with barcode 0000000000000');
  await view.unmount();
  expect(hid.isActive).toBe(false);
});
