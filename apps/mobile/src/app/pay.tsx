import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { computeBill, formatRupees, isValidVpa, parseRupees, upiUri } from '@dukaan/core';
import { createCustomer, saveBill, searchCustomers, type CustomerRow, type PaymentPayload } from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { getWriter } from '@/lib/writer';
import { useCart } from '@/state/cart';
import { useSession } from '@/state/session';
import { Button, Card, Field, Pill, Screen, Text } from '@/ui/primitives';

type Mode = PaymentPayload['mode'];
const MODES: Mode[] = ['cash', 'upi', 'card', 'credit'];
const LABEL: Record<Mode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Khata' };

function toPaise(s: string): number {
  try {
    return s.trim() ? parseRupees(s) : 0;
  } catch {
    return NaN;
  }
}

export default function PayScreen() {
  const cart = useCart();
  const shop = useSession((s) => s.shop);
  const device = useSession((s) => s.device);
  const totals = useMemo(() => computeBill({ lines: cart.lines, interstate: false, billDiscount: cart.billDiscount }), [cart.lines, cart.billDiscount]);
  const due = totals.total;

  const [amounts, setAmounts] = useState<Record<Mode, string>>({ cash: (due / 100).toFixed(2), upi: '', card: '', credit: '' });
  const [tendered, setTendered] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const paise = Object.fromEntries(MODES.map((m) => [m, toPaise(amounts[m])])) as Record<Mode, number>;
  const paid = MODES.reduce((s, m) => s + (paise[m] || 0), 0);
  const remaining = due - paid;
  const change = tendered ? toPaise(tendered) - (paise.cash || 0) : 0;
  const vpaOk = !!shop?.upiVpa && isValidVpa(shop.upiVpa);

  /** Tapping a mode puts the whole remaining amount on it (the common single-tender case is one tap). */
  const fillMode = (mode: Mode) => {
    const others = MODES.filter((m) => m !== mode).reduce((s, m) => s + (paise[m] || 0), 0);
    setAmounts((a) => ({ ...a, [mode]: (Math.max(due - others, 0) / 100).toFixed(2) }));
  };
  const only = (mode: Mode) => setAmounts({ cash: '', upi: '', card: '', credit: '', [mode]: (due / 100).toFixed(2) });

  const findCustomers = async (q: string) => {
    setCustomerQuery(q);
    setCustomers(await searchCustomers(await getDb(), q, 8));
  };

  const confirm = async () => {
    setError(null);
    if (MODES.some((m) => Number.isNaN(paise[m]))) return setError('Check the amounts');
    if (remaining !== 0) return setError(remaining > 0 ? `${formatRupees(remaining)} still due` : `Over by ${formatRupees(-remaining)}`);
    setSaving(true);
    try {
      const db = await getDb();
      const writer = await getWriter();
      let customerId = customer?.id ?? null;
      if (!customerId && paise.credit > 0 && customerQuery.trim()) customerId = await createCustomer(db, writer, { name: customerQuery });
      const payments = MODES.filter((m) => paise[m] > 0).map((mode) => ({ mode, amountPaise: paise[mode], ref: '' }));
      const bill = await saveBill(db, writer, device!.prefix, {
        cart: { lines: cart.lines, billDiscount: cart.billDiscount, customerId, interstate: false, placeOfSupply: shop!.stateCode },
        payments,
        cashier: device!.role,
      });
      cart.clear();
      router.replace({ pathname: '/bill/[id]', params: { id: bill.id, change: String(Math.max(change, 0)) } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space.xs }}>
          <Text tone="ink2">Amount due</Text>
          <Text variant="display" testID="pay-due">{formatRupees(due)}</Text>
          {totals.roundOff ? <Text variant="caption" tone="ink3">incl. round-off {formatRupees(totals.roundOff)}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {MODES.map((m) => (
            <Pressable key={m} onPress={() => only(m)} accessibilityRole="button" testID={`pay-only-${m}`}>
              <Pill label={LABEL[m]} tone={paise[m] === due ? 'saffron' : 'indigo'} />
            </Pressable>
          ))}
        </View>

        <Card style={{ gap: space.md }}>
          {MODES.map((m) => (
            <View key={m} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Field label={LABEL[m]} value={amounts[m]} onChangeText={(v) => setAmounts((a) => ({ ...a, [m]: v }))} keyboardType="decimal-pad" testID={`pay-${m}`} />
              </View>
              <Button kind="ghost" title="Rest" onPress={() => fillMode(m)} />
            </View>
          ))}
          <Text tone={remaining === 0 ? 'leaf' : 'brick'} testID="pay-remaining">
            {remaining === 0 ? 'Fully paid' : remaining > 0 ? `${formatRupees(remaining)} remaining` : `Over by ${formatRupees(-remaining)}`}
          </Text>
        </Card>

        {paise.cash > 0 ? (
          <Card style={{ gap: space.sm }}>
            <Field label="Cash received" value={tendered} onChangeText={setTendered} keyboardType="decimal-pad" testID="pay-tendered" />
            {tendered && !Number.isNaN(change) ? <Text variant="title" tone={change >= 0 ? 'leaf' : 'brick'} testID="pay-change">Change {formatRupees(Math.max(change, 0))}</Text> : null}
          </Card>
        ) : null}

        {paise.upi > 0 ? (
          <Card style={{ alignItems: 'center', gap: space.sm }}>
            {vpaOk ? (
              <>
                <QRCode value={upiUri({ vpa: shop!.upiVpa, payee: shop!.name, amountPaise: paise.upi, note: `Bill at ${shop!.name}` })} size={200} />
                <Text tone="ink2">Scan to pay {formatRupees(paise.upi)} to {shop!.upiVpa}</Text>
              </>
            ) : (
              <Text tone="brick">Add your UPI ID in Settings to show a payment QR</Text>
            )}
          </Card>
        ) : null}

        {paise.credit > 0 ? (
          <Card style={{ gap: space.sm }}>
            <Field label="Customer (name or phone)" value={customer ? `${customer.name} ${customer.phone}` : customerQuery} onChangeText={(v) => { setCustomer(null); void findCustomers(v); }} testID="pay-customer" />
            {!customer && customers.map((cu) => (
              <Pressable key={cu.id} onPress={() => setCustomer(cu)} testID={`pay-customer-${cu.id}`}>
                <Text>{cu.name} · {cu.phone} · owes {formatRupees(cu.balance_paise)}</Text>
              </Pressable>
            ))}
            {!customer && customerQuery.trim() && customers.length === 0 ? <Text variant="caption" tone="ink3">A new khata will be opened for “{customerQuery.trim()}”</Text> : null}
          </Card>
        ) : null}

        {error ? <Text tone="brick" testID="pay-error">{error}</Text> : null}
        <Button title={`Save bill · ${formatRupees(due)}`} onPress={confirm} loading={saving} disabled={remaining !== 0} testID="pay-confirm" />
      </ScrollView>
    </Screen>
  );
}
