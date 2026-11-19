import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { formatQuantity, formatRupees, parseQuantity, parseRupees, type Unit } from '@dukaan/core';
import {
  ADJUST_REASONS, adjustStock, createSupplier, expiringBatches, listPurchases, listSuppliers, localDay, lowStock, purchaseTotals,
  recordPurchase, type AdjustReason, type PurchaseLineInput, type SearchHit,
} from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { useItemSearch, useLiveQuery } from '@/lib/hooks';
import { getWriter } from '@/lib/writer';
import { useSession } from '@/state/session';
import { Chips } from '@/ui/Chips';
import { Button, Card, Field, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

type Tab = 'low' | 'expiry' | 'purchase' | 'history';
const TABS = [
  { value: 'low', label: 'Low stock' }, { value: 'expiry', label: 'Expiring' },
  { value: 'purchase', label: 'New purchase' }, { value: 'history', label: 'Purchases' },
] as const;
const REASON_LABEL: Record<AdjustReason, string> = { count: 'Recount', damage: 'Damaged', expiry: 'Expired', theft: 'Lost/theft', opening: 'Opening stock', other: 'Other' };
const REASONS = ADJUST_REASONS.map((r) => ({ value: r, label: REASON_LABEL[r] }));
const DIRECTIONS = [{ value: 'add', label: 'Add' }, { value: 'remove', label: 'Remove' }] as const;

type Target = { itemId: string; name: string; unit: Unit; batchId?: string; suggest?: AdjustReason };

function parseOr<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function Line({ title, sub, right, tone, onPress, testID }: { title: string; sub?: string; right: string; tone?: 'brick' | 'saffron' | 'ink2'; onPress?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.line,
        backgroundColor: pressed ? c.saffronTint : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <Text variant="heading">{title}</Text>
        {sub ? <Text variant="caption" tone="ink3">{sub}</Text> : null}
      </View>
      <Text variant="money" tone={tone ?? 'ink2'}>{right}</Text>
    </Pressable>
  );
}

/** Add/remove stock with a reason (kept on the op for the audit trail). */
function AdjustForm({ target, onDone }: { target: Target; onDone: (msg: string) => void }) {
  const [dir, setDir] = useState<'add' | 'remove'>(target.suggest === 'expiry' || target.suggest === 'damage' ? 'remove' : 'add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<AdjustReason>(target.suggest ?? 'count');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const milli = parseOr(() => parseQuantity(qty, target.unit));
    if (!milli) return setError(`Enter a quantity in ${target.unit}`);
    try {
      await adjustStock(await getDb(), await getWriter(), {
        itemId: target.itemId, batchId: target.batchId, deltaMilli: dir === 'add' ? milli : -milli, reason, note,
      });
      onDone(`${target.name}: ${dir === 'add' ? '+' : '−'}${formatQuantity(milli, target.unit)} (${REASON_LABEL[reason]})`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card style={{ gap: space.sm }} testID="adjust-form">
      <Text variant="heading">Adjust {target.name}</Text>
      <Chips options={DIRECTIONS} value={dir} onChange={setDir} testID="adjust-dir" />
      <Field label={`Quantity (${target.unit})`} value={qty} onChangeText={setQty} keyboardType="decimal-pad" testID="adjust-qty" error={error} />
      <Chips options={REASONS} value={reason} onChange={setReason} testID="adjust-reason" />
      <Field label="Note" value={note} onChangeText={setNote} testID="adjust-note" />
      <Button title="Save adjustment" onPress={() => void save()} testID="adjust-save" />
    </Card>
  );
}

type Draft = { item: SearchHit; qty: string; cost: string; batchNo: string; expiry: string };

/** Goods in from a supplier. Cost is per unit before GST (as printed on most distributor bills). */
function PurchaseForm({ onDone }: { onDone: (msg: string) => void }) {
  const [supplierId, setSupplierId] = useState<string>('none');
  const [newSupplier, setNewSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: suppliers } = useLiveQuery(['supplier'], listSuppliers);
  const { hits } = useItemSearch(q, 80, 6);

  const addLine = (item: SearchHit) => {
    setLines((ls) => ls.some((l) => l.item.id === item.id) ? ls
      : [...ls, { item, qty: '1', cost: (item.cost_paise / 100).toFixed(2), batchNo: '', expiry: '' }]);
    setQ('');
  };
  const edit = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const parsed: (PurchaseLineInput | null)[] = lines.map((l) => {
    const qtyMilli = parseOr(() => parseQuantity(l.qty, l.item.unit));
    const costPaise = parseOr(() => parseRupees(l.cost));
    if (!qtyMilli || costPaise === null) return null;
    return {
      itemId: l.item.id, qtyMilli, costPaise, gstBp: l.item.gst_bp,
      batch: l.item.track_batches && l.batchNo.trim() ? { batchNo: l.batchNo, expiry: l.expiry.trim() || null, mrpPaise: l.item.mrp_paise } : null,
    };
  });
  const valid = parsed.length > 0 && parsed.every(Boolean);
  const totals = valid ? purchaseTotals(parsed as PurchaseLineInput[]) : null;

  const addSupplier = async () => {
    const id = await createSupplier(await getDb(), await getWriter(), { name: newSupplier });
    setSupplierId(id);
    setNewSupplier('');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await recordPurchase(await getDb(), await getWriter(), {
        supplierId: supplierId === 'none' ? null : supplierId, invoiceNo, lines: parsed as PurchaseLineInput[],
      });
      setLines([]); setInvoiceNo('');
      onDone(`Purchase saved: ${p.lines.length} items, ${formatRupees(p.totalPaise)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.sm }}>
        <Text variant="label" tone="ink2">Supplier</Text>
        <Chips options={[{ value: 'none', label: 'None' }, ...(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          value={supplierId} onChange={setSupplierId} testID="purchase-supplier" />
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <Field label="New supplier" value={newSupplier} onChangeText={setNewSupplier} containerStyle={{ flex: 1 }} testID="purchase-new-supplier" />
          <Button title="Add" kind="secondary" disabled={!newSupplier.trim()} onPress={() => void addSupplier()} testID="purchase-add-supplier" />
        </View>
        <Field label="Supplier invoice no." value={invoiceNo} onChangeText={setInvoiceNo} testID="purchase-invoice" />
      </Card>
      <Field label="Add item" value={q} onChangeText={setQ} placeholder="Search name or barcode" testID="purchase-search" />
      {hits.map((h) => (
        <Line key={h.id} title={h.name} sub={`in stock ${formatQuantity(h.qty_milli, h.unit)}`} right="+ add" tone="saffron"
          onPress={() => addLine(h)} testID={`purchase-hit-${h.id}`} />
      ))}
      {lines.map((l, i) => (
        <Card key={l.item.id} style={{ gap: space.sm }} testID={`purchase-line-${l.item.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="heading" style={{ flex: 1 }}>{l.item.name}</Text>
            <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} accessibilityRole="button" testID={`purchase-remove-${l.item.id}`}>
              <Text tone="brick">Remove</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Field label={`Qty (${l.item.unit})`} value={l.qty} onChangeText={(v) => edit(i, { qty: v })} keyboardType="decimal-pad"
              containerStyle={{ flex: 1 }} testID={`purchase-qty-${l.item.id}`} error={parsed[i] ? null : 'check'} />
            <Field label={`Cost/${l.item.unit} ex-GST (₹)`} value={l.cost} onChangeText={(v) => edit(i, { cost: v })} keyboardType="decimal-pad"
              containerStyle={{ flex: 1 }} testID={`purchase-cost-${l.item.id}`} />
          </View>
          {l.item.track_batches ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Field label="Batch" value={l.batchNo} onChangeText={(v) => edit(i, { batchNo: v })} containerStyle={{ flex: 1 }} testID={`purchase-batch-${l.item.id}`} />
              <Field label="Expiry (YYYY-MM-DD)" value={l.expiry} onChangeText={(v) => edit(i, { expiry: v })} containerStyle={{ flex: 1 }} testID={`purchase-expiry-${l.item.id}`} />
            </View>
          ) : null}
        </Card>
      ))}
      {totals ? (
        <Text tone="ink2" testID="purchase-total">
          Taxable {formatRupees(totals.taxablePaise)} + GST {formatRupees(totals.taxPaise)} = {formatRupees(totals.totalPaise)}
        </Text>
      ) : null}
      {error ? <Text tone="brick">{error}</Text> : null}
      <Button title="Save purchase (stock in)" onPress={() => void save()} disabled={!valid} loading={busy} testID="purchase-save" />
    </View>
  );
}

export default function StockScreen() {
  const owner = useSession((s) => s.device?.role === 'owner');
  const [tab, setTab] = useState<Tab>('low');
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [today] = useState(() => localDay(Date.now()));
  const { data: low } = useLiveQuery(['item', 'stock', 'bill', 'purchase'], (db) => lowStock(db), []);
  const { data: expiring } = useLiveQuery(['item', 'stock', 'bill', 'purchase'], (db) => expiringBatches(db, today, 30), [today]);
  const { data: purchases } = useLiveQuery(['purchase', 'supplier'], (db) => listPurchases(db), []);

  if (!owner) return <Screen><Text tone="ink2">Only the owner can change stock. Use the owner&apos;s phone for this.</Text></Screen>;

  const done = (msg: string) => { setTarget(null); setNotice(msg); };
  const pick = (t: Target) => { setTarget(t); setNotice(null); };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Chips options={TABS} value={tab} onChange={(t) => { setTab(t); setTarget(null); }} testID="stock-tab" />
        {notice ? <Text tone="leaf" testID="stock-notice">{notice}</Text> : null}
        {target ? <AdjustForm key={`${target.itemId}:${target.batchId ?? ''}`} target={target} onDone={done} /> : null}
        {tab === 'low' ? (
          (low ?? []).length === 0 ? <Text tone="ink3">Nothing below its re-order level.</Text>
            : (low ?? []).map((r) => (
              <Line key={r.id} title={r.name} sub={`re-order at ${formatQuantity(r.low_stock_milli, r.unit as Unit)}`}
                right={formatQuantity(r.qty_milli, r.unit as Unit)} tone={r.qty_milli <= 0 ? 'brick' : 'saffron'}
                onPress={() => pick({ itemId: r.id, name: r.name, unit: r.unit as Unit, suggest: 'count' })} testID={`low-${r.id}`} />
            ))
        ) : null}
        {tab === 'expiry' ? (
          (expiring ?? []).length === 0 ? <Text tone="ink3">No batches expire in the next 30 days.</Text>
            : (expiring ?? []).map((r) => (
              <Line key={r.batch_id} title={r.name}
                sub={`batch ${r.batch_no || '—'} · ${r.days_left < 0 ? `expired ${-r.days_left}d ago` : r.days_left === 0 ? 'expires today' : `${r.days_left}d left`} (${r.expiry})`}
                right={formatQuantity(r.qty_milli, r.unit as Unit)} tone={r.days_left <= 0 ? 'brick' : 'saffron'}
                onPress={() => pick({ itemId: r.item_id, name: r.name, unit: r.unit as Unit, batchId: r.batch_id, suggest: 'expiry' })} testID={`exp-${r.batch_id}`} />
            ))
        ) : null}
        {tab === 'purchase' ? <PurchaseForm onDone={(m) => { setNotice(m); setTab('history'); }} /> : null}
        {tab === 'history' ? (
          (purchases ?? []).length === 0 ? <Text tone="ink3">No purchases yet.</Text>
            : (purchases ?? []).map((p) => (
              <Line key={p.id} title={p.supplier ?? 'No supplier'} sub={`${p.invoice_no || 'no invoice no.'} · ${p.lines} items · ${new Date(p.created_at).toLocaleDateString('en-IN')}`}
                right={formatRupees(p.total_paise)} testID={`purchase-${p.id}`} />
            ))
        ) : null}
      </ScrollView>
    </Screen>
  );
}
