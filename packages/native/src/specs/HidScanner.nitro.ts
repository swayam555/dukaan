import type { HybridObject } from 'react-native-nitro-modules';

/**
 * USB/Bluetooth barcode scanners present as keyboards. Typing at human speed must still reach text
 * inputs, so keys are buffered and only claimed as a scan when they arrive as a burst (every gap
 * ≤ `maxGapMs`) of ≥ `minLength` characters terminated by Enter/Tab.
 */
export interface HidScanner extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly isActive: boolean;
  /** `durationMs` = first key → terminator, for diagnostics. */
  start(onScan: (code: string, durationMs: number) => void, maxGapMs: number, minLength: number): void;
  stop(): void;
}
