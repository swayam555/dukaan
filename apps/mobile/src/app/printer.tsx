import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { listPrintJobs, retryPrintJob, type PrintJob } from '@dukaan/db';
import { getPrinter, type PrinterDevice } from '@dukaan/native';
import { radius, space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { ensureBluetoothPermission, getPrinterSettings, kickPrintQueue, onPrintQueueChange, PRINTER_DEFAULTS, savePrinterSettings, testPrint, type PrinterSettings } from '@/lib/printer';
import { Button, Card, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

function Choice({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityState={{ selected }}
      style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? c.saffron : c.line, backgroundColor: selected ? c.saffronTint : c.surface }}>
      <Text variant="caption">{label}</Text>
    </Pressable>
  );
}

export default function PrinterScreen() {
  const c = useColors();
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const [jobs, setJobs] = useState<(PrintJob & { local_no: string | null })[]>([]);
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'brick'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(() => getDb().then(listPrintJobs).then(setJobs), []);
  useEffect(() => {
    void getPrinterSettings().then(setSettings);
    void getDb().then(listPrintJobs).then(setJobs);
    return onPrintQueueChange(() => void loadJobs());
  }, [loadJobs]);

  const scan = async () => {
    setMsg(null);
    try {
      if (!(await ensureBluetoothPermission())) throw new Error('Allow "Nearby devices" to find the printer');
      if (!getPrinter().isEnabled) throw new Error('Turn Bluetooth on, then try again');
      setDevices(await getPrinter().listPaired());
    } catch (e) {
      setMsg({ tone: 'brick', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const update = async (patch: Partial<PrinterSettings>) => {
    const next = { ...PRINTER_DEFAULTS, address: '', name: '', ...settings, ...patch };
    setSettings(next);
    await savePrinterSettings(next);
  };

  const test = async () => {
    if (!settings?.address) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await testPrint(settings);
      setMsg({ tone: 'leaf', text: `Sent ${r.bytes} bytes in ${r.ms} ms` });
    } catch (e) {
      setMsg({ tone: 'brick', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Card style={{ gap: space.md }}>
          <Text variant="heading">Receipt printer</Text>
          <Text tone="ink2" testID="printer-current">{settings?.address ? `${settings.name} · ${settings.address}` : 'No printer chosen. Pair it in Android Bluetooth settings first.'}</Text>
          <Button kind="secondary" title="Show paired printers" onPress={scan} testID="printer-scan" />
          {devices?.length === 0 ? <Text tone="ink3">No paired devices.</Text> : null}
          {devices?.map((d) => (
            <Pressable key={d.address} onPress={() => void update({ address: d.address, name: d.name })} testID={`printer-${d.address}`}
              style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: d.address === settings?.address ? c.saffron : c.line }}>
              <Text>{d.name}</Text>
              <Text variant="caption" tone="ink3">{d.address}</Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['58mm', '80mm'] as const).map((p) => (
              <Choice key={p} label={p} selected={(settings?.paper ?? PRINTER_DEFAULTS.paper) === p} onPress={() => void update({ paper: p })} testID={`paper-${p}`} />
            ))}
            <Choice label={settings?.autoPrint === false ? 'Auto-print off' : 'Auto-print on'} selected={settings?.autoPrint !== false} onPress={() => void update({ autoPrint: settings?.autoPrint === false })} testID="printer-auto" />
          </View>
          {msg ? <Text tone={msg.tone} testID="printer-msg">{msg.text}</Text> : null}
          <Button title="Test print (Hindi + QR)" onPress={test} loading={busy} disabled={!settings?.address} testID="printer-test" />
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="heading">Print queue</Text>
          {jobs.length === 0 ? <Text tone="ink3">Nothing printed in the last day.</Text> : null}
          {jobs.map((j) => (
            <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Text>{j.local_no ?? j.ref_id} · {j.status}{j.attempts > 1 ? ` · ${j.attempts} tries` : ''}</Text>
                {j.last_error ? <Text variant="caption" tone="brick" numberOfLines={1}>{j.last_error}</Text> : null}
              </View>
              {j.status === 'failed' || j.status === 'queued' ? (
                <Button kind="secondary" title="Retry" onPress={async () => { await retryPrintJob(await getDb(), j.id); kickPrintQueue(); }} />
              ) : null}
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
