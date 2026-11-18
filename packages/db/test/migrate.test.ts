import { migrate, MIGRATIONS, scalar, splitSql } from '../src';
import { openNodeDb } from '../src/drivers/node';

describe('migrations', () => {
  it('applies every migration to an empty database and is idempotent', async () => {
    const db = openNodeDb();
    const first = await migrate(db, MIGRATIONS);
    expect(first.from).toBe(0);
    expect(first.to).toBe(MIGRATIONS.length);
    expect(await scalar(db, 'PRAGMA user_version')).toBe(MIGRATIONS.length);
    const second = await migrate(db, MIGRATIONS);
    expect(second.applied).toEqual([]);
  });

  it('creates the tables the app depends on', async () => {
    const db = openNodeDb();
    await migrate(db, MIGRATIONS);
    const { rows } = await db.execute<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name");
    const names = rows.map((r) => r.name);
    for (const t of ['item', 'item_search', 'stock_cell', 'item_stock', 'bill', 'bill_line', 'bill_payment', 'ledger_entry', 'op_log', 'field_clock', 'sync_state']) {
      expect(names).toContain(t);
    }
  });

  it('keeps the FTS index in step with item inserts, renames and soft deletes', async () => {
    const db = openNodeDb();
    await migrate(db, MIGRATIONS);
    await db.execute("INSERT INTO item(id, name, name_hi, translit) VALUES ('a', 'Basmati Rice 1kg', 'बासमती चावल', '^basmati ^rise ^xaval')");
    const hits = (q: string) => scalar<number>(db, 'SELECT count(*) FROM item_search WHERE item_search MATCH ?', [q]);
    expect(await hits('asmat')).toBe(1);
    expect(await hits('xaval')).toBe(1);
    await db.execute("UPDATE item SET name = 'Sona Masoori 1kg', translit = '^sona ^masuri' WHERE id = 'a'");
    expect(await hits('asmat')).toBe(0);
    expect(await hits('masur')).toBe(1);
    await db.execute("UPDATE item SET deleted = 1 WHERE id = 'a'");
    expect(await hits('masur')).toBe(0);
    await db.execute("INSERT INTO item_search(item_search) VALUES ('integrity-check')");
  });

  it('refuses to run against a newer schema', async () => {
    const db = openNodeDb();
    await db.execute('PRAGMA user_version = 999');
    await expect(migrate(db, MIGRATIONS)).rejects.toThrow(/newer than this app/);
  });

  it('rolls back a failing migration and leaves the version untouched', async () => {
    const db = openNodeDb();
    await migrate(db, MIGRATIONS);
    const broken = [...MIGRATIONS, { version: MIGRATIONS.length + 1, name: 'bad.sql', sql: 'CREATE TABLE ok_one(x);\nCREATE TABLE ok_one(x);' }];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(await scalar(db, 'PRAGMA user_version')).toBe(MIGRATIONS.length);
    expect(await scalar(db, "SELECT count(*) FROM sqlite_master WHERE name = 'ok_one'")).toBe(0);
  });

  it('splits trigger bodies as one statement', () => {
    const parts = splitSql('CREATE TABLE a(x);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN\n  SELECT 1;\n  SELECT 2;\nEND;\n-- c\nSELECT 3;');
    expect(parts).toHaveLength(3);
    expect(parts[1]).toMatch(/BEGIN[\s\S]*SELECT 2;[\s\S]*END$/);
  });
});
