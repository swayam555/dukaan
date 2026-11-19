import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImportProgress } from '@dukaan/db';
import { space } from '@/constants/theme';
import { discardImport, loadActiveImport, pickCsv, runImport, type ActiveImport, type ImportOutcome } from '@/lib/csv-import';
import { useSession } from '@/state/session';
import { Button, Card, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

const n = (x: number) => x.toLocaleString('en-IN');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Owner-only bulk catalogue import. The importer checkpoints every batch, so Stop (or the app being
 * killed) leaves a job that resumes from the last committed row.
 */
export default function ImportScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const owner = useSession((s) => s.device?.role === 'owner');
  const [active, setActive] = useState<ActiveImport | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    void loadActiveImport().then((a) => live && setActive(a));
    return () => { live = false; };
  }, []);

  if (!owner) {
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, padding: space.lg }}>
        <Text tone="ink2" testID="import-owner-only">Only the shop owner can import items.</Text>
      </View>
    );
  }

  const start = async (a: ActiveImport) => {
    setActive(a);
    setResult(null);
    setError(null);
    setRunning(true);
    stop.current = false;
    const t0 = performance.now();
    let first: number | null = null;
    try {
      const out = await runImport(a, {
        shouldStop: () => stop.current,
        onProgress: (p) => {
          first ??= p.rowsDone;
          const s = (performance.now() - t0) / 1000;
          setProgress(p);
          if (s > 0.2) setRate(Math.round((p.rowsDone - first) / s));
        },
      });
      setProgress(out.progress);
      setResult(out);
      if (out.status === 'done') setActive(null);
    } catch (e) {
      setError(msg(e));
      if (first === null) { // failed before any row committed (e.g. no name / price column): nothing to resume
        await discardImport(a).catch(() => undefined);
        setActive(null);
      }
    } finally {
      setRunning(false);
    }
  };

  const choose = async () => {
    setError(null);
    try {
      const a = await pickCsv();
      if (a) await start(a);
    } catch (e) {
      setError(msg(e));
    }
  };

  const discard = async () => {
    if (!active) return;
    await discardImport(active);
    setActive(null);
    setProgress(null);
    setResult(null);
  };

  const pct = progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.totalBytes) * 100)) : 0;
  const stopped = active && !running && result?.status !== 'done';

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + insets.bottom, gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <Text variant="heading">Import items from CSV</Text>
        <Text tone="ink2">
          Needs a name column and a price or MRP column. Optional: Hindi name, barcode, HSN, category, unit, cost, GST %, stock, low-stock level.
          Rows with an existing barcode update that item.
        </Text>
      </Card>

      {stopped ? (
        <Card style={{ gap: space.sm }} testID="import-resume-card">
          <Text variant="heading">Unfinished import</Text>
          <Text tone="ink2">{active.name}{progress ? ` · ${n(progress.rowsDone)} rows done` : ''}</Text>
          <Button title="Resume" onPress={() => void start(active)} testID="import-resume" />
          <Button title="Discard the rest" kind="ghost" onPress={() => void discard()} testID="import-discard" />
        </Card>
      ) : null}

      {running && progress ? (
        <Card style={{ gap: space.sm }} testID="import-progress">
          <Text>{active?.name}</Text>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: c.line, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: '100%', backgroundColor: c.saffron }} />
          </View>
          <Text tone="ink2" testID="import-progress-text">
            {pct}% · {n(progress.rowsDone)} rows{progress.rowsFailed ? ` · ${n(progress.rowsFailed)} skipped` : ''}{rate ? ` · ${n(rate)} rows/s` : ''}
          </Text>
          <Button title="Stop" kind="secondary" onPress={() => { stop.current = true; }} testID="import-stop" />
        </Card>
      ) : null}

      {result?.status === 'done' ? (
        <Card style={{ gap: space.xs }} testID="import-done">
          <Text variant="heading" tone="leaf">Import finished</Text>
          <Text testID="import-done-text">{n(result.progress.rowsDone)} items imported · {n(result.progress.rowsFailed)} rows skipped</Text>
          {result.errors.slice(0, 10).map((e) => (
            <Text key={e.row} variant="caption" tone="brick">Row {e.row}: {e.error}</Text>
          ))}
        </Card>
      ) : null}

      {error ? <Text tone="brick" testID="import-error">{error}</Text> : null}
      {!running && !stopped ? <Button title="Choose CSV file" onPress={() => void choose()} testID="import-choose" /> : null}
    </ScrollView>
  );
}
