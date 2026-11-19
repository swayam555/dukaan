import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { auditTrail, type AuditEntry, type AuditKind } from '@dukaan/db';
import { space } from '@/constants/theme';
import { useLiveQuery } from '@/lib/hooks';
import { useSession } from '@/state/session';
import { Chips } from '@/ui/Chips';
import { Pill, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

type Filter = 'all' | 'money' | 'stock' | 'price' | 'refused';
const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'money', label: 'Voids & discounts' }, { value: 'stock', label: 'Stock' },
  { value: 'price', label: 'Prices' }, { value: 'refused', label: 'Refused' },
] as const;
const KINDS: Record<Filter, readonly AuditKind[] | undefined> = {
  all: undefined, money: ['void', 'discount', 'ledger'], stock: ['stock', 'purchase'], price: ['price', 'import', 'supplier'], refused: ['refused'],
};
const STATUS: Record<AuditEntry['status'], { label: string; tone: 'indigo' | 'leaf' | 'brick' | 'saffron' }> = {
  pending: { label: 'not synced', tone: 'saffron' }, synced: { label: 'synced', tone: 'leaf' },
  rejected: { label: 'rejected', tone: 'brick' }, quarantined: { label: 'refused', tone: 'brick' },
};

const when = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Owner-only: who did what to money, stock and prices. A read-only view over the op log. */
export default function AuditScreen() {
  const owner = useSession((s) => s.device?.role === 'owner');
  const self = useSession((s) => s.device?.id);
  const [filter, setFilter] = useState<Filter>('all');
  const c = useColors();
  const { data } = useLiveQuery(['sync', 'bill', 'stock', 'item', 'ledger', 'purchase', 'supplier'],
    (db) => auditTrail(db, { kinds: KINDS[filter], limit: 200 }), [filter]);

  if (!owner) return <Screen><Text tone="ink2">Only the owner can see the audit log.</Text></Screen>;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} testID="audit-filter" />
        {data && data.length === 0 ? <Text tone="ink3" testID="audit-empty">Nothing here yet.</Text> : null}
        {(data ?? []).map((e) => (
          <View key={e.opId} testID={`audit-${e.opId}`} style={{ gap: 2, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <Text variant="heading">{e.summary}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text variant="caption" tone="ink3">
                {when(e.at)} · {e.role}{e.deviceId === self ? ' (this phone)' : ` · ${e.deviceId.slice(0, 8)}`}
              </Text>
              <Pill label={STATUS[e.status].label} tone={STATUS[e.status].tone} />
            </View>
            {e.reason ? <Text variant="caption" tone="brick">{e.reason}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
