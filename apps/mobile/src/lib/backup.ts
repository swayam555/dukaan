import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { createBackup, readBackupHeader, type BackupHeader } from '@dukaan/db';
import { getDb } from './db';

/** Lets the busy spinner paint before scrypt blocks the JS thread for about a second. */
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 16));

/** Encrypts the op log to a .dukaan file in the cache and opens the share sheet (Drive, WhatsApp to self, USB). */
export async function exportBackup(passphrase: string, now = Date.now()): Promise<{ header: BackupHeader; bytes: number; uri: string }> {
  await nextFrame();
  const { bytes, header } = await createBackup(await getDb(), passphrase, { now });
  const dir = new Directory(Paths.cache, 'backups');
  if (!dir.exists) dir.create();
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = new File(dir, `dukaan-${stamp}.dukaan`);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Save the backup somewhere safe' });
  return { header, bytes: bytes.length, uri: file.uri };
}

/** Picks a backup file and reads its plain header (no passphrase needed for that). */
export async function pickBackup(): Promise<{ bytes: Uint8Array; header: BackupHeader } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const bytes = await new File(res.assets[0].uri).bytes();
  return { bytes, header: readBackupHeader(bytes) };
}

export { nextFrame };
