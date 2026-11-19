import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { uuidv7 } from '@dukaan/core';
import { getMeta, importItemsCsv, setMeta, type ByteSource, type ImportError, type ImportProgress } from '@dukaan/db';
import { getDb } from './db';
import { getWriter } from './writer';

const META_ACTIVE = 'import.active';

/** The CSV being imported. Copied into app storage so a resume after a kill doesn't depend on the picker's cache. */
export type ActiveImport = { jobId: string; uri: string; name: string; size: number };
export type ImportOutcome = { status: 'done' | 'stopped'; progress: ImportProgress; errors: ImportError[] };

async function saveActive(a: ActiveImport | null) {
  const db = await getDb();
  if (a) await setMeta(db, META_ACTIVE, a);
  else await db.execute('DELETE FROM meta WHERE key = ?', [META_ACTIVE]);
}

export async function loadActiveImport(): Promise<ActiveImport | null> {
  const a = await getMeta<ActiveImport>(await getDb(), META_ACTIVE);
  if (!a) return null;
  if (!new File(a.uri).exists) { await saveActive(null); return null; } // file gone (app data cleared): nothing to resume
  return a;
}

/** Lets the owner pick a CSV; returns null if they cancel. */
export async function pickCsv(): Promise<ActiveImport | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  const jobId = uuidv7();
  const dir = new Directory(Paths.document, 'imports');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${jobId}.csv`);
  await new File(asset.uri).copy(dest);
  const active: ActiveImport = { jobId, uri: dest.uri, name: asset.name, size: dest.size };
  await saveActive(active);
  return active;
}

/** Random-access reads through one native file handle (the importer seeks back to the last committed row on resume). */
export function fileSource(uri: string): ByteSource & { close(): void } {
  const file = new File(uri);
  const handle = file.open();
  return {
    size: file.size,
    async read(offset, length) {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close: () => handle.close(),
  };
}

export async function runImport(active: ActiveImport, opts: { onProgress?: (p: ImportProgress) => void; shouldStop?: () => boolean } = {}): Promise<ImportOutcome> {
  const source = fileSource(active.uri);
  try {
    const out = await importItemsCsv(await getDb(), {
      jobId: active.jobId, source, sourceName: active.name, writer: await getWriter(),
      onProgress: opts.onProgress, shouldStop: opts.shouldStop,
      yieldEvery: () => new Promise((r) => setTimeout(r, 0)),
    });
    if (out.status === 'done') await finish(active);
    return out;
  } finally {
    source.close();
  }
}

async function finish(a: ActiveImport) {
  await saveActive(null);
  const f = new File(a.uri);
  if (f.exists) f.delete();
}

/** Abandon a stopped import. Rows already committed stay in the catalogue (they were real edits and may have synced). */
export async function discardImport(a: ActiveImport): Promise<void> {
  await (await getDb()).execute("UPDATE import_job SET status = 'cancelled' WHERE id = ?", [a.jobId]);
  await finish(a);
}
