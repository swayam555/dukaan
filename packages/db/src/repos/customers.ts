import { uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import type { OpWriter } from '../sync/writer';

export type CustomerRow = { id: string; name: string; phone: string; balance_paise: number };

export async function searchCustomers(db: SqlExecutor, q: string, limit = 20): Promise<CustomerRow[]> {
  const term = q.trim();
  const { rows } = await db.execute<CustomerRow>(
    `SELECT c.id, c.name, c.phone, coalesce((SELECT sum(amount_paise) FROM ledger_entry l WHERE l.customer_id = c.id), 0) AS balance_paise
     FROM customer c WHERE c.deleted = 0 ${term ? 'AND (c.name LIKE ? OR c.phone LIKE ?)' : ''}
     ORDER BY c.name COLLATE NOCASE LIMIT ?`,
    term ? [`%${term}%`, `${term}%`, limit] : [limit],
  );
  return rows;
}

export async function createCustomer(db: SqlDriver, writer: OpWriter, input: { name: string; phone?: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('customer name required');
  const phone = (input.phone ?? '').replace(/\D/g, '').slice(-10);
  const id = uuidv7();
  await writer.write(db, [{ type: 'customer.upsert', entity: 'customer', entityId: id, payload: { name, phone } }]);
  return id;
}

/** Khata balance is derived from immutable ledger entries — never stored. Positive = customer owes. */
export async function customerBalance(db: SqlExecutor, customerId: string): Promise<number> {
  const { rows } = await db.execute<{ b: number }>('SELECT coalesce(sum(amount_paise), 0) AS b FROM ledger_entry WHERE customer_id = ?', [customerId]);
  return rows[0]?.b ?? 0;
}
