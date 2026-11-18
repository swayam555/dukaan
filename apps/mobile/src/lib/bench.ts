import { BENCH_QUERIES, percentile, searchItems, scalar, tablesChanged, upsertItems, bumpItemRank } from '@dukaan/db';
import { generateItems } from '@dukaan/seeder';
import { getDb } from './db';

export type BenchResult = { label: string; samples: number; p50: number; p95: number; p99: number; max: number; items: number };

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Dev/diagnostics only: builds the realistic 100k catalogue on the device itself. */
export async function seedCatalogue(count: number, onProgress: (done: number) => void): Promise<number> {
  const db = await getDb();
  const started = performance.now();
  const items = generateItems(count);
  for (let i = 0; i < items.length; i += 2000) {
    await db.transaction((tx) => upsertItems(tx, items.slice(i, i + 2000)));
    onProgress(Math.min(items.length, i + 2000));
    await yieldToUi();
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < items.length; i += 50) await bumpItemRank(tx, [items[i]!.id], Date.now());
  });
  await db.execute("INSERT INTO item_search(item_search) VALUES ('optimize')");
  await db.execute('ANALYZE');
  tablesChanged('item', 'stock');
  return performance.now() - started;
}

export async function runSearchBench(rounds = 6): Promise<BenchResult> {
  const db = await getDb();
  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const q of BENCH_QUERIES) {
      const s = performance.now();
      await searchItems(db, q, 30);
      if (round > 0) samples.push(performance.now() - s);
    }
    await yieldToUi();
  }
  samples.sort((a, b) => a - b);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const result = {
    label: 'search', samples: samples.length, p50: r2(percentile(samples, 50)), p95: r2(percentile(samples, 95)), p99: r2(percentile(samples, 99)), max: r2(samples.at(-1) ?? 0),
    items: (await scalar<number>(db, 'SELECT count(*) FROM item')) ?? 0,
  };
  console.log('[DUKAAN_BENCH]', JSON.stringify(result));
  return result;
}

export async function dbStats() {
  const db = await getDb();
  const [items, pages, pageSize, pendingOps, bills] = await Promise.all([
    scalar<number>(db, 'SELECT count(*) FROM item'),
    scalar<number>(db, 'PRAGMA page_count'),
    scalar<number>(db, 'PRAGMA page_size'),
    scalar<number>(db, 'SELECT count(*) FROM op_log WHERE server_seq IS NULL AND local = 1'),
    scalar<number>(db, 'SELECT count(*) FROM bill'),
  ]);
  return { items: items ?? 0, sizeMb: ((pages ?? 0) * (pageSize ?? 0)) / 1048576, pendingOps: pendingOps ?? 0, bills: bills ?? 0 };
}
