import { PermissionsAndroid, Platform } from 'react-native';
import { encodeReceipt, receiptBlocks, type Paper, type Receipt } from '@dukaan/core';
import { claimPrintJob, enqueuePrint, failPrintJob, finishPrintJob, getMeta, receiptForBill, setMeta } from '@dukaan/db';
import { getPrinter } from '@dukaan/native';
import { getDb } from './db';
import { rasteriseLine } from './raster';

export type PrinterSettings = { address: string; name: string; paper: Paper; autoPrint: boolean; chunkBytes: number; gapMs: number };
const KEY = 'printer';
/** 512 B chunks with 20 ms gaps: measured to keep a 4 KB-buffer 58 mm printer from dropping raster rows. */
export const PRINTER_DEFAULTS: Omit<PrinterSettings, 'address' | 'name'> = { paper: '58mm', autoPrint: true, chunkBytes: 512, gapMs: 20 };

export async function getPrinterSettings(): Promise<PrinterSettings | null> {
  return getMeta<PrinterSettings>(await getDb(), KEY);
}
export async function savePrinterSettings(s: PrinterSettings): Promise<void> {
  await setMeta(await getDb(), KEY, s);
}

/** Android 12+ needs the runtime BLUETOOTH_CONNECT grant; older versions get it from the manifest. */
export async function ensureBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
    // Shown by Android if the owner said no once and tries again.
    title: 'Connect to your receipt printer',
    message: 'Dukaan needs "Nearby devices" only to talk to the Bluetooth printer you pair. It does not use your location or look for other devices.',
    buttonPositive: 'Continue',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export function receiptBytes(r: Receipt, paper: Paper): Uint8Array {
  return encodeReceipt(receiptBlocks(r, paper), paper, rasteriseLine);
}

async function send(bytes: Uint8Array, s: PrinterSettings): Promise<void> {
  if (!(await ensureBluetoothPermission())) throw new Error('Bluetooth permission denied');
  const p = getPrinter();
  if (p.connectedAddress !== s.address) await p.connect(s.address, 8000);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await p.write(buf, s.chunkBytes, s.gapMs);
}

export async function testPrint(s: PrinterSettings): Promise<{ bytes: number; ms: number }> {
  const t0 = Date.now();
  const bytes = receiptBytes({
    shopName: 'Dukaan test print', address: 'हिंदी: नमक, चीनी, साबुन', gstin: '', billNo: 'TEST', createdAt: Date.now(),
    lines: [{ name: 'Tata Salt 1kg', unit: 'pcs', qtyMilli: 2000, unitPaise: 2800, totalPaise: 5600 }, { name: 'बासमती चावल', unit: 'kg', qtyMilli: 1500, unitPaise: 12000, totalPaise: 18000 }],
    taxPaise: 857, discountPaise: 0, roundOffPaise: 0, totalPaise: 23600, payments: [{ mode: 'cash', amountPaise: 23600 }], footer: 'धन्यवाद', upiUri: 'upi://pay?pa=test@upi&am=1.00',
  }, s.paper);
  await send(bytes, s);
  return { bytes: bytes.length, ms: Date.now() - t0 };
}

let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
export const onPrintQueueChange = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** Saves the job first so a dead printer never loses a receipt, then kicks the queue. */
export async function printBill(billId: string): Promise<void> {
  await enqueuePrint(await getDb(), billId);
  kickPrintQueue();
}

export function kickPrintQueue(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  running ??= drain().finally(() => { running = null; });
}

async function drain(): Promise<void> {
  const db = await getDb();
  const s = await getPrinterSettings();
  if (!s?.address) return;
  for (;;) {
    const job = await claimPrintJob(db);
    if (!job) break;
    listeners.forEach((l) => l());
    try {
      const r = await receiptForBill(db, job.ref_id);
      if (!r) throw new Error('Bill not found');
      await send(receiptBytes(r, s.paper), s);
      await finishPrintJob(db, job.id);
    } catch (e) {
      await failPrintJob(db, job.id, e instanceof Error ? e.message : String(e));
      getPrinter().disconnect();
      // Stop this pass; the next due retry wakes us up.
      const next = await db.execute<{ at: number }>("SELECT min(next_at) AS at FROM print_job WHERE status = 'queued'");
      const at = next.rows[0]?.at;
      if (at) timer = setTimeout(kickPrintQueue, Math.max(at - Date.now(), 500));
      break;
    } finally {
      listeners.forEach((l) => l());
    }
  }
}
