import { fireEvent, render, screen } from '@testing-library/react-native';
import ScanScreen from '@/app/scan';

const mockRequest = jest.fn(async () => false);
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => ({ hasPermission: false, requestPermission: mockRequest }) }), { virtual: true });
jest.mock('react-native-vision-camera-barcode-scanner', () => ({ CodeScanner: () => null }), { virtual: true });
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

test('explains the camera before asking, and points to Settings after a refusal', async () => {
  await render(<ScanScreen />);
  expect(screen.getByTestId('scan-rationale')).toHaveTextContent(/only on this screen/);
  expect(mockRequest).not.toHaveBeenCalled(); // no system dialog until the owner taps
  await fireEvent.press(screen.getByTestId('scan-allow'));
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(await screen.findByTestId('scan-settings')).toBeTruthy();
});
