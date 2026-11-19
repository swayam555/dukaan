import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { getShop } from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { apiFor, DEFAULT_SYNC_URL, disconnect, getSyncToken, loadSyncConfig, saveConnection, syncNow, useSync } from '@/lib/sync';
import { useSession } from '@/state/session';
import { Button, Card, Field, Pill, Text } from '@/ui/primitives';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(ts).toLocaleString();
}

/** Settings → Cloud sync. Owner connects the shop with a phone OTP; once connected, adds counter phones with a pairing code. */
export function SyncCard() {
  const device = useSession((s) => s.device);
  const { config, state, lastOkAt, lastError, pending, set } = useSync();
  const [url, setUrl] = useState(DEFAULT_SYNC_URL);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [pairing, setPairing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadSyncConfig().then((c) => set({ config: c })); }, [set]);
  if (!device) return null;
  const owner = device.role === 'owner';

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  if (!config) {
    if (!owner) return null;
    return (
      <Card style={{ gap: space.md }}>
        <Text variant="heading">Cloud sync</Text>
        <Text tone="ink2">Dukaan works fully offline. Connect to back up your shop and use more than one phone at the counter.</Text>
        <Field label="Server" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" testID="sync-url" />
        <Field label="Owner mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={13} editable={!otpSent} testID="sync-phone" />
        {otpSent ? <Field label="6-digit code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} testID="sync-otp" /> : null}
        {error ? <Text tone="brick" testID="sync-error">{error}</Text> : null}
        {!otpSent ? (
          <Button title="Send code" loading={busy} disabled={phone.replace(/\D/g, '').length < 10} testID="sync-send"
            onPress={run(async () => {
              const r = await apiFor(url).requestOtp(phone);
              setOtpSent(true);
              if (r.devOtp) setOtp(r.devOtp); // dev server only (dukaan.dev-otp-in-response)
            })} />
        ) : (
          <Button title="Connect" loading={busy} disabled={otp.length !== 6} testID="sync-connect"
            onPress={run(async () => {
              const db = await getDb();
              const shop = (await getShop(db))!;
              const res = await apiFor(url).verifyOtp(phone, otp,
                { id: shop.id, name: shop.name, gstin: shop.gstin, stateCode: shop.stateCode },
                { id: device.id, name: `Counter ${device.prefix}`, prefix: device.prefix });
              await saveConnection({ url, phone }, res.token);
            })} />
        )}
      </Card>
    );
  }

  const tone = lastError ? 'brick' : state === 'idle' ? 'leaf' : 'saffron';
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="heading">Cloud sync</Text>
        <Pill label={lastError ? 'error' : state} tone={tone} />
      </View>
      <Text tone="ink2" testID="sync-status">Last synced {ago(lastOkAt)} · {pending} waiting to upload</Text>
      <Text variant="caption" tone="ink3">{config.url}{config.phone ? ` · ${config.phone}` : ''}</Text>
      {lastError ? <Text tone="brick" testID="sync-last-error">{lastError}</Text> : null}
      {error ? <Text tone="brick">{error}</Text> : null}
      <Button title="Sync now" kind="secondary" loading={busy} onPress={run(syncNow)} testID="sync-now" />
      {owner ? (
        pairing ? (
          <View style={{ gap: space.xs }}>
            <Text>On the new phone choose “Join a shop” and type this code (valid 5 min, once):</Text>
            <Text variant="title" selectable testID="sync-pair-code">{pairing}</Text>
          </View>
        ) : (
          <Button title="Add a counter phone" kind="secondary" loading={busy} testID="sync-pair"
            onPress={run(async () => {
              const jwt = await getSyncToken();
              const p = await apiFor(config.url, () => jwt).createPairing();
              setPairing(p.token);
              setTimeout(() => setPairing(null), p.expiresInSec * 1000); // single-use, 5 min: hide once dead
            })} />
        )
      ) : null}
      <Button title="Disconnect this phone" kind="ghost" onPress={run(disconnect)} testID="sync-disconnect" />
    </Card>
  );
}
