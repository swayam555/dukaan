import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { getHidScanner } from '@dukaan/native';
import { cartProblems, computeBill, formatQuantity, formatRupees, type CartLine } from '@dukaan/core';
import { findByBarcode, holdBill, listHeldBills, resumeHeldBill } from '@dukaan/db';
import { radius, space, type as typeScale } from '@/constants/theme';
import { useT } from '@/i18n';
import { getDb } from '@/lib/db';
import { useItemSearch, useLiveQuery } from '@/lib/hooks';
import { useCart } from '@/state/cart';
import { useSession } from '@/state/session';
import { ItemRow } from '@/ui/ItemRow';
import { Button, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

function CartRow({ line, onPress }: { line: CartLine; onPress: (key: string) => void }) {
  const c = useColors();
  const amount = Math.round((line.unitPaise * line.qtyMilli) / 1000);
  const needsQty = line.qtyMilli <= 0;
  return (
    <Pressable onPress={() => onPress(line.key)} style={[styles.cartRow, { borderBottomColor: c.line, backgroundColor: c.surface }]} testID={`cart-${line.itemId}`}>
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>{line.name}</Text>
        <Text variant="caption" tone={needsQty ? 'brick' : 'ink3'}>
          {needsQty ? 'Tap to enter weight' : `${formatQuantity(line.qtyMilli, line.unit)} × ${formatRupees(line.unitPaise)}`}
        </Text>
      </View>
      <Text variant="money">{formatRupees(amount)}</Text>
    </Pressable>
  );
}

export default function BillingScreen() {
  const t = useT();
  const c = useColors();
  const device = useSession((s) => s.device);
  const cart = useCart();
  const [query, setQuery] = useState('');
  const search = useItemSearch(query);

  const totals = useMemo(
    () => computeBill({ lines: cart.lines.filter((l) => l.qtyMilli > 0), interstate: false, billDiscount: cart.billDiscount }),
    [cart.lines, cart.billDiscount],
  );
  const problems = cartProblems(cart);

  const pick = useCallback(async (id: string) => {
    const item = search.hits.find((h) => h.id === id);
    if (!item) return;
    cart.add(item);
    setQuery('');
    if (item.unit === 'kg' || item.unit === 'g' || item.unit === 'l' || item.unit === 'ml') {
      const key = useCart.getState().lines[0]?.key;
      if (key) router.push({ pathname: '/line/[key]', params: { key } });
    }
  }, [cart, search.hits]);

  /** Enter on the search box with a barcode (USB/BT HID scanners type digits + Enter). */
  const submit = useCallback(async () => {
    const code = query.trim();
    if (!/^\d{6,14}$/.test(code)) return;
    const item = await findByBarcode(await getDb(), code);
    if (item) {
      cart.add(item);
      setQuery('');
    }
  }, [cart, query]);

  const hold = useCallback(async () => {
    if (cart.lines.length === 0) return;
    await holdBill(await getDb(), `${cart.lines.length} items · ${formatRupees(totals.total)}`, {
      lines: cart.lines, billDiscount: cart.billDiscount, customerId: cart.customerId, interstate: false, placeOfSupply: '',
    });
    cart.clear();
  }, [cart, totals.total]);

  const held = useLiveQuery(['held'], (db) => listHeldBills(db));
  /** Resuming parks the current cart first, so nothing is ever lost by switching customers. */
  const resume = useCallback(async (id: string) => {
    const db = await getDb();
    if (cart.lines.length) await hold();
    const parked = await resumeHeldBill(db, id);
    if (parked) cart.load({ lines: parked.lines as CartLine[], billDiscount: parked.billDiscount, customerId: parked.customerId });
  }, [cart, hold]);

  /** Hardware (HID) scanner: bursts of keys + Enter, caught natively before they reach any text field. */
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const addRef = useRef(cart.add);
  useEffect(() => { addRef.current = cart.add; }, [cart.add]);
  useEffect(() => {
    const hid = getHidScanner();
    hid.start((code) => {
      void (async () => {
        const item = await findByBarcode(await getDb(), code);
        if (item) {
          addRef.current(item);
          setScanMsg(null);
        } else setScanMsg(`No item with barcode ${code}`);
      })();
    }, 50, 6);
    return () => hid.stop();
  }, []);

  const showingResults = query.trim().length > 0;

  return (
    <Screen inTabs padded={false}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="title">{t('tab.billing')}</Text>
          <Text variant="caption" tone="ink3" testID="device-prefix">{device?.prefix} · {device?.role}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            placeholder={t('common.search')}
            placeholderTextColor={c.ink3}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            testID="billing-search"
            style={[typeScale.body, styles.search, { backgroundColor: c.surface, borderColor: c.line, color: c.ink }]}
          />
          <Button kind="secondary" title="Scan" onPress={() => router.push('/scan')} testID="billing-scan" />
        </View>
      </View>

      {!showingResults && held.data?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
          {held.data.map((h) => (
            <Pressable key={h.id} onPress={() => void resume(h.id)} testID={`held-${h.id}`} style={[styles.held, { borderColor: c.saffron }]}>
              <Text variant="caption">⏸ {h.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flex: 1, marginTop: space.sm }}>
        {showingResults ? (
          <FlashList
            data={search.hits}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => <ItemRow item={item} onPress={pick} />}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={search.searching ? null : <Text tone="ink3" style={{ padding: space.lg }}>No match</Text>}
          />
        ) : (
          <FlashList
            data={cart.lines}
            keyExtractor={(l) => l.key}
            renderItem={({ item }) => <CartRow line={item} onPress={(key) => router.push({ pathname: '/line/[key]', params: { key } })} />}
            ListEmptyComponent={<Text tone="ink3" style={{ padding: space.lg }}>{t('billing.empty')}</Text>}
          />
        )}
      </View>

      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.line }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text tone="ink2">{t('billing.total')} · {cart.lines.length} items{totals.discount ? ` · −${formatRupees(totals.discount)}` : ''}</Text>
          <Text variant="display" testID="bill-total">{formatRupees(totals.total)}</Text>
        </View>
        {scanMsg ? <Text variant="caption" tone="brick" testID="billing-scan-msg">{scanMsg}</Text> : null}
        {problems.length ? <Text variant="caption" tone="brick">{problems[0]}</Text> : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button kind="secondary" title={t('billing.hold')} onPress={hold} disabled={cart.lines.length === 0} style={{ flex: 1 }} testID="billing-hold" />
          <Button title={t('billing.charge')} onPress={() => router.push('/pay')} disabled={cart.lines.length === 0 || problems.length > 0} style={{ flex: 2 }} testID="billing-charge" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  cartRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, gap: space.md },
  held: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
