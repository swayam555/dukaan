import { useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { space } from '@/constants/theme';
import { dbStats, runSearchBench, seedCatalogue, type BenchResult } from '@/lib/bench';
import { Button, Card, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

type Stats = Awaited<ReturnType<typeof dbStats>>;

export default function DiagnosticsScreen() {
  const c = useColors();
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchResult | null>(null);

  const refresh = useCallback(async () => setStats(await dbStats()), []);
  useEffect(() => {
    let live = true;
    void dbStats().then((s) => live && setStats(s));
    return () => { live = false; };
  }, []);

  const seed = async () => {
    setBusy('Seeding 0');
    const ms = await seedCatalogue(100_000, (n) => setBusy(`Seeding ${n.toLocaleString('en-IN')}`));
    setSeeded(`Seeded 100,000 items in ${(ms / 1000).toFixed(1)} s`);
    setBusy(null);
    await refresh();
  };

  const runBench = async () => {
    setBusy('Benchmarking search');
    setBench(await runSearchBench());
    setBusy(null);
  };

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.xs }} testID="diag-stats">
        <Text variant="heading">Database</Text>
        <Text tone="ink2">Items: {stats?.items.toLocaleString('en-IN') ?? '…'}</Text>
        <Text tone="ink2">Bills: {stats?.bills.toLocaleString('en-IN') ?? '…'}</Text>
        <Text tone="ink2">Size: {stats ? `${stats.sizeMb.toFixed(1)} MB (SQLCipher)` : '…'}</Text>
        <Text tone="ink2">Pending sync ops: {stats?.pendingOps ?? '…'}</Text>
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="heading">Performance</Text>
        <Button kind="secondary" title="Seed 100k demo catalogue" onPress={seed} disabled={!!busy} testID="diag-seed" />
        {seeded ? <Text tone="leaf" testID="diag-seeded">{seeded}</Text> : null}
        <Button kind="secondary" title="Run search benchmark" onPress={runBench} disabled={!!busy} testID="diag-bench" />
        {bench ? (
          <Text tone="ink2" testID="diag-bench-result">
            {bench.items.toLocaleString('en-IN')} items · {bench.samples} queries · p50 {bench.p50} ms · p95 {bench.p95} ms · max {bench.max} ms
          </Text>
        ) : null}
        {busy ? <Text tone="saffron" testID="diag-busy">{busy}…</Text> : null}
      </Card>
    </ScrollView>
  );
}
