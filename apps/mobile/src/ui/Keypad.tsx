import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { radius, space, touch } from '@/constants/theme';
import { Text } from './primitives';
import { useColors } from './theme';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'ok';

const LAYOUT: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

/** Big numeric keypad for PIN entry and quantity/amount input. Haptic tick on every key. */
export const Keypad = memo(function Keypad({ onKey, allowDecimal = true }: { onKey: (key: KeypadKey) => void; allowDecimal?: boolean }) {
  const c = useColors();
  const press = useCallback((key: KeypadKey) => {
    void Haptics.selectionAsync();
    onKey(key);
  }, [onKey]);
  return (
    <View style={styles.grid}>
      {LAYOUT.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => {
            const hidden = key === '.' && !allowDecimal;
            return (
              <Pressable
                key={key}
                disabled={hidden}
                accessibilityRole="button"
                accessibilityLabel={key === 'back' ? 'Backspace' : key}
                onPress={() => press(key)}
                style={({ pressed }) => [styles.key, { backgroundColor: hidden ? 'transparent' : pressed ? c.saffronTint : c.surface, borderColor: hidden ? 'transparent' : c.line }]}
              >
                {!hidden && <Text variant="title">{key === 'back' ? '⌫' : key}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  key: { flex: 1, height: touch.key, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
