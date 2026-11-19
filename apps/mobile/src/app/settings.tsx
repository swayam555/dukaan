import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { getShop, updateShop, type ShopProfile } from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { useSession } from '@/state/session';
import { Button, Card, Field, Screen, Text } from '@/ui/primitives';

export default function SettingsScreen() {
  const role = useSession((s) => s.device?.role);
  const setSession = useSession((s) => s.set);
  const [form, setForm] = useState<ShopProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => setForm(await getShop(await getDb())))();
  }, []);
  if (!form) return null;
  const owner = role === 'owner';
  const edit = (k: keyof ShopProfile) => (v: string) => { setSaved(false); setForm({ ...form, [k]: v }); };

  const save = async () => {
    setError(null);
    try {
      const next = await updateShop(await getDb(), { name: form.name, gstin: form.gstin, address: form.address, phone: form.phone, upiVpa: form.upiVpa, invoiceFooter: form.invoiceFooter });
      setForm(next);
      setSession({ shop: { id: next.id, name: next.name, gstin: next.gstin, stateCode: next.stateCode, upiVpa: next.upiVpa } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space.md }}>
          <Text variant="heading">Shop profile</Text>
          <Field label="Shop name" value={form.name} onChangeText={edit('name')} editable={owner} testID="settings-name" />
          <Field label="GSTIN (blank if unregistered)" value={form.gstin} onChangeText={edit('gstin')} autoCapitalize="characters" editable={owner} testID="settings-gstin" />
          <Field label="UPI ID for payment QR" value={form.upiVpa} onChangeText={edit('upiVpa')} autoCapitalize="none" placeholder="shopname@okaxis" editable={owner} testID="settings-upi" />
          <Field label="Address" value={form.address} onChangeText={edit('address')} editable={owner} />
          <Field label="Phone" value={form.phone} onChangeText={edit('phone')} keyboardType="phone-pad" editable={owner} />
          <Field label="Invoice footer" value={form.invoiceFooter} onChangeText={edit('invoiceFooter')} editable={owner} />
          <Text variant="caption" tone="ink3">State {form.stateCode} is fixed at setup — it decides CGST+SGST vs IGST.</Text>
          {error ? <Text tone="brick" testID="settings-error">{error}</Text> : null}
          {saved ? <Text tone="leaf" testID="settings-saved">Saved</Text> : null}
          {owner ? <Button title="Save" onPress={save} testID="settings-save" /> : <Text tone="ink3">Only the owner can change these.</Text>}
        </Card>
      </ScrollView>
    </Screen>
  );
}
