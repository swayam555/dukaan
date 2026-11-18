/**
 * Table-change bus for reactive queries. Writers call `tablesChanged` after their transaction commits;
 * screens subscribe to the tables they read and re-query only when one of those changes.
 */
export type Table = 'item' | 'stock' | 'bill' | 'customer' | 'ledger' | 'supplier' | 'purchase' | 'held' | 'sync' | 'print';

type Listener = (tables: ReadonlySet<Table>) => void;
const listeners = new Set<{ tables: ReadonlySet<Table>; fn: Listener }>();

export function subscribeTables(tables: readonly Table[], fn: Listener): () => void {
  const entry = { tables: new Set(tables), fn };
  listeners.add(entry);
  return () => listeners.delete(entry);
}

export function tablesChanged(...tables: Table[]): void {
  const changed = new Set(tables);
  for (const l of [...listeners]) {
    for (const t of changed) {
      if (l.tables.has(t)) {
        l.fn(changed);
        break;
      }
    }
  }
}
