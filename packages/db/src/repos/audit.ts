import { decodeHlc, formatQuantity, formatRupees, type Unit } from '@dukaan/core';
import type { SqlExecutor } from '../driver';
import { OWNER_ITEM_FIELDS, OWNER_LEDGER_KINDS } from '../sync/ops';

/**
 * Audit trail = a filtered view over op_log. The op log is append-only and every state change goes through
 * it, so there is no second "audit" table that could disagree with what actually happened.
 * Shown: anything that removes money or stock outside a normal sale (voids, adjustments, discounts,
 * price/cost/tax edits, opening balances, purchases, bulk imports) plus ops the server or a peer refused.
 */
export type AuditKind = 'void' | 'stock' | 'discount' | 'price' | 'ledger' | 'purchase' | 'import' | 'supplier' | 'refused';

export type AuditEntry = {
  opId: string; at: number; kind: AuditKind; type: string; role: string; deviceId: string; local: boolean;
  /** Human sentence, English. */
  summary: string;
  /** Sync status of the op: pending (not pushed), synced, rejected by server, or quarantined on pull. */
  status: 'pending' | 'synced' | 'rejected' | 'quarantined';
  reason: string;
};

const ITEM_FIELDS_SQL = OWNER_ITEM_FIELDS.map((f) => `json_extract(payload, '$.${f}') IS NOT NULL`).join(' OR ');
const LEDGER_KINDS_SQL = OWNER_LEDGER_KINDS.map((k) => `'${k}'`).join(',');

const SENSITIVE = `(
  type IN ('bill.void', 'stock.adjust', 'purchase.create', 'item.bulk', 'supplier.upsert')
  OR (type = 'item.upsert' AND (${ITEM_FIELDS_SQL}))
  OR (type = 'ledger.add' AND json_extract(payload, '$.kind') IN (${LEDGER_KINDS_SQL}))
  OR (type = 'bill.create' AND json_extract(payload, '$.discountPaise') > 0))`;

type Raw = { op_id: string; entity_id: string; type: string; role: string; device_id: string; local: number; hlc: string; payload: string; server_seq: number | null; reason: string | null; rejectReason?: string };

export async function auditTrail(
  db: SqlExecutor,
  opts: { kinds?: readonly AuditKind[]; deviceId?: string; limit?: number; beforeHlc?: string } = {},
): Promise<AuditEntry[]> {
  const limit = opts.limit ?? 100;
  const { rows: logged } = await db.execute<Raw>(
    `SELECT op_id, entity_id, type, role, device_id, local, hlc, payload, server_seq, NULL AS reason FROM op_log
     WHERE ${SENSITIVE} ${opts.beforeHlc ? 'AND hlc < ?' : ''} ${opts.deviceId ? 'AND device_id = ?' : ''}
     ORDER BY hlc DESC LIMIT ?`,
    [...(opts.beforeHlc ? [opts.beforeHlc] : []), ...(opts.deviceId ? [opts.deviceId] : []), limit],
  );
  // Peers' ops this device refused to apply (role violations from a tampered client, unknown types).
  const { rows: refused } = await db.execute<{ op_id: string; raw: string; reason: string }>(
    "SELECT op_id, raw, reason FROM op_quarantine WHERE reason <> 'drift' ORDER BY at DESC LIMIT ?", [limit]);
  const refusedReason = new Map(refused.map((q) => [q.op_id, q.reason]));
  const loggedIds = new Set(logged.map((r) => r.op_id));
  const raws: Raw[] = [
    // Our own op the server rejected: keep the op_log row, show the server's reason with it.
    ...logged.map((r) => (r.server_seq === -1 ? { ...r, rejectReason: refusedReason.get(r.op_id) ?? '' } : r)),
    ...refused.filter((q) => !loggedIds.has(q.op_id)).map((q) => {
      const op = JSON.parse(q.raw) as { entityId: string; type: string; role: string; deviceId: string; hlc: string; payload: unknown };
      return { op_id: q.op_id, entity_id: op.entityId, type: op.type, role: op.role, device_id: op.deviceId, local: 0, hlc: op.hlc, payload: JSON.stringify(op.payload), server_seq: null, reason: q.reason };
    }).filter((r) => (!opts.beforeHlc || r.hlc < opts.beforeHlc) && (!opts.deviceId || r.device_id === opts.deviceId)),
  ];

  const itemIds = new Set<string>();
  const customerIds = new Set<string>();
  const parsed = raws.map((r) => ({ r, p: JSON.parse(r.payload) as Record<string, unknown> }));
  for (const { r, p } of parsed) {
    if (typeof p.itemId === 'string') itemIds.add(p.itemId);
    if (r.type === 'item.upsert') itemIds.add(r.entity_id);
    if (typeof p.customerId === 'string') customerIds.add(p.customerId);
  }
  const items = await nameMap<{ name: string; unit: Unit }>(db, 'SELECT id, name, unit FROM item WHERE id IN', [...itemIds]);
  const customers = await nameMap<{ name: string }>(db, 'SELECT id, name FROM customer WHERE id IN', [...customerIds]);
  const bills = await nameMap<{ local_no: string }>(db, 'SELECT id, local_no FROM bill WHERE id IN',
    parsed.filter(({ r }) => r.type === 'bill.void').map(({ r }) => r.entity_id));

  const out = parsed.map(({ r, p }): AuditEntry => {
    const status: AuditEntry['status'] = r.reason !== null ? 'quarantined'
      : r.server_seq === null ? (r.local ? 'pending' : 'synced') : r.server_seq < 0 ? 'rejected' : 'synced';
    const base = { opId: r.op_id, at: decodeHlc(r.hlc).ms, type: r.type, role: r.role, deviceId: r.device_id, local: r.local === 1, status, reason: r.reason ?? r.rejectReason ?? '' };
    if (r.reason !== null) return { ...base, kind: 'refused', summary: `Refused ${r.type} from a ${r.role} device` };
    return { ...base, ...describe(r, p, items, customers, bills) };
  });
  return out.filter((e) => !opts.kinds || opts.kinds.includes(e.kind)).sort((a, b) => b.at - a.at).slice(0, limit);
}

async function nameMap<T>(db: SqlExecutor, sql: string, ids: string[]): Promise<Map<string, T>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<T & { id: string }>(`${sql} (${ids.map(() => '?').join(',')})`, ids);
  return new Map(rows.map((x) => [x.id, x]));
}

const rs = (p: unknown) => `₹${formatRupees(Number(p), { symbol: false })}`;

function describe(
  r: Raw, p: Record<string, unknown>,
  items: Map<string, { name: string; unit: Unit }>, customers: Map<string, { name: string }>, bills: Map<string, { local_no: string }>,
): { kind: AuditKind; summary: string } {
  const item = (id: unknown) => items.get(String(id));
  switch (r.type) {
    case 'bill.void': {
      const no = bills.get(r.entity_id)?.local_no;
      return { kind: 'void', summary: `Voided bill${no ? ` ${no}` : ''}${p.reason ? `: ${String(p.reason)}` : ''}` };
    }
    case 'bill.create':
      return { kind: 'discount', summary: `Bill ${String(p.localNo)} with ${rs(p.discountPaise)} discount (total ${rs(p.totalPaise)})` };
    case 'stock.adjust': {
      const it = item(p.itemId);
      const d = Number(p.deltaMilli);
      const qty = it ? formatQuantity(Math.abs(d), it.unit) : `${Math.abs(d) / 1000}`;
      return { kind: 'stock', summary: `${d > 0 ? 'Added' : 'Removed'} ${qty} ${it?.name ?? String(p.itemId)} (${String(p.reason)})${p.note ? ` · ${String(p.note)}` : ''}` };
    }
    case 'item.upsert': {
      const it = item(r.entity_id);
      const changes = OWNER_ITEM_FIELDS.filter((f) => f in p).map((f) =>
        f.endsWith('Paise') ? `${f.replace('Paise', '')} → ${rs(p[f])}` : f === 'gstBp' || f === 'cessBp' ? `${f.replace('Bp', '').toUpperCase()} → ${Number(p[f]) / 100}%` : `${f} → ${String(p[f])}`);
      return { kind: 'price', summary: `${it?.name ?? 'Item'}: ${changes.join(', ')}` };
    }
    case 'ledger.add':
      return { kind: 'ledger', summary: `${p.kind === 'opening' ? 'Opening balance' : 'Khata adjustment'} ${rs(p.amountPaise)} for ${customers.get(String(p.customerId))?.name ?? 'customer'}${p.note ? ` · ${String(p.note)}` : ''}` };
    case 'purchase.create':
      return { kind: 'purchase', summary: `Purchase ${p.invoiceNo ? `${String(p.invoiceNo)} ` : ''}${rs(p.totalPaise)}, ${(p.lines as unknown[]).length} items` };
    case 'item.bulk':
      return { kind: 'import', summary: `Imported ${(p.items as unknown[]).length} items` };
    default:
      return { kind: 'supplier', summary: `Supplier ${String(p.name ?? '')} saved` };
  }
}
