import type { HybridObject } from 'react-native-nitro-modules';

export interface PrinterDevice {
  address: string;
  name: string;
}

/**
 * ESC/POS over Bluetooth. Android: classic RFCOMM/SPP (what ₹1.5–3k thermal printers speak).
 * iOS: BLE GATT write characteristic (classic SPP needs MFi), so `address` is a peripheral UUID there.
 */
export interface BluetoothPrinter extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** False when the phone has no Bluetooth adapter or it is off. */
  readonly isEnabled: boolean;
  /** Address of the open connection, if any. */
  readonly connectedAddress: string | undefined;
  /** Paired (bonded) devices — printers are paired once from system settings. */
  listPaired(): Promise<PrinterDevice[]>;
  connect(address: string, timeoutMs: number): Promise<void>;
  /**
   * Writes in `chunkBytes` pieces with `gapMs` between them; cheap printers have ~4 KB buffers and
   * silently drop bytes on overflow, which shows up as garbage halfway down a raster image.
   */
  write(data: ArrayBuffer, chunkBytes: number, gapMs: number): Promise<void>;
  disconnect(): void;
}
