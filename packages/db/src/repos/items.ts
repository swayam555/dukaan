import { buildSearchKeys, keySimilarity, nameSortKey, planFuzzy, planSearch, type Unit } from '@dukaan/core';
import type { SqlExecutor, SqlValue } from '../driver';

export type ItemInput = {
  id: string;
  name: string;
  nameHi?: string;
  barcode?: string | null;
  hsn?: string;
  category?: string;
  unit?: Unit;
  mrpPaise?: number;
  salePaise: number;
  costPaise?: number;
  gstBp?: number;
  cessBp?: number;
  lowStockMilli?: number;
  trackBatches?: boolean;
};

export type ItemRow = {
  id: string;
  name: string;
  name_hi: string;
  barcode: string | null;
  hsn: string;
  category: string;
  unit: Unit;
  mrp_paise: number;
  sale_paise: number;
  cost_paise: number;
  gst_bp: number;
  cess_bp: number;
  price_incl_tax: number;
  track_batches: number;
  low_stock_milli: number;
  qty_milli: number;
};

export const ITEM_COLUMNS = `i.id, i.name, i.name_hi, i.barcode, i.hsn, i.category, i.unit, i.mrp_paise, i.sale_paise, i.cost_paise,
  i.gst_bp, i.cess_bp, i.price_incl_tax, i.track_batches, i.low_stock_milli, coalesce(st.qty_milli, 0) AS qty_milli`;

const INSERT_ITEM = `INSERT INTO item(id, name, name_hi, translit, name_key, barcode, hsn, category, unit, mrp_paise, sale_paise,
  cost_paise, gst_bp, cess_bp, track_batches, low_stock_milli, updated_hlc)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_hi = excluded.name_hi, translit = excluded.translit,
    name_key = excluded.name_key, barcode = excluded.barcode, hsn = excluded.hsn, category = excluded.category, unit = excluded.unit,
    mrp_paise = excluded.mrp_paise, sale_paise = excluded.sale_paise, cost_paise = excluded.cost_paise, gst_bp = excluded.gst_bp,
    cess_bp = excluded.cess_bp, track_batches = excluded.track_batches, low_stock_milli = excluded.low_stock_milli,
    updated_hlc = excluded.updated_hlc`;

export function itemParams(item: ItemInput, hlc = ''): SqlValue[] {
  const nameHi = item.nameHi ?? '';
  return [
    item.id, item.name.trim(), nameHi, buildSearchKeys(item.name, nameHi), nameSortKey(item.name), item.barcode || null,
    item.hsn ?? '', item.category ?? '', item.unit ?? 'pcs', item.mrpPaise ?? item.salePaise, item.salePaise,
    item.costPaise ?? 0, item.gstBp ?? 0, item.cessBp ?? 0, item.trackBatches ? 1 : 0, item.lowStockMilli ?? 0, hlc,
  ];
}

/** Bulk upsert (used by CSV import, seeding and snapshot load). Search keys are derived here, once. */
export async function upsertItems(tx: SqlExecutor, items: readonly ItemInput[], hlc = ''): Promise<void> {
  await tx.executeMany(INSERT_ITEM, items.map((i) => itemParams(i, hlc)));
}

export async function getItem(db: SqlExecutor, id: string): Promise<ItemRow | undefined> {
  const { rows } = await db.execute<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM item i LEFT JOIN item_stock st ON st.item_id = i.id WHERE i.id = ?`, [id]);
  return rows[0];
}

export async function findByBarcode(db: SqlExecutor, code: string): Promise<ItemRow | undefined> {
  const { rows } = await db.execute<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM item i LEFT JOIN item_stock st ON st.item_id = i.id WHERE i.barcode = ? AND i.deleted = 0 LIMIT 1`,
    [code],
  );
  return rows[0];
}

export type SearchHit = ItemRow & { score: number };

/**
 * Catalogue search. FTS5 picks the best 200 candidates by bm25 (FTS5 optimises ORDER BY rank LIMIT),
 * then we re-rank those by blending in how often the item sells, so "maggi" shows the pack you
 * actually sell first.
 */
export async function searchItems(db: SqlExecutor, query: string, limit = 30): Promise<SearchHit[]> {
  const plan = planSearch(query);
  switch (plan.kind) {
    case 'empty':
      return [];
    case 'barcode': {
      const hit = await findByBarcode(db, plan.code);
      if (hit) return [{ ...hit, score: 0 }];
      const { rows } = await db.execute<SearchHit>(
        `SELECT ${ITEM_COLUMNS}, 0 AS score FROM item i LEFT JOIN item_stock st ON st.item_id = i.id
         WHERE i.barcode >= ? AND i.barcode < ? AND i.deleted = 0 ORDER BY i.barcode LIMIT ?`,
        [plan.code, `${plan.code}\uffff`, limit],
      );
      return rows;
    }
    case 'prefix': {
      const { rows } = await db.execute<SearchHit>(
        `SELECT ${ITEM_COLUMNS}, coalesce(r.score, 0) AS score
         FROM (SELECT rowid FROM item WHERE deleted = 0 AND name_key >= ? AND name_key < ? ORDER BY name_key LIMIT 200) c
         JOIN item i ON i.rowid = c.rowid
         LEFT JOIN item_rank r ON r.item_id = i.id
         LEFT JOIN item_stock st ON st.item_id = i.id
         ORDER BY score DESC, i.name_key LIMIT ?`,
        [plan.from, plan.to, limit],
      );
      return rows;
    }
    case 'fts': {
      const hits = await ftsSearch(db, plan.match, limit, plan.clauses);
      if (hits.length > 0) return hits;
      return fuzzySearch(db, query, limit);
    }
  }
}

const BROAD = 400;

async function fuzzySearch(db: SqlExecutor, query: string, limit: number): Promise<SearchHit[]> {
  const fuzzy = planFuzzy(query);
  if (!fuzzy) return [];
  const { rows } = await db.execute<SearchHit & { translit: string }>(
    `SELECT ${ITEM_COLUMNS}, coalesce(r.score, 0) AS score, i.translit
     FROM (SELECT rowid FROM item_search WHERE item_search MATCH ? LIMIT ${BROAD}) c
     JOIN item i ON i.rowid = c.rowid
     LEFT JOIN item_rank r ON r.item_id = i.id
     LEFT JOIN item_stock st ON st.item_id = i.id
     WHERE i.deleted = 0`,
    [fuzzy.match],
  );
  return rows
    .map((row) => ({ row, sim: keySimilarity(fuzzy.keys, row.translit) }))
    .filter((x) => x.sim >= 0.45 * fuzzy.keys.length)
    .sort((a, b) => b.sim - a.sim || b.row.score - a.row.score || a.row.name.length - b.row.name.length)
    .slice(0, limit)
    .map(({ row: { translit: _t, ...hit } }) => hit);
}

/**
 * Two regimes, chosen by how many rows match (measured: bm25 over 12k matches costs ~16 ms on a
 * desktop, a bounded unranked scan ~0.2 ms):
 * - narrow (≤ 400 matches): FTS5 bm25 ranking blended with sales score.
 * - broad: skip bm25. Best-sellers that match (checked with instr() on the stored keys — a trigram phrase
 *   match is exactly a substring test) come first, then the first 400 matches by shortest name.
 */
async function ftsSearch(db: SqlExecutor, match: string, limit: number, clauses?: string[][]): Promise<SearchHit[]> {
  const { rows: probe } = await db.execute<{ rowid: number }>(
    `SELECT rowid FROM item_search WHERE item_search MATCH ? LIMIT ${BROAD + 1}`,
    [match],
  );
  if (probe.length <= BROAD || !clauses) {
    const { rows } = await db.execute<SearchHit>(
      `WITH hits AS (SELECT rowid, rank FROM item_search WHERE item_search MATCH ? ORDER BY rank LIMIT 200)
       SELECT ${ITEM_COLUMNS}, coalesce(r.score, 0) AS score
       FROM hits
       JOIN item i ON i.rowid = hits.rowid
       LEFT JOIN item_rank r ON r.item_id = i.id
       LEFT JOIN item_stock st ON st.item_id = i.id
       WHERE i.deleted = 0
       ORDER BY hits.rank - 4.0 * coalesce(r.score, 0) / (coalesce(r.score, 0) + 5.0), i.name_key
       LIMIT ?`,
      [match, limit],
    );
    return rows;
  }
  const where = clauses.map((alts) => `(${alts.map(() => 'instr(i.translit, ?) > 0').join(' OR ')})`).join(' AND ');
  const { rows: popular } = await db.execute<SearchHit>(
    `SELECT ${ITEM_COLUMNS}, r.score AS score
     FROM (SELECT item_id, score FROM item_rank ORDER BY score DESC LIMIT 500) r
     JOIN item i ON i.id = r.item_id
     LEFT JOIN item_stock st ON st.item_id = i.id
     WHERE i.deleted = 0 AND ${where}
     ORDER BY r.score DESC LIMIT ?`,
    [...clauses.flat(), limit],
  );
  if (popular.length >= limit) return popular;
  const seen = new Set(popular.map((p) => p.id));
  const placeholders = probe.map(() => '?').join(',');
  const { rows: rest } = await db.execute<SearchHit>(
    `SELECT ${ITEM_COLUMNS}, 0 AS score FROM item i LEFT JOIN item_stock st ON st.item_id = i.id
     WHERE i.rowid IN (${placeholders}) AND i.deleted = 0
     ORDER BY length(i.name), i.name_key LIMIT ?`,
    [...probe.map((p) => p.rowid), limit + popular.length],
  );
  return [...popular, ...rest.filter((r) => !seen.has(r.id))].slice(0, limit);
}

export type ItemCursor = { nameKey: string; id: string } | null;

/** Keyset pagination for the catalogue list: stable and O(page) regardless of depth (no OFFSET). */
export async function listItems(
  db: SqlExecutor,
  opts: { after?: ItemCursor; limit?: number; category?: string; lowStockOnly?: boolean } = {},
): Promise<{ rows: (ItemRow & { name_key: string })[]; next: ItemCursor }> {
  const limit = opts.limit ?? 50;
  const where: string[] = ['i.deleted = 0'];
  const params: SqlValue[] = [];
  if (opts.category) {
    where.push('i.category = ?');
    params.push(opts.category);
  }
  if (opts.lowStockOnly) where.push('coalesce(st.qty_milli, 0) <= i.low_stock_milli');
  if (opts.after) {
    where.push('(i.name_key, i.id) > (?, ?)');
    params.push(opts.after.nameKey, opts.after.id);
  }
  const { rows } = await db.execute<ItemRow & { name_key: string }>(
    `SELECT ${ITEM_COLUMNS}, i.name_key FROM item i LEFT JOIN item_stock st ON st.item_id = i.id
     WHERE ${where.join(' AND ')} ORDER BY i.name_key, i.id LIMIT ?`,
    [...params, limit],
  );
  const last = rows.at(-1);
  return { rows, next: rows.length === limit && last ? { nameKey: last.name_key, id: last.id } : null };
}

/** Decayed sales count: the old score halves after 14 idle days (hyperbolic decay, no math functions needed). */
export async function bumpItemRank(tx: SqlExecutor, itemIds: readonly string[], nowMs: number): Promise<void> {
  await tx.executeMany(
    `INSERT INTO item_rank(item_id, score, last_sold) VALUES (?, 1, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       score = item_rank.score * (1.0 / (1.0 + (excluded.last_sold - item_rank.last_sold) / 1209600000.0)) + 1,
       last_sold = excluded.last_sold`,
    itemIds.map((id) => [id, nowMs]),
  );
}
