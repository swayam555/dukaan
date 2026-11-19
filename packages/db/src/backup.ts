import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { decodeHlc } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from './driver';
import { tablesChanged, type Table } from './changes';
import { getMeta, setMeta } from './repos/meta';
import { META, type DeviceIdentity, type LockSettings, type ShopProfile } from './repos/shop';
import { applyOp } from './sync/apply';
import type { Op } from './sync/ops';
import { insertOpLog } from './sync/writer';

/**
 * Encrypted backup = the whole op log + the meta needed to boot (shop, device, bill series, sync cursor).
 * Everything else (items, stock, bills, khata) is rebuilt by replaying the ops, so the backup can't drift
 * from what the app would compute, and a restored phone carries on syncing where the old one stopped.
 *
 * File: "DKBK" | version (1 byte) | header length (u32 BE) | header JSON | AES-256-GCM(ciphertext + tag).
 * Key = scrypt(passphrase, salt). The header (shop name, date, op count, KDF params, nonce) is plain so the
 * restore screen can show what's inside before asking for the passphrase; it is bound to the ciphertext as
 * GCM associated data, so editing it breaks decryption.
 */
const MAGIC = [0x44, 0x4b, 0x42, 0x4b]; // DKBK
const VERSION = 1;
/** Phone-friendly: 16 MiB of memory, about a second on a low-end Android under Hermes. */
export const BACKUP_KDF = { N: 2 ** 14, r: 8, p: 1 } as const;

export type BackupHeader = {
  shopId: string; shopName: string; createdAt: number; ops: number;
  kdf: { alg: 'scrypt'; N: number; r: number; p: number; salt: string }; nonce: string;
};
type Body = {
  shop: ShopProfile; device: DeviceIdentity; billSeries: { prefix: string; next_seq: number }[];
  sync: { key: string; value: string }[];
  quarantine: { op_id: string; raw: string; reason: string; at: number }[];
  ops: (Op & { serverSeq: number | null; local: boolean })[];
};

export class BackupError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const deriveKey = (pass: string, salt: Uint8Array, k: { N: number; r: number; p: number }) => scrypt(pass.normalize('NFKC'), salt, { ...k, dkLen: 32 });

export async function createBackup(
  db: SqlExecutor, passphrase: string, opts: { now?: number; kdf?: { N: number; r: number; p: number } } = {},
): Promise<{ bytes: Uint8Array; header: BackupHeader }> {
  if (passphrase.length < 8) throw new BackupError('passphrase must be at least 8 characters');
  const shop = await getMeta<ShopProfile>(db, META.shop);
  const device = await getMeta<DeviceIdentity>(db, META.device);
  if (!shop || !device) throw new BackupError('shop is not set up');
  const { rows: billSeries } = await db.execute<{ prefix: string; next_seq: number }>('SELECT prefix, next_seq FROM bill_series');
  const { rows: sync } = await db.execute<{ key: string; value: string }>('SELECT key, value FROM sync_state');
  const { rows } = await db.execute<{ op_id: string; device_id: string; entity: string; entity_id: string; type: string; payload: string; hlc: string; role: string; server_seq: number | null; local: number }>(
    'SELECT op_id, device_id, entity, entity_id, type, payload, hlc, role, server_seq, local FROM op_log ORDER BY hlc');
  const ops = rows.map((r) => ({
    opId: r.op_id, shopId: shop.id, deviceId: r.device_id, entity: r.entity, entityId: r.entity_id, type: r.type,
    payload: JSON.parse(r.payload) as unknown, hlc: r.hlc, role: r.role, serverSeq: r.server_seq, local: r.local === 1,
  }) as Body['ops'][number]);
  const { rows: quarantine } = await db.execute<Body['quarantine'][number]>('SELECT op_id, raw, reason, at FROM op_quarantine');
  const body: Body = { shop, device, billSeries, sync, quarantine, ops };

  const kdf = opts.kdf ?? BACKUP_KDF;
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header: BackupHeader = {
    shopId: shop.id, shopName: shop.name, createdAt: opts.now ?? Date.now(), ops: ops.length,
    kdf: { alg: 'scrypt', ...kdf, salt: b64(salt) }, nonce: b64(nonce),
  };
  const headerBytes = enc.encode(JSON.stringify(header));
  const sealed = gcm(deriveKey(passphrase, salt, kdf), nonce, headerBytes).encrypt(enc.encode(JSON.stringify(body)));
  const out = new Uint8Array(4 + 1 + 4 + headerBytes.length + sealed.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  new DataView(out.buffer).setUint32(5, headerBytes.length);
  out.set(headerBytes, 9);
  out.set(sealed, 9 + headerBytes.length);
  return { bytes: out, header };
}

/** Reads the plain header without the passphrase (restore screen: "Sharma Kirana, 12 Nov, 4,210 entries"). */
export function readBackupHeader(bytes: Uint8Array): BackupHeader {
  if (bytes.length < 9 || MAGIC.some((m, i) => bytes[i] !== m)) throw new BackupError('not a Dukaan backup file');
  if (bytes[4] !== VERSION) throw new BackupError(`backup version ${bytes[4]} is newer than this app`);
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5);
  if (9 + len > bytes.length) throw new BackupError('backup file is cut short');
  return JSON.parse(dec.decode(bytes.subarray(9, 9 + len))) as BackupHeader;
}

function open(bytes: Uint8Array, passphrase: string): Body {
  const header = readBackupHeader(bytes);
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5);
  const headerBytes = bytes.subarray(9, 9 + len);
  const key = deriveKey(passphrase, unb64(header.kdf.salt), header.kdf);
  let plain: Uint8Array;
  try {
    plain = gcm(key, unb64(header.nonce), headerBytes).decrypt(bytes.subarray(9 + len));
  } catch {
    throw new BackupError('wrong passphrase, or the file was changed');
  }
  return JSON.parse(dec.decode(plain)) as Body;
}

/**
 * Restores onto a phone with no shop yet. Takes over the backed-up device identity (same bill series,
 * same pending ops), so only restore when the old phone is gone. The new PIN replaces the old one.
 */
export async function restoreBackup(
  db: SqlDriver, bytes: Uint8Array, passphrase: string, lock: { pinHash: string; pinLength: number },
): Promise<{ shop: ShopProfile; device: DeviceIdentity; ops: number; lastAt: number | null }> {
  if (await getMeta(db, META.shop)) throw new BackupError('this phone already has a shop; restore needs a fresh install');
  const body = open(bytes, passphrase);
  const tables = new Set<Table>();
  await db.transaction(async (tx) => {
    await setMeta(tx, META.shop, body.shop);
    await setMeta(tx, META.device, body.device);
    await setMeta(tx, META.lock, { ...lock, biometric: false, failedAttempts: 0, lockedUntil: 0 } satisfies LockSettings);
    for (const s of body.billSeries) await tx.execute('INSERT INTO bill_series(prefix, next_seq) VALUES (?, ?)', [s.prefix, s.next_seq]);
    for (const s of body.sync) await tx.execute('INSERT INTO sync_state(key, value) VALUES (?, ?)', [s.key, s.value]);
    for (const q of body.quarantine) await tx.execute('INSERT INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)', [q.op_id, q.raw, q.reason, q.at]);
    for (const { serverSeq, local, ...op } of body.ops) {
      // Replays everything the old phone had applied, server-rejected ops included, so the restored
      // screens match what the owner last saw.
      if (await insertOpLog(tx, op as Op, local, serverSeq)) for (const t of await applyOp(tx, op as Op)) tables.add(t);
    }
  });
  tablesChanged(...tables, 'sync');
  const last = body.ops.at(-1);
  return { shop: body.shop, device: body.device, ops: body.ops.length, lastAt: last ? decodeHlc(last.hlc).ms : null };
}
