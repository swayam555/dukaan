import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCameraPermission } from 'react-native-vision-camera';
import { CodeScanner, type Barcode, type TargetBarcodeFormat } from 'react-native-vision-camera-barcode-scanner';
import { computeBill, createScanGate, formatRupees, isValidGtin } from '@dukaan/core';
import { findByBarcode } from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { useCart } from '@/state/cart';
import { Button, Card, Screen, Text } from '@/ui/primitives';

/** Retail product codes plus Code-128 (what most shops print on their own loose-item labels). */
const FORMATS: TargetBarcodeFormat[] = ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128'];
const GTIN_FORMATS = new Set(['ean-13', 'ean-8', 'upc-a']);

/** Camera runs unless the app is backgrounded ('unknown' at cold start must not keep it off). */
function useAppActive() {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'));
    return () => sub.remove();
  }, []);
  return active;
}

type Last = { tone: 'leaf' | 'brick'; text: string };

/**
 * Continuous camera scanner: the camera stays open and every new code goes straight into the cart, so a
 * counter can scan a basket without tapping between items. Same code in view = one scan (see ScanGate).
 */
export default function ScanScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const appActive = useAppActive();
  const lines = useCart((s) => s.lines);
  const billDiscount = useCart((s) => s.billDiscount);
  const total = useMemo(() => computeBill({ lines: lines.filter((l) => l.qtyMilli > 0), billDiscount, interstate: false }).total, [lines, billDiscount]);
  const [last, setLast] = useState<Last | null>(null);
  const [count, setCount] = useState(0);
  const gate = useRef(createScanGate(1200));

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  const onBarcodeScanned = (barcodes: Barcode[]) => {
    const now = Date.now();
    for (const b of barcodes) {
      const code = b.rawValue?.trim();
      if (!code) continue;
      if (GTIN_FORMATS.has(b.format) && !isValidGtin(code)) continue; // misread: wait for a clean frame
      if (!gate.current.accept(code, now)) continue;
      void (async () => {
        const item = await findByBarcode(await getDb(), code);
        if (item) {
          useCart.getState().add(item);
          setCount((n) => n + 1);
          setLast({ tone: 'leaf', text: `+ ${item.name}` });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setLast({ tone: 'brick', text: `Unknown barcode ${code}` });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      })();
      break; // one product per frame: two codes in view at once is almost always a mistake
    }
  };

  if (!hasPermission) {
    return (
      <Screen style={{ gap: space.md, justifyContent: 'center' }}>
        <Text>Camera access is needed to scan barcodes.</Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} testID="scan-allow" />
        <Button kind="secondary" title="Back to bill" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      <CodeScanner
        style={styles.fill}
        isActive={appActive}
        barcodeFormats={FORMATS}
        onBarcodeScanned={onBarcodeScanned}
        onError={(e) => setLast({ tone: 'brick', text: `Camera error: ${e.message}` })}
      />
      <View pointerEvents="none" style={styles.reticle} />
      <Card style={styles.panel}>
        <Text variant="title" testID="scan-total">{lines.length} items · {formatRupees(total)}</Text>
        <Text tone="ink2">{count} scanned this session</Text>
        {last ? <Text tone={last.tone} testID="scan-last">{last.text}</Text> : <Text tone="ink2">Point at a barcode</Text>}
        <Button title="Done" onPress={() => router.back()} testID="scan-done" />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  reticle: {
    position: 'absolute', top: '28%', left: '12%', right: '12%', height: 140,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 12,
  },
  panel: { position: 'absolute', left: space.md, right: space.md, bottom: space.lg, gap: space.sm },
});
