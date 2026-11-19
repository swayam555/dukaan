import { parseRupees, UNITS, uuidv7, type Unit } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import type { ItemInput } from '../repos/items';
import type { OpWriter } from '../sync/writer';
import { tablesChanged } from '../changes';
import { bomLength, CsvParser, detectDelimiter } from './csv';

/** Random-access byte source: a file on device (expo-file-system) or disk (Node). */
export type ByteSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

export type Field = 'name' | 'nameHi' | 'barcode' | 'hsn' | 'category' | 'unit' | 'mrp' | 'sale' | 'cost' | 'gst' | 'stock' | 'lowStock';

const ALIASES: Record<Field, string[]> = {
  name: ['name', 'item', 'item name', 'product', 'product name', 'description', 'item description'],
  nameHi: ['hindi name', 'name hindi', 'name_hi', 'local name', 'नाम'],
  barcode: ['barcode', 'ean', 'upc', 'bar code', 'item code', 'sku'],
  hsn: ['hsn', 'hsn code', 'hsn/sac', 'sac'],
  category: ['category', 'group', 'item group', 'department'],
  unit: ['unit', 'uom', 'units'],
  mrp: ['mrp', 'm.r.p', 'm.r.p.'],
  sale: ['price', 'sale price', 'selling price', 'rate', 'sp', 'sales price'],
  cost: ['cost', 'purchase price', 'purchase rate', 'cp', 'buying price'],
  gst: ['gst', 'gst %', 'gst%', 'tax', 'tax %', 'gst rate', 'tax rate'],
  stock: ['stock', 'qty', 'quantity', 'opening stock', 'opening qty', 'current stock'],
  lowStock: ['min stock', 'reorder level', 'low stock', 'minimum stock'],
};

export type Mapping = Partial<Record<Field, number>>;

export function guessMapping(header: readonly string[]): Mapping {
  const mapping: Mapping = {};
  const norm = header.map((h) => h.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim());
  for (const field of Object.keys(ALIASES) as Field[]) {
    const idx = norm.findIndex((h) => ALIASES[field].includes(h));
    if (idx >= 0) mapping[field] = idx;
  }
  return mapping;
}

const UNIT_ALIASES: Record<string, Unit> = { pc: 'pcs', pcs: 'pcs', nos: 'pcs', no: 'pcs', piece: 'pcs', pieces: 'pcs', ea: 'pcs', pack: 'pack', pkt: 'pack', box: 'pack', kg: 'kg', kgs: 'kg', g: 'g', gm: 'g', gms: 'g', gram: 'g', l: 'l', ltr: 'l', litre: 'l', liter: 'l', ml: 'ml' };

function parseMoney(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  return parseRupees(raw);
}

/** "18", "18%", "0.18" → 1800 basis points */
export function parseGstBp(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad GST "${raw}"`);
  return Math.round((n > 0 && n < 1 ? n * 100 : n) * 100);
}

export type RowResult = { ok: true; item: ItemInput; stockMilli: number } | { ok: false; error: string };

export function rowToItem(fields: readonly string[], m: Mapping, newId: () => string): RowResult {
  const get = (f: Field) => (m[f] === undefined ? undefined : fields[m[f]!]?.trim());
  try {
    const name = get('name');
    if (!name) return { ok: false, error: 'missing name' };
    const unitRaw = (get('unit') ?? 'pcs').toLowerCase();
    const unit = UNIT_ALIASES[unitRaw] ?? (UNITS.includes(unitRaw as Unit) ? (unitRaw as Unit) : undefined);
    if (!unit) return { ok: false, error: `unknown unit "${unitRaw}"` };
    const mrp = parseMoney(get('mrp'));
    const sale = parseMoney(get('sale')) ?? mrp;
    if (sale === undefined) return { ok: false, error: 'missing price' };
    if (sale < 0) return { ok: false, error: 'negative price' };
    const stockRaw = get('stock');
    const stock = stockRaw ? Math.round(Number(stockRaw) * 1000) : 0;
    if (!Number.isFinite(stock)) return { ok: false, error: `bad stock "${stockRaw}"` };
    const low = get('lowStock');
    const barcode = get('barcode')?.replace(/\s/g, '') || null;
    return {
      ok: true,
      stockMilli: stock,
      item: {
        id: newId(), name, nameHi: get('nameHi') ?? '', barcode, hsn: get('hsn') ?? '', category: get('category') ?? '', unit,
        mrpPaise: mrp ?? sale, salePaise: sale, costPaise: parseMoney(get('cost')) ?? 0, gstBp: parseGstBp(get('gst')),
        lowStockMilli: low ? Math.round(Number(low) * 1000) || 0 : 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ImportProgress = { bytesDone: number; totalBytes: number; rowsDone: number; rowsFailed: number };
export type ImportError = { row: number; error: string };

export type ImportOptions = {
  jobId: string;
  source: ByteSource;
  sourceName: string;
  /** Each committed batch becomes one item.bulk op, so the catalogue syncs like any other edit. */
  writer: OpWriter;
  chunkBytes?: number;
  batchRows?: number;
  onProgress?: (p: ImportProgress) => void;
  /** Lets the UI cancel; checked between batches. */
  shouldStop?: () => boolean;
  /** Yield to the event loop between batches so the UI keeps rendering. */
  yieldEvery?: () => Promise<void>;
};

type JobRow = { byte_offset: number; rows_done: number; rows_failed: number; status: string; mapping: string };

/**
 * Streams a CSV into the catalogue. Every batch (items + opening stock + checkpoint) commits in one
 * transaction, so after a crash or kill the job resumes from the last committed row boundary — nothing
 * is imported twice, nothing is skipped. Rows matching an existing barcode update that item.
 */
export async function importItemsCsv(db: SqlDriver, opts: ImportOptions): Promise<{ status: 'done' | 'stopped'; progress: ImportProgress; errors: ImportError[] }> {
  const chunkBytes = opts.chunkBytes ?? 256 * 1024;
  const batchRows = opts.batchRows ?? 1000;
  const errors: ImportError[] = [];
  const existing = (await db.execute<JobRow>('SELECT byte_offset, rows_done, rows_failed, status, mapping FROM import_job WHERE id = ?', [opts.jobId])).rows[0];
  if (existing?.status === 'done') {
    return { status: 'done', progress: { bytesDone: existing.byte_offset, totalBytes: opts.source.size, rowsDone: existing.rows_done, rowsFailed: existing.rows_failed }, errors };
  }

  let offset: number;
  let mapping: Mapping;
  let delimiter: number;
  let rowsDone = existing?.rows_done ?? 0;
  let rowsFailed = existing?.rows_failed ?? 0;

  if (existing) {
    const saved = JSON.parse(existing.mapping) as { mapping: Mapping; delimiter: number };
    mapping = saved.mapping;
    delimiter = saved.delimiter;
    offset = existing.byte_offset;
  } else {
    const head = await opts.source.read(0, Math.min(64 * 1024, opts.source.size));
    const bom = bomLength(head);
    const firstLine = new TextDecoder().decode(head.subarray(bom)).split(/\r?\n/)[0] ?? '';
    delimiter = detectDelimiter(firstLine);
    const headerParser = new CsvParser(bom, delimiter);
    const [header] = headerParser.push(head.subarray(bom));
    if (!header) throw new Error('could not read the header row');
    mapping = guessMapping(header.fields);
    if (mapping.name === undefined || (mapping.sale === undefined && mapping.mrp === undefined)) {
      throw new Error('CSV needs at least a name column and a price or MRP column');
    }
    offset = header.endOffset;
    await db.execute(
      'INSERT INTO import_job(id, source, byte_offset, rows_done, rows_failed, status, mapping, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
      [opts.jobId, opts.sourceName, offset, 'running', JSON.stringify({ mapping, delimiter }), Date.now()],
    );
  }

  const parser = new CsvParser(offset, delimiter);
  let pending: { item: ItemInput; stockMilli: number; endOffset: number }[] = [];
  let lastBoundary = offset;
  let readAt = offset;

  const flush = async () => {
    if (pending.length === 0 && lastBoundary === offset) return;
    const batch = pending;
    pending = [];
    await db.transaction(async (tx) => {
      const resolved = await resolveExisting(tx, batch.map((b) => b.item));
      if (resolved.length > 0) {
        await opts.writer.writeIn(tx, [{
          type: 'item.bulk', entity: 'item', entityId: uuidv7(),
          payload: { items: resolved, stock: batch.map((b, i) => ({ itemId: resolved[i]!.id, deltaMilli: b.stockMilli })).filter((s) => s.deltaMilli !== 0) },
        }]);
      }
      await tx.execute('UPDATE import_job SET byte_offset = ?, rows_done = ?, rows_failed = ?, updated_at = ? WHERE id = ?', [lastBoundary, rowsDone, rowsFailed, Date.now(), opts.jobId]);
    });
    offset = lastBoundary;
    tablesChanged('item', 'stock', 'sync');
    opts.onProgress?.({ bytesDone: offset, totalBytes: opts.source.size, rowsDone, rowsFailed });
    await opts.yieldEvery?.();
  };

  const handleRows = async (rows: ReturnType<CsvParser['push']>) => {
    for (const row of rows) {
      const result = rowToItem(row.fields, mapping, uuidv7);
      if (result.ok) {
        pending.push({ item: result.item, stockMilli: result.stockMilli, endOffset: row.endOffset });
        rowsDone += 1;
      } else {
        rowsFailed += 1;
        if (errors.length < 500) errors.push({ row: rowsDone + rowsFailed, error: result.error });
      }
      lastBoundary = row.endOffset;
      if (pending.length >= batchRows) await flush();
    }
  };

  while (readAt < opts.source.size) {
    if (opts.shouldStop?.()) {
      await flush();
      return { status: 'stopped', progress: { bytesDone: offset, totalBytes: opts.source.size, rowsDone, rowsFailed }, errors };
    }
    const chunk = await opts.source.read(readAt, Math.min(chunkBytes, opts.source.size - readAt));
    readAt += chunk.length;
    await handleRows(parser.push(chunk));
  }
  await handleRows(parser.end());
  await flush();
  await db.execute("UPDATE import_job SET status = 'done', updated_at = ? WHERE id = ?", [Date.now(), opts.jobId]);
  return { status: 'done', progress: { bytesDone: offset, totalBytes: opts.source.size, rowsDone, rowsFailed }, errors };
}

/** Rows whose barcode already exists update that item instead of creating a duplicate. */
async function resolveExisting(tx: SqlExecutor, items: readonly ItemInput[]): Promise<ItemInput[]> {
  const codes = items.map((i) => i.barcode).filter((c): c is string => !!c);
  if (codes.length === 0) return [...items];
  const byCode = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 500) {
    const slice = codes.slice(i, i + 500);
    const { rows } = await tx.execute<{ id: string; barcode: string }>(
      `SELECT id, barcode FROM item WHERE barcode IN (${slice.map(() => '?').join(',')})`,
      slice,
    );
    for (const r of rows) byCode.set(r.barcode, r.id);
  }
  return items.map((i) => {
    if (!i.barcode) return i;
    const known = byCode.get(i.barcode);
    if (known) return { ...i, id: known };
    byCode.set(i.barcode, i.id); // a repeated barcode later in the same batch updates this row
    return i;
  });
}
