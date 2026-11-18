import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatQuantity, formatRupees, isLoose, lineAmount } from '@dukaan/core';
import { space } from '@/constants/theme';
import { useCart } from '@/state/cart';
import { Keypad, type KeypadKey } from '@/ui/Keypad';
import { Button, Card, Screen, Text } from '@/ui/primitives';

/** Quantity / weight entry for one cart line. Loose items take kg/l with 3 decimals; packs take whole numbers. */
export default function LineEditor() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const line = useCart((s) => s.lines.find((l) => l.key === key));
  const update = useCart((s) => s.update);
  const remove = useCart((s) => s.remove);
  const [entry, setEntry] = useState(line && line.qtyMilli > 0 ? String(line.qtyMilli / 1000) : '');
  const [discountPct, setDiscountPct] = useState(line?.discount?.kind === 'pct' ? String(line.discount.bp / 100) : '');
  const [field, setField] = useState<'qty' | 'discount'>('qty');
  if (!line) return null;
  const loose = isLoose(line.unit);

  const onKey = (k: KeypadKey) => {
    const setter = field === 'qty' ? setEntry : setDiscountPct;
    setter((cur) => {
      if (k === 'back') return cur.slice(0, -1);
      if (k === '.') return (field === 'qty' && !loose) || cur.includes('.') ? cur : `${cur || '0'}.`;
      if (k === 'ok') return cur;
      const next = cur + k;
      const decimals = next.split('.')[1]?.length ?? 0;
      return decimals > (field === 'qty' ? 3 : 2) ? cur : next;
    });
  };

  const qtyMilli = Math.round(Number(entry || '0') * 1000);
  const pct = Math.min(100, Number(discountPct || '0'));
  const gross = lineAmount(line.unitPaise, qtyMilli);
  const save = () => {
    update(line.key, { qtyMilli, discount: pct > 0 ? { kind: 'pct', bp: Math.round(pct * 100) } : null });
    router.back();
  };

  return (
    <Screen style={{ gap: space.md, justifyContent: 'space-between' }}>
      <View style={{ gap: space.md }}>
        <Text variant="title" numberOfLines={2}>{line.name}</Text>
        <Text tone="ink2">{formatRupees(line.unitPaise)} / {line.unit}{line.mrpPaise > line.unitPaise ? ` · MRP ${formatRupees(line.mrpPaise)}` : ''}</Text>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Card style={{ flex: 2, borderWidth: field === 'qty' ? 2 : undefined }} onTouchEnd={() => setField('qty')}>
            <Text variant="label" tone="ink2">{loose ? `Weight (${line.unit})` : 'Quantity'}</Text>
            <Text variant="display" testID="line-qty">{entry || '0'}</Text>
          </Card>
          <Card style={{ flex: 1, borderWidth: field === 'discount' ? 2 : undefined }} onTouchEnd={() => setField('discount')}>
            <Text variant="label" tone="ink2">Discount %</Text>
            <Text variant="display" testID="line-discount">{discountPct || '0'}</Text>
          </Card>
        </View>
        <Text variant="heading" testID="line-amount">
          {qtyMilli > 0 ? `${formatQuantity(qtyMilli, line.unit)} = ${formatRupees(gross - Math.round((gross * pct) / 100))}` : ' '}
        </Text>
      </View>
      <View style={{ gap: space.md }}>
        <Keypad onKey={onKey} allowDecimal={field === 'discount' || loose} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button kind="danger" title="Remove" onPress={() => { remove(line.key); router.back(); }} style={{ flex: 1 }} testID="line-remove" />
          <Button title="Done" onPress={save} disabled={qtyMilli <= 0} style={{ flex: 2 }} testID="line-done" />
        </View>
      </View>
    </Screen>
  );
}
