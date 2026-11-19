import { useState } from 'react';
import { FlatList, Linking, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatRupees, parseRupees, reminderMessage, renderStatementHtml, whatsappUrl } from '@dukaan/core';
import {
  addLedgerAdjustment, getCustomer, getShop, lastReminded, ledgerFor, markReminded, recordPayment, type LedgerRow, type PaymentMode,
} from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { useLiveQuery } from '@/lib/hooks';
import { getWriter } from '@/lib/writer';
import { useSession } from '@/state/session';
import { Chips } from '@/ui/Chips';
import { Button, Card, Field, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

const MODES = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }] as const;
const KIND = { credit_sale: 'Credit sale', payment: 'Payment', adjust: 'Adjustment', opening: 'Opening balance' } as Record<string, string>;
type Action = 'none' | 'payment' | 'opening';

const dmy = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function toPaise(s: string): number | null {
  try {
    return s.trim() ? parseRupees(s) : null;
  } catch {
    return null;
  }
}

function Entry({ e }: { e: LedgerRow }) {
  const c = useColors();
  const credit = e.amount_paise < 0;
  const details = [KIND[e.kind] ?? e.kind, e.bill_no ? `Bill ${e.bill_no}` : '', e.mode ? e.mode.toUpperCase() : '', e.note].filter(Boolean).join(' · ');
  return (
    <View style={{ flexDirection: 'row', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.line, gap: space.sm }} testID={`ledger-${e.id}`}>
      <View style={{ flex: 1 }}>
        <Text>{details}</Text>
        <Text variant="caption" tone="ink3">{dmy(e.created_at)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="money" tone={credit ? 'leaf' : 'brick'}>{credit ? '−' : '+'}{formatRupees(Math.abs(e.amount_paise))}</Text>
        <Text variant="caption" tone="ink3">bal {formatRupees(e.balance_paise)}</Text>
      </View>
    </View>
  );
}

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const owner = useSession((s) => s.device?.role === 'owner');
  const [action, setAction] = useState<Action>('none');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data } = useLiveQuery(['customer', 'ledger', 'bill'], async (db) => {
    const [customer, ledger, reminded] = await Promise.all([getCustomer(db, id), ledgerFor(db, id), lastReminded(db, id)]);
    return { customer, ledger, reminded };
  }, [id]);
  const customer = data?.customer;
  const ledger = data?.ledger ?? [];
  const balance = ledger.length ? ledger[ledger.length - 1]!.balance_paise : 0;

  const open = (a: Action) => { setAction(action === a ? 'none' : a); setAmount(''); setNote(''); setError(null); };

  const save = async () => {
    const paise = toPaise(amount);
    if (!paise) return setError('Enter an amount');
    setBusy(true);
    try {
      const db = await getDb();
      const w = await getWriter();
      if (action === 'payment') {
        await recordPayment(db, w, { customerId: id, amountPaise: paise, mode, note });
        setNotice(`Received ${formatRupees(paise)} (${mode.toUpperCase()})`);
      } else {
        await addLedgerAdjustment(db, w, { customerId: id, amountPaise: paise, kind: 'opening', note });
        setNotice(`Opening balance ${formatRupees(paise)} added`);
      }
      setAction('none');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shopInfo = async () => {
    const shop = await getShop(await getDb());
    return { name: shop?.name ?? '', address: shop?.address ?? '', phone: shop?.phone ?? '', upiVpa: shop?.upiVpa ?? '' };
  };

  const remind = async () => {
    if (!customer) return;
    const url = whatsappUrl(customer.phone, reminderMessage(await shopInfo(), customer, balance));
    if (!url) return setNotice('Add a valid 10-digit mobile number to send reminders');
    await Linking.openURL(url);
    await markReminded(await getDb(), id);
    setNotice('Reminder opened in WhatsApp');
  };

  const statement = async () => {
    if (!customer) return;
    setBusy(true);
    try {
      const html = renderStatementHtml(await shopInfo(), customer, ledger.map((e) => ({
        createdAt: e.created_at, kind: e.kind, note: e.note, mode: e.mode, amountPaise: e.amount_paise, balancePaise: e.balance_paise, billNo: e.bill_no,
      })), Date.now());
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Statement ${customer.name}`, UTI: 'com.adobe.pdf' });
    } finally {
      setBusy(false);
    }
  };

  if (!customer) return <Screen><Text tone="ink3">{data ? 'Customer not found' : 'Loading…'}</Text></Screen>;

  return (
    <Screen style={{ gap: space.md }}>
      <Stack.Screen options={{ title: customer.name }} />
      <Card style={{ gap: space.xs }}>
        <Text variant="label" tone="ink2">{balance > 0 ? 'Owes you' : balance < 0 ? 'Advance with you' : 'Settled'}</Text>
        <Text variant="display" tone={balance > 0 ? 'brick' : 'leaf'} testID="cust-balance">{formatRupees(Math.abs(balance))}</Text>
        <Text variant="caption" tone="ink3">
          {customer.phone || 'No phone'}{data?.reminded ? ` · reminded ${dmy(data.reminded)}` : ''}
        </Text>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button title="Payment received" onPress={() => open('payment')} testID="cust-pay" style={{ flexGrow: 1 }} />
        <Button title="WhatsApp reminder" kind="secondary" onPress={() => void remind()} disabled={balance <= 0} testID="cust-remind" style={{ flexGrow: 1 }} />
        <Button title="Statement PDF" kind="secondary" onPress={() => void statement()} loading={busy && action === 'none'} testID="cust-statement" style={{ flexGrow: 1 }} />
        {owner ? <Button title="Opening balance" kind="ghost" onPress={() => open('opening')} testID="cust-opening" /> : null}
      </View>
      {notice ? <Text tone="leaf" testID="cust-notice">{notice}</Text> : null}
      {action !== 'none' ? (
        <Card style={{ gap: space.sm }}>
          <Field label={action === 'payment' ? 'Amount received (₹)' : 'Old khata balance (₹)'} value={amount} onChangeText={setAmount}
            keyboardType="decimal-pad" testID="cust-amount" error={error} autoFocus />
          {action === 'payment' ? <Chips options={MODES} value={mode} onChange={setMode} testID="cust-mode" /> : null}
          <Field label="Note (optional)" value={note} onChangeText={setNote} testID="cust-note" />
          <Button title="Save" onPress={() => void save()} loading={busy} testID="cust-save" />
        </Card>
      ) : null}
      <FlatList
        data={[...ledger].reverse()}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <Entry e={item} />}
        ListEmptyComponent={<Text tone="ink3">No entries yet.</Text>}
      />
    </Screen>
  );
}
