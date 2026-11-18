// Search benchmark on a generated 100k-SKU catalogue. Runs on the host (Node + better-sqlite3);
// the on-device version of the same queries lives in the app's Diagnostics screen.
import { performance } from 'node:perf_hooks';
import { generateItems } from '@dukaan/seeder';
import { percentile } from '../src/bench-queries';
import { BENCH_QUERIES, migrate, MIGRATIONS, scalar, searchItems, upsertItems, bumpItemRank } from '../src';
import { openNodeDb } from '../src/drivers/node';



async function main() {
  const count = Number(process.argv[2] ?? 100_000);
  const db = openNodeDb(process.argv[3] ?? ':memory:');
  await migrate(db, MIGRATIONS);

  let genMs = 0;
  let insertMs = 0;
  const existing = (await scalar<number>(db, 'SELECT count(*) FROM item')) ?? 0;
  if (existing < count) {
    let t = performance.now();
    const items = generateItems(count);
    genMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < items.length; i += 5000) {
      await db.transaction((tx) => upsertItems(tx, items.slice(i, i + 5000)));
    }
    insertMs = performance.now() - t;
    // Give ~2% of items a sales history so ranking has something to do.
    await db.transaction(async (tx) => {
      for (let i = 0; i < items.length; i += 50) await bumpItemRank(tx, [items[i]!.id], Date.now());
    });
    db.raw.exec("INSERT INTO item_search(item_search) VALUES ('optimize'); ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);");
  }

  const samples: number[] = [];
  const perQuery: Record<string, { hits: number; ms: number; top: string }> = {};
  for (let round = 0; round < 6; round++) {
    for (const q of BENCH_QUERIES) {
      const s = performance.now();
      const hits = await searchItems(db, q, 30);
      const ms = performance.now() - s;
      if (round > 0) samples.push(ms); // round 0 = warm-up
      if (round === 5) perQuery[q] = { hits: hits.length, ms: Math.round(ms * 100) / 100, top: hits[0]?.name.slice(0, 32) ?? '' };
    }
  }
  samples.sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 100) / 100;
  const out = {
    items: count, generateMs: r(genMs), insertMs: r(insertMs), insertPerSec: insertMs ? Math.round(count / (insertMs / 1000)) : null,
    queries: samples.length, p50: r(percentile(samples, 50)), p95: r(percentile(samples, 95)), p99: r(percentile(samples, 99)), max: r(samples.at(-1)!),
    dbPages: db.raw.pragma('page_count', { simple: true }), pageSize: db.raw.pragma('page_size', { simple: true }),
  };
  console.log(JSON.stringify(out, null, 2));
  if (process.argv.includes('--per-query')) console.table(perQuery);
}

void main();
