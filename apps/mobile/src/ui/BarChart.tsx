import { useState } from 'react';
import { View } from 'react-native';
import { Canvas, Line, Rect, vec } from '@shopify/react-native-skia';
import { space } from '@/constants/theme';
import { Text } from './primitives';
import { useColors } from './theme';

export type Bar = { key: string; value: number; label: string };

/**
 * Daily sales bars drawn with Skia (one GPU canvas, no SVG node per bar, so 90 days stays cheap).
 * Axis labels are plain RN Text, so they follow the system font and font scale.
 */
export function BarChart({ bars, height = 160, highlight }: { bars: readonly Bar[]; height?: number; highlight?: string }) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = bars.length ? width / bars.length : 0;
  const gap = Math.min(4, slot * 0.25);
  const every = Math.max(1, Math.ceil(bars.length / 6));
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="bar-chart">
      {width > 0 ? (
        <Canvas style={{ width, height }}>
          <Line p1={vec(0, height - 0.5)} p2={vec(width, height - 0.5)} color={c.line} strokeWidth={1} />
          {bars.map((b, i) => {
            const h = (b.value / max) * (height - 4);
            return <Rect key={b.key} x={i * slot + gap / 2} y={height - h} width={Math.max(1, slot - gap)} height={h}
              color={b.key === highlight ? c.saffronDeep : c.saffron} />;
          })}
        </Canvas>
      ) : <View style={{ height }} />}
      <View style={{ flexDirection: 'row', marginTop: space.xs }}>
        {bars.map((b, i) => (
          <Text key={b.key} variant="caption" tone="ink3" numberOfLines={1} style={{ width: slot, textAlign: 'center' }}>
            {i % every === 0 ? b.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
