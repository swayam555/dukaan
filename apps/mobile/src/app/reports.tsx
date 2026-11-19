import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatQuantity, formatRupees, type Unit } from '@dukaan/core';
import { gstr1, localDay, paymentSplit, salesByDay, salesSummary, topItems, type DayRange, type Gstr1 } from '@dukaan/db';
import { space } from '@/constants/theme';
import { useLiveQuery } from '@/lib/hooks';
import { rangeFor, type Preset } from '@/lib/ranges';
import { useSession } from '@/state/session';
import { BarChart } from '@/ui/BarChart';
import { Chips } from '@/ui/Chips';
import { Button, Card, Screen, Text } from '@/ui/primitives';

const PRESETS = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' },
] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SECTIONS = [
  { key: 'b2b', label: 'B2B invoices' }, { key: 'b2cl', label: 'B2C large' }, { key: 'b2cs', label: 'B2C small' },
  { key: 'hsn_b2b', label: 'HSN summary (B2B)' }, { key: 'hsn_b2c', label: 'HSN summary (B2C)' }, { key: 'docs', label: 'Documents issued' },
] as const;

const short = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ minWidth: '45%', flexGrow: 1 }}>
      <Text variant="label" tone="ink2">{label}</Text>
      <Text variant="money" testID={testID}>{value}</Text>
    </View>
  );
}

/** Writes the GSTR-1 CSVs into the cache (one folder per period) and returns the file for one section. */
function writeSection(g: Gstr1, r: DayRange, key: (typeof SECTIONS)[number]['key']): File {
  const dir = new Directory(Paths.cache, `gstr1_${r.from}_${r.to}`);
  if (!dir.exists) dir.create({ intermediates: true });
  const f = new File(dir, `${key}.csv`);
  if (f.exists) f.delete();
  f.create();
  f.write(g[key]);
  return f;
}

export default function ReportsScreen() {
  const owner = useSession((s) => s.device?.role === 'owner');
  const [today] = useState(() => localDay(Date.now()));
  const [preset, setPreset] = useState<Preset>('7d');
  const [notice, setNotice] = useState<string | null>(null);
  const r = rangeFor(preset, today);
  const { data } = useLiveQuery(['bill'], async (db) => {
    const [days, summary, modes, top] = await Promise.all([salesByDay(db, r), salesSummary(db, r), paymentSplit(db, r), topItems(db, r, 'revenue', 10)]);
    return { days, summary, modes, top };
  }, [r.from, r.to]);
  const { data: gst } = useLiveQuery(['bill', 'customer'], (db) => gstr1(db, r), [r.from, r.to]);

  const share = async (key: (typeof SECTIONS)[number]['key']) => {
    if (!gst) return;
    const f = writeSection(gst, r, key);
    await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: `GSTR-1 ${key} ${r.from}–${r.to}`, UTI: 'public.comma-separated-values-text' });
    setNotice(`${key}.csv shared (${gst.counts[key]} rows)`);
  };

  const s = data?.summary;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Chips options={PRESETS} value={preset} onChange={setPreset} testID="range" />
        <Text variant="caption" tone="ink3" testID="range-label">{r.from === r.to ? r.from : `${r.from} → ${r.to}`}</Text>
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Stat label="Sales" value={formatRupees(s?.total_paise ?? 0)} testID="rep-sales" />
            <Stat label="Bills" value={String(s?.bills ?? 0)} testID="rep-bills" />
            <Stat label="Avg bill" value={formatRupees(s?.avg_bill_paise ?? 0)} testID="rep-avg" />
            {owner ? <Stat label="Gross profit" value={formatRupees(s?.profit_paise ?? 0)} testID="rep-profit" /> : null}
            <Stat label="GST collected" value={formatRupees(s?.tax_paise ?? 0)} testID="rep-tax" />
            <Stat label="Voided" value={String(s?.voids ?? 0)} testID="rep-voids" />
          </View>
          {data && data.days.length > 1 ? (
            <BarChart bars={data.days.map((d) => ({ key: d.day, value: d.total_paise, label: short(d.day) }))} highlight={today} />
          ) : null}
        </Card>
        <Card style={{ gap: space.sm }}>
          <Text variant="heading">Payment modes</Text>
          {(data?.modes ?? []).length === 0 ? <Text tone="ink3">No sales in this period.</Text> : null}
          {(data?.modes ?? []).map((m) => (
            <View key={m.mode} style={{ flexDirection: 'row', justifyContent: 'space-between' }} testID={`mode-${m.mode}`}>
              <Text>{m.mode.toUpperCase()} · {m.bills} bills</Text>
              <Text variant="money">{formatRupees(m.amount_paise)}</Text>
            </View>
          ))}
        </Card>
        <Card style={{ gap: space.sm }}>
          <Text variant="heading">Top items</Text>
          {(data?.top ?? []).map((t, i) => (
            <View key={t.item_id} style={{ flexDirection: 'row', gap: space.sm }} testID={`top-${t.item_id}`}>
              <Text tone="ink3" style={{ width: 20 }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{t.name}</Text>
                <Text variant="caption" tone="ink3">{formatQuantity(t.qty_milli, t.unit as Unit)}{owner ? ` · profit ${formatRupees(t.profit_paise)}` : ''}</Text>
              </View>
              <Text variant="money">{formatRupees(t.total_paise)}</Text>
            </View>
          ))}
        </Card>
        {owner ? (
          <Card style={{ gap: space.sm }}>
            <Text variant="heading">GSTR-1 export</Text>
            <Text variant="caption" tone="ink2">CSV files in the GST offline tool&apos;s import format. Share each section to your CA or the tool.</Text>
            {SECTIONS.map((sec) => (
              <Button key={sec.key} kind="secondary" title={`${sec.label} · ${gst?.counts[sec.key] ?? 0} rows`} disabled={!gst}
                onPress={() => void share(sec.key)} testID={`gstr1-${sec.key}`} />
            ))}
            {notice ? <Text tone="leaf" testID="gstr1-notice">{notice}</Text> : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
