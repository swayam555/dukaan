import { scalar, type SqlDriver } from './driver';

export type Migration = { version: number; name: string; sql: string };

export type MigrationReport = { from: number; to: number; applied: string[] };

/** Applies pending migrations, each in its own transaction, tracking progress in PRAGMA user_version. */
export async function migrate(db: SqlDriver, migrations: readonly Migration[]): Promise<MigrationReport> {
  const from = (await scalar<number>(db, 'PRAGMA user_version')) ?? 0;
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) throw new Error(`database is at v${from}, newer than this app (v${latest}) — refusing to downgrade`);
  const applied: string[] = [];
  for (const m of migrations) {
    if (m.version <= from) continue;
    await db.transaction(async (tx) => {
      for (const statement of splitSql(m.sql)) await tx.execute(statement);
      await tx.execute(`PRAGMA user_version = ${m.version}`);
    });
    applied.push(m.name);
  }
  return { from, to: Math.max(from, latest), applied };
}

/** Splits a migration into statements, keeping trigger bodies (BEGIN … END;) intact. */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let depth = 0;
  for (const rawLine of sql.split('\n')) {
    const line = rawLine.replace(/--.*$/, '');
    if (!line.trim()) continue;
    current += `${line}\n`;
    if (/\bBEGIN\s*$/i.test(line.trim())) depth += 1;
    if (depth > 0 && /^\s*END;\s*$/i.test(line)) depth -= 1;
    if (depth === 0 && line.trimEnd().endsWith(';')) {
      statements.push(current.trim().replace(/;$/, ''));
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
