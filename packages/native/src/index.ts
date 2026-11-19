import { NitroModules } from 'react-native-nitro-modules';
import type { BluetoothPrinter, PrinterDevice } from './specs/BluetoothPrinter.nitro';
import type { HidScanner } from './specs/HidScanner.nitro';

export type { BluetoothPrinter, HidScanner, PrinterDevice };

let printer: BluetoothPrinter | null = null;
let scanner: HidScanner | null = null;

export const getPrinter = () => (printer ??= NitroModules.createHybridObject<BluetoothPrinter>('BluetoothPrinter'));
export const getHidScanner = () => (scanner ??= NitroModules.createHybridObject<HidScanner>('HidScanner'));
