import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatQuantity, formatRupees, type Unit } from '@dukaan/core';
import { space } from '@/constants/theme';
import { Text } from './primitives';
import { useColors } from './theme';

export type ItemRowData = {
  id: string;
  name: string;
  name_hi: string;
  unit: Unit;
  sale_paise: number;
  mrp_paise: number;
  qty_milli: number;
  low_stock_milli: number;
};

export const ITEM_ROW_HEIGHT = 64;

export const ItemRow = memo(function ItemRow({ item, onPress }: { item: ItemRowData; onPress?: (id: string) => void }) {
  const c = useColors();
  const low = item.qty_milli <= item.low_stock_milli;
  return (
    <Pressable
      onPress={onPress ? () => onPress(item.id) : undefined}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.saffronTint : c.surface, borderBottomColor: c.line }]}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={`item-${item.id}`}
    >
      <View style={styles.main}>
        <Text numberOfLines={1} variant="heading">{item.name}</Text>
        <Text numberOfLines={1} variant="caption" tone="ink3">{item.name_hi || ' '}</Text>
      </View>
      <View style={styles.side}>
        <Text variant="money">{formatRupees(item.sale_paise)}</Text>
        <Text variant="caption" tone={low ? 'brick' : 'ink3'}>{formatQuantity(item.qty_milli, item.unit)}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { height: ITEM_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, gap: space.md },
  main: { flex: 1, gap: 2 },
  side: { alignItems: 'flex-end', gap: 2 },
});
