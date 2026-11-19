import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatRupees } from '@dukaan/core';
import { createCustomer, khataList, khataTotals, type KhataRow } from '@dukaan/db';
import { space } from '@/constants/theme';
import { useT } from '@/i18n';
import { getDb } from '@/lib/db';
import { useLiveQuery } from '@/lib/hooks';
import { getWriter } from '@/lib/writer';
import { Chips } from '@/ui/Chips';
import { Button, Card, Field, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

type Filter = 'all' | 'due';
const FILTERS = [{ value: 'all', label: 'All' }, { value: 'due', label: 'Owes money' }] as const;

function Row({ row }: { row: KhataRow }) {
  const c = useColors();
  const owes = row.balance_paise > 0;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/customer/[id]', params: { id: row.id } })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.sm,
        borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: pressed ? c.saffronTint : 'transparent' })}
      accessibilityRole="button" testID={`khata-${row.id}`}
    >
      <View style={{ flex: 1 }}>
        <Text variant="heading">{row.name}</Text>
        {row.phone ? <Text variant="caption" tone="ink3">{row.phone}</Text> : null}
      </View>
      <Text variant="money" tone={owes ? 'brick' : row.balance_paise < 0 ? 'leaf' : 'ink3'}>
        {row.balance_paise === 0 ? '—' : formatRupees(Math.abs(row.balance_paise))}
      </Text>
    </Pressable>
  );
}

export default function KhataScreen() {
  const t = useT();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('due');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: rows } = useLiveQuery(['customer', 'ledger'], (db) => khataList(db, { q, dueOnly: filter === 'due' }), [q, filter]);
  const { data: totals } = useLiveQuery(['customer', 'ledger'], khataTotals);

  const add = async () => {
    setError(null);
    const digits = phone.replace(/\D/g, '');
    if (digits && digits.length !== 10) return setError('Phone must be 10 digits');
    try {
      const id = await createCustomer(await getDb(), await getWriter(), { name, phone: digits });
      setName(''); setPhone(''); setAdding(false);
      router.push({ pathname: '/customer/[id]', params: { id } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen inTabs style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">{t('tab.khata')}</Text>
        <Button title={adding ? 'Cancel' : '+ Customer'} kind="secondary" onPress={() => setAdding(!adding)} testID="khata-add" />
      </View>
      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text variant="label" tone="ink2">To collect</Text>
          <Text variant="display" tone="brick" testID="khata-total">{formatRupees(totals?.duePaise ?? 0)}</Text>
        </View>
        <Text tone="ink2" testID="khata-count">{totals?.customersDue ?? 0} customers</Text>
      </Card>
      {adding ? (
        <Card style={{ gap: space.sm }}>
          <Field label="Name" value={name} onChangeText={setName} testID="khata-name" autoFocus />
          <Field label="Mobile (for WhatsApp reminders)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="khata-phone" error={error} />
          <Button title="Open khata" onPress={() => void add()} disabled={!name.trim()} testID="khata-save" />
        </Card>
      ) : null}
      <Field label="Search name or phone" value={q} onChangeText={setQ} testID="khata-search" />
      <Chips options={FILTERS} value={filter} onChange={setFilter} testID="khata-filter" />
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Row row={item} />}
        ListEmptyComponent={<Text tone="ink3" style={{ padding: space.lg }}>{filter === 'due' ? 'Nobody owes you money.' : 'No customers yet.'}</Text>}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}
