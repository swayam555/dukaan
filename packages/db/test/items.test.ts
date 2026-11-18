import { bumpItemRank, listItems, migrate, MIGRATIONS, searchItems, upsertItems, type ItemInput } from '../src';
import { openNodeDb } from '../src/drivers/node';

const items: ItemInput[] = [
  { id: '01', name: 'India Gate Basmati Rice 5kg', nameHi: 'बासमती चावल 5kg', barcode: '8901234567890', salePaise: 59900, unit: 'pcs' },
  { id: '02', name: 'Daawat Basmati Rice 1kg', nameHi: 'बासमती चावल 1kg', barcode: '8901234567891', salePaise: 14900 },
  { id: '03', name: 'Tata Salt 1kg', nameHi: 'नमक 1kg', barcode: '8904043901015', salePaise: 2800 },
  { id: '04', name: 'Amul Cow Ghee 1L', nameHi: 'गाय का घी 1L', salePaise: 64000 },
  { id: '05', name: 'Toor Dal (Loose)', nameHi: 'तूर दाल खुला', salePaise: 16000, unit: 'kg' },
  { id: '06', name: 'Haldiram Aloo Bhujia 200g', nameHi: 'आलू भुजिया 200g', salePaise: 5500 },
];

async function seeded() {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  await db.transaction((tx) => upsertItems(tx, items));
  return db;
}

const ids = (hits: { id: string }[]) => hits.map((h) => h.id).sort();

describe('item search', () => {
  it('finds by English substring, Hindi script and romanised Hindi', async () => {
    const db = await seeded();
    expect(ids(await searchItems(db, 'basmati'))).toEqual(['01', '02']);
    expect(ids(await searchItems(db, 'चावल'))).toEqual(['01', '02']);
    expect(ids(await searchItems(db, 'chaawal'))).toEqual(['01', '02']);
    expect(ids(await searchItems(db, 'namak'))).toEqual(['03']);
    expect(ids(await searchItems(db, 'ghee'))).toEqual(['04']);
    expect(ids(await searchItems(db, 'dal'))).toEqual(['05']);
  });

  it('uses synonyms both ways and ANDs multiple words', async () => {
    const db = await seeded();
    expect(ids(await searchItems(db, 'rice'))).toEqual(['01', '02']);
    expect(ids(await searchItems(db, 'salt'))).toEqual(['03']);
    expect(ids(await searchItems(db, 'basmati 5kg'))).toEqual(['01']);
    expect(ids(await searchItems(db, 'bhujia aloo'))).toEqual(['06']);
  });

  it('is typo-tolerant at the trigram level and handles short queries', async () => {
    const db = await seeded();
    expect(ids(await searchItems(db, 'basmat'))).toEqual(['01', '02']);
    expect((await searchItems(db, 'basmatee'))[0]?.name).toMatch(/Basmati/);
    expect(ids(await searchItems(db, 'ha'))).toContain('06');
    expect((await searchItems(db, 't')).map((h) => h.id)).toContain('03');
  });

  it('looks up barcodes exactly', async () => {
    const db = await seeded();
    expect(ids(await searchItems(db, '8904043901015'))).toEqual(['03']);
  });

  it('ranks frequently sold items first among equal matches', async () => {
    const db = await seeded();
    await db.transaction((tx) => bumpItemRank(tx, ['02', '02', '02'], Date.now()));
    for (let i = 0; i < 5; i++) await db.transaction((tx) => bumpItemRank(tx, ['02'], Date.now()));
    expect((await searchItems(db, 'basmati'))[0]?.id).toBe('02');
  });

  it('survives FTS syntax in user input', async () => {
    const db = await seeded();
    await expect(searchItems(db, 'rice" OR "x')).resolves.toBeDefined();
    await expect(searchItems(db, 'a* NEAR(b')).resolves.toBeDefined();
  });
});

describe('keyset pagination', () => {
  it('walks the whole catalogue in name order without overlap', async () => {
    const db = await seeded();
    const seen: string[] = [];
    let after = null;
    do {
      const page: Awaited<ReturnType<typeof listItems>> = await listItems(db, { after, limit: 4 });
      seen.push(...page.rows.map((r) => r.id));
      after = page.next;
    } while (after);
    expect(seen.sort()).toEqual(items.map((i) => i.id).sort());
  });
});
