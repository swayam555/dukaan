import { render, screen, waitFor } from '@testing-library/react-native';
import { act } from 'react';
import * as Haptics from 'expo-haptics';
import ScanScreen from '@/app/scan';
import { useCart } from '@/state/cart';

const { __cam: cam } = jest.requireMock('react-native-vision-camera-barcode-scanner');
const frame = (rawValue: string, format = 'ean-13') => [{ rawValue, format }];

beforeEach(() => { useCart.getState().clear(); jest.clearAllMocks(); });

test('continuous scan: a code in view for many frames adds once; unknown and misread codes are handled', async () => {
  await render(<ScanScreen />);
  expect(cam.props.isActive).toBe(true);

  // ~10 frames of the same packet in view → one line, qty 1
  await act(async () => { for (let i = 0; i < 10; i++) cam.props.onBarcodeScanned(frame('8901058000016')); });
  await waitFor(() => expect(screen.getByTestId('scan-total')).toHaveTextContent('1 items · ₹28.00'));
  expect(useCart.getState().lines[0].qtyMilli).toBe(1000);
  expect(screen.getByTestId('scan-last')).toHaveTextContent('+ Tata Salt 1kg');
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');

  // a misread (bad check digit) is ignored silently
  await act(async () => cam.props.onBarcodeScanned(frame('8901058000018')));
  expect(screen.getByTestId('scan-last')).toHaveTextContent('+ Tata Salt 1kg');

  // valid but unknown code → message + error haptic, cart unchanged
  await act(async () => cam.props.onBarcodeScanned(frame('8901030865237')));
  await waitFor(() => expect(screen.getByTestId('scan-last')).toHaveTextContent('Unknown barcode 8901030865237'));
  expect(useCart.getState().lines).toHaveLength(1);
});
