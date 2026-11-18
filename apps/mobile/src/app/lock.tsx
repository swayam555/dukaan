import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { lockoutMs, verifyPin } from '@dukaan/core';
import { getLock, saveLock } from '@dukaan/db';
import * as LocalAuthentication from 'expo-local-authentication';
import { space } from '@/constants/theme';
import { useT } from '@/i18n';
import { getDb } from '@/lib/db';
import { useSession } from '@/state/session';
import { Keypad, type KeypadKey } from '@/ui/Keypad';
import { Button, Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

export default function LockScreen() {
  const t = useT();
  const c = useColors();
  const set = useSession((s) => s.set);
  const shop = useSession((s) => s.shop);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [biometric, setBiometric] = useState(false);
  const [pinLength, setPinLength] = useState(4);

  const unlock = useCallback(() => set({ status: 'ready', unlockedAt: Date.now() }), [set]);

  useEffect(() => {
    void (async () => {
      const lock = await getLock(await getDb());
      if (lock) setPinLength(lock.pinLength);
      if (lock?.biometric && (await LocalAuthentication.hasHardwareAsync())) setBiometric(true);
    })();
  }, []);

  const tryBiometric = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: shop?.name ?? 'Dukaan' });
    if (res.success) unlock();
  }, [shop, unlock]);

  const check = useCallback(async (candidate: string) => {
    const db = await getDb();
    const lock = await getLock(db);
    if (!lock) return;
    const now = Date.now();
    if (lock.lockedUntil > now) {
      setMessage(t('lock.lockedFor', { seconds: Math.ceil((lock.lockedUntil - now) / 1000) }));
      setPin('');
      return;
    }
    if (verifyPin(candidate, lock.pinHash)) {
      await saveLock(db, { ...lock, failedAttempts: 0, lockedUntil: 0 });
      unlock();
      return;
    }
    const failedAttempts = lock.failedAttempts + 1;
    const wait = lockoutMs(failedAttempts);
    await saveLock(db, { ...lock, failedAttempts, lockedUntil: wait ? now + wait : 0 });
    setMessage(wait ? t('lock.lockedFor', { seconds: wait / 1000 }) : t('lock.wrong'));
    setPin('');
  }, [t, unlock]);

  const onKey = useCallback((key: KeypadKey) => {
    setMessage(null);
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    if (key === '.' || key === 'ok' || pin.length >= pinLength) return;
    const next = pin + key;
    setPin(next);
    if (next.length === pinLength) void check(next);
  }, [check, pin, pinLength]);

  return (
    <Screen style={{ justifyContent: 'space-between' }}>
      <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl }}>
        <Text variant="title">{shop?.name}</Text>
        <Text tone="ink2">{t('lock.title')}</Text>
        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }} accessibilityLabel={`${pin.length} digits entered`}>
          {Array.from({ length: pinLength }, (_, i) => (
            <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < pin.length ? c.saffron : c.line }} />
          ))}
        </View>
        <Text tone="brick" style={{ minHeight: 22 }} testID="lock-message">{message ?? ''}</Text>
      </View>
      <View style={{ gap: space.md }}>
        {biometric ? <Button kind="ghost" title={t('lock.biometric')} onPress={tryBiometric} /> : null}
        <Keypad onKey={onKey} allowDecimal={false} />
      </View>
    </Screen>
  );
}
