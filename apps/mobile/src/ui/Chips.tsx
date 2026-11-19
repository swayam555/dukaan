import { Pressable, View } from 'react-native';
import { space } from '@/constants/theme';
import { Pill } from './primitives';

/** Single-choice row of pills (range pickers, payment mode, filters). */
export function Chips<T extends string>({ options, value, onChange, testID }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }} testID={testID ? `${testID}-${o.value}` : undefined}>
          <Pill label={o.label} tone={o.value === value ? 'saffron' : 'indigo'} />
        </Pressable>
      ))}
    </View>
  );
}
