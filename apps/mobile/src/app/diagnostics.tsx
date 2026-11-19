import { useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { space } from '@/constants/theme';
import { dbStats, runKdfBench, runSearchBench, seedCatalogue, type BenchResult } from '@/lib/bench';
import { Button, Card, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Stats = Awaited<ReturnType<typeof dbStats>>;

export default function DiagnosticsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [kdf, setKdf] = useState<number[] | null>(null);

  const refresh = useCallback(async () => setStats(await dbStats()), []);
  useEffect(() => {
    let live = true;
    void dbStats().then((s) => live && setStats(s));
    return () => { live = false; };
  }, []);

  const seed = async (count: number) => {
    setBusy('Seeding 0');
    const ms = await seedCatalogue(count, (n) => setBusy(`Seeding ${n.toLocaleString('en-IN')}`));
    setSeeded(`Seeded ${count.toLocaleString('en-IN')} items in ${(ms / 1000).toFixed(1)} s`);
    setBusy(null);
    await refresh();
  };

  const runBench = async () => {
    setBusy('Benchmarking search');
    setBench(await runSearchBench());
    setBusy(null);
  };

  const runKdf = async () => {
    setBusy('Timing backup key derivation');
    setKdf((await runKdfBench()).ms);
    setBusy(null);
  };

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + insets.bottom, gap: space.lg }}>
      <Card style={{ gap: space.xs }} testID="diag-stats">
        <Text variant="heading">Database</Text>
        <Text tone="ink2">Items: {stats?.items.toLocaleString('en-IN') ?? '…'}</Text>
        <Text tone="ink2">Bills: {stats?.bills.toLocaleString('en-IN') ?? '…'}</Text>
        <Text tone="ink2">Size: {stats ? `${stats.sizeMb.toFixed(1)} MB (SQLCipher)` : '…'}</Text>
      </Card>
      <Card style={{ gap: space.xs }} testID="diag-sync">
        <Text variant="heading">Sync</Text>
        <Text tone="ink2">Changes in the log: {stats?.ops.toLocaleString('en-IN') ?? '…'}</Text>
        <Text tone="ink2">Waiting to send: {stats?.pendingOps ?? '…'}</Text>
        <Text tone={stats?.rejectedOps ? 'brick' : 'ink2'}>Rejected by the server: {stats?.rejectedOps ?? '…'}</Text>
        <Text tone={stats?.quarantined ? 'brick' : 'ink2'}>Refused from other phones: {stats?.quarantined ?? '…'}</Text>
        <Text tone="ink2">Server position: {stats?.pullSeq ?? '…'}</Text>
        <Button kind="secondary" title="Refresh" onPress={refresh} disabled={!!busy} testID="diag-refresh" />
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="heading">Performance</Text>
        <Button kind="secondary" title="Seed 100k demo catalogue" onPress={() => seed(100_000)} disabled={!!busy} testID="diag-seed" />
        <Button kind="ghost" title="Seed 500 demo items" onPress={() => seed(500)} disabled={!!busy} testID="diag-seed-small" />
        {seeded ? <Text tone="leaf" testID="diag-seeded">{seeded}</Text> : null}
        <Button kind="secondary" title="Run search benchmark" onPress={runBench} disabled={!!busy} testID="diag-bench" />
        {bench ? (
          <Text tone="ink2" testID="diag-bench-result">
            {bench.items.toLocaleString('en-IN')} items · {bench.samples} queries · p50 {bench.p50} ms · p95 {bench.p95} ms · max {bench.max} ms
          </Text>
        ) : null}
        <Button kind="secondary" title="Time backup key derivation" onPress={runKdf} disabled={!!busy} testID="diag-kdf" />
        {kdf ? <Text tone="ink2" testID="diag-kdf-result">scrypt N=2^14: {kdf.join(' / ')} ms</Text> : null}
        {busy ? <Text tone="saffron" testID="diag-busy">{busy}…</Text> : null}
      </Card>
    </ScrollView>
  );
}
