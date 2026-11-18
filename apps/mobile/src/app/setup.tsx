import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { hashPin, isValidGstin, isValidPin, STATES, stateFromGstin } from '@dukaan/core';
import { createShop, validatePrefix } from '@dukaan/db';
import * as Crypto from 'expo-crypto';
import { space } from '@/constants/theme';
import { useT } from '@/i18n';
import { getDb } from '@/lib/db';
import { useSession } from '@/state/session';
import { Button, Field, Screen, Text } from '@/ui/primitives';

export default function SetupScreen() {
  const t = useT();
  const set = useSession((s) => s.set);
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('27');
  const [prefix, setPrefix] = useState('C1');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gstinError = gstin && !isValidGstin(gstin) ? t('setup.gstinInvalid') : null;
  const pinError = pin2 && pin !== pin2 ? t('setup.pinMismatch') : null;
  const canSubmit = name.trim() && !gstinError && isValidPin(pin) && pin === pin2 && validatePrefix(prefix) && stateCode in STATES;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const db = await getDb();
      const pinHash = hashPin(pin, Crypto.getRandomBytes(16));
      const { shop, device } = await createShop(db, {
        name: name.trim(), gstin: gstin.trim(), stateCode, address: '', phone: '', upiVpa: '', pharmacyMode: false, invoiceFooter: '',
        prefix, pinHash, pinLength: pin.length, deviceName: 'Counter 1',
      });
      set({
        status: 'ready',
        unlockedAt: Date.now(),
        shop: { id: shop.id, name: shop.name, gstin: shop.gstin, stateCode: shop.stateCode, upiVpa: shop.upiVpa },
        device: { id: device.id, prefix: device.prefix, role: device.role },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Text variant="title">{t('setup.title')}</Text>
        <Field label={t('setup.shopName')} value={name} onChangeText={setName} autoFocus testID="setup-name" />
        <Field
          label={t('setup.gstin')}
          value={gstin}
          autoCapitalize="characters"
          maxLength={15}
          onChangeText={(v) => {
            setGstin(v.toUpperCase());
            const fromGstin = stateFromGstin(v);
            if (v.length >= 2 && fromGstin) setStateCode(fromGstin);
          }}
          error={gstinError}
          testID="setup-gstin"
        />
        <Field label={t('setup.state')} value={`${stateCode} · ${STATES[stateCode] ?? '?'}`} editable={false} />
        <Field label={t('setup.counter')} value={prefix} maxLength={4} autoCapitalize="characters" onChangeText={(v) => setPrefix(v.toUpperCase())} testID="setup-prefix" />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field label={t('setup.pin')} value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} testID="setup-pin" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('setup.pinConfirm')} value={pin2} onChangeText={setPin2} keyboardType="number-pad" secureTextEntry maxLength={6} error={pinError} testID="setup-pin2" />
          </View>
        </View>
        {error ? <Text tone="brick">{error}</Text> : null}
        <Button title={t('setup.create')} onPress={submit} disabled={!canSubmit} loading={busy} testID="setup-submit" />
      </ScrollView>
    </Screen>
  );
}
