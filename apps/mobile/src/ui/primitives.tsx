import { memo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  StyleSheet,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, touch, type as typeScale } from '@/constants/theme';
import { useColors } from './theme';

type Variant = keyof typeof typeScale;
type Tone = 'ink' | 'ink2' | 'ink3' | 'saffron' | 'leaf' | 'brick' | 'indigo' | 'surface';

export const Text = memo(function Text({ variant = 'body', tone = 'ink', style, ...rest }: TextProps & { variant?: Variant; tone?: Tone }) {
  const c = useColors();
  return <RNText {...rest} style={[typeScale[variant], { color: c[tone] }, style]} />;
});

/** Stack screens keep their bottom content clear of the Android nav bar (edge-to-edge); tab screens pass
 *  `inTabs` because the tab bar already pads for it. */
export function Screen({ children, padded = true, inTabs = false, style, ...rest }: ViewProps & { padded?: boolean; inTabs?: boolean }) {
  const c = useColors();
  return (
    <SafeAreaView edges={inTabs ? ['top'] : ['top', 'bottom']} style={[{ flex: 1, backgroundColor: c.canvas }]}>
      <View {...rest} style={[{ flex: 1, padding: padded ? space.lg : 0 }, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  const c = useColors();
  return <View {...rest} style={[{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }, style]} />;
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ title, kind = 'primary', loading, icon, style, disabled, ...rest }: PressableProps & { title: string; kind?: ButtonKind; loading?: boolean; icon?: ReactNode }) {
  const c = useColors();
  const bg = { primary: c.saffron, secondary: c.surface, danger: c.brick, ghost: 'transparent' }[kind];
  const fg = kind === 'primary' || kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? c.saffronDeep : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, borderColor: kind === 'secondary' ? c.line : 'transparent' },
        typeof style === 'function' ? undefined : style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.row}>
          {icon}
          <RNText numberOfLines={1} style={[typeScale.heading, { color: fg }]}>{title}</RNText>
        </View>
      )}
    </Pressable>
  );
}

export function Field({ label, error, style, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" tone="ink2">{label}</Text>
      <TextInput
        placeholderTextColor={c.ink3}
        {...rest}
        style={[typeScale.body, styles.input, { color: c.ink, backgroundColor: c.surface, borderColor: error ? c.brick : c.line }, style]}
      />
      {error ? <Text variant="caption" tone="brick">{error}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone = 'indigo' }: { label: string; tone?: 'indigo' | 'leaf' | 'brick' | 'saffron' }) {
  const c = useColors();
  const bg = { indigo: c.indigoTint, leaf: c.leafTint, brick: c.brickTint, saffron: c.saffronTint }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text variant="caption" tone={tone} style={{ fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: touch.min, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
