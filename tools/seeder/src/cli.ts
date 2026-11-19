/**
 * Dev seeder. Writes a device-schema SQLite file and/or a supplier-style CSV of a deterministic catalogue.
 *   pnpm seed -- --items 100000 --customers 500 --db ./demo.db --csv ./catalogue.csv
 * The CSV uses the headers a distributor export typically has, to exercise the import mapper.
 */
import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { formatQuantity } from '@dukaan/core';
import { migrate, MIGRATIONS, upsertItems } from '@dukaan/db';
import { openNodeDb } from '@dukaan/db/src/drivers/node';
import { generateCustomers, generateItems } from './generate';

// `pnpm seed -- --items …` forwards the literal `--`, which would turn every flag into a positional.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const { values } = parseArgs({
  args: argv,
  options: {
    items: { type: 'string', default: '100000' },
    customers: { type: 'string', default: '500' },
    seed: { type: 'string', default: '42' },
    db: { type: 'string' },
    csv: { type: 'string' },
  },
});
const count = Number(values.items);
if (!Number.isInteger(count) || count <= 0) throw new Error('--items must be a positive integer');
if (!values.db && !values.csv) throw new Error('give --db and/or --csv');

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  const t0 = performance.now();
  const items = generateItems(count, Number(values.seed));
  const customers = generateCustomers(Number(values.customers));
  console.log(`generated ${items.length} items, ${customers.length} customers in ${(performance.now() - t0).toFixed(0)} ms`);

  if (values.csv) {
    const out = createWriteStream(values.csv);
    out.write('﻿Item Name,Hindi Name,Barcode,HSN Code,Category,Unit,MRP,Selling Price,Purchase Price,GST %,Opening Stock\r\n');
    for (const it of items) {
      out.write([it.name, it.nameHi, it.barcode ?? '', it.hsn, it.category, it.unit, (it.mrpPaise / 100).toFixed(2), (it.salePaise / 100).toFixed(2),
        (it.costPaise / 100).toFixed(2), String(it.gstBp / 100), formatQuantity(it.openingStockMilli, it.unit).split(' ')[0]!].map(csvCell).join(',') + '\r\n');
    }
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
    console.log(`wrote ${values.csv}`);
  }

  if (values.db) {
    const db = openNodeDb(values.db);
    await migrate(db, MIGRATIONS);
    const t = performance.now();
    for (let i = 0; i < items.length; i += 5000) await db.transaction((tx) => upsertItems(tx, items.slice(i, i + 5000)));
    await db.transaction(async (tx) => {
      for (const c of customers) {
        await tx.execute('INSERT OR REPLACE INTO customer(id, name, phone, deleted) VALUES (?, ?, ?, 0)', [c.id, c.name, c.phone]);
      }
    });
    db.raw.exec("INSERT INTO item_search(item_search) VALUES ('optimize'); ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);");
    console.log(`wrote ${values.db} in ${(performance.now() - t).toFixed(0)} ms`);
    db.raw.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
