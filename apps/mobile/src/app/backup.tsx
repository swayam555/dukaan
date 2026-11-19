import { useState } from 'react';
import { ScrollView } from 'react-native';
import { BackupError } from '@dukaan/db';
import { space } from '@/constants/theme';
import { exportBackup } from '@/lib/backup';
import { useSession } from '@/state/session';
import { Button, Card, Field, Screen, Text } from '@/ui/primitives';

/** Owner-only encrypted backup. Works with no internet and no account: the file goes wherever the owner shares it. */
export default function BackupScreen() {
  const owner = useSession((s) => s.device?.role === 'owner');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!owner) return <Screen><Text tone="ink2">Only the owner can make a backup.</Text></Screen>;

  const mismatch = pass2.length > 0 && pass !== pass2 ? 'Passphrases do not match' : null;
  const ok = pass.length >= 8 && pass === pass2;
  const run = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await exportBackup(pass);
      setNotice(`Backup ready: ${r.header.ops.toLocaleString('en-IN')} entries, ${(r.bytes / 1024).toFixed(0)} KB`);
      setPass(''); setPass2('');
    } catch (e) {
      setError(e instanceof BackupError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space.md }}>
          <Text variant="heading">Encrypted backup</Text>
          <Text tone="ink2">
            Saves every bill, khata entry, stock change and item to one file locked with your passphrase. Keep it on Google Drive
            or send it to yourself. Without the passphrase nobody can open it, and neither can we, so write it down.
          </Text>
          <Field label="Passphrase (8+ characters)" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" testID="backup-pass" />
          <Field label="Type it again" value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" error={mismatch} testID="backup-pass2" />
          {error ? <Text tone="brick" testID="backup-error">{error}</Text> : null}
          {notice ? <Text tone="leaf" testID="backup-notice">{notice}</Text> : null}
          <Button title="Make backup and share" onPress={run} disabled={!ok} loading={busy} testID="backup-run" />
        </Card>
        <Text tone="ink3">To restore: install Dukaan on the new phone and choose “Restore from a backup” on the first screen.</Text>
      </ScrollView>
    </Screen>
  );
}
