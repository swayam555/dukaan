import { HlcClock, uuidv7 } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import { tablesChanged, type Table } from '../changes';
import { applyOp } from './apply';
import type { Op, OpBody, Role } from './ops';

export type DeviceContext = { shopId: string; deviceId: string; role: Role };

export type OpDraft = OpBody & { entityId: string };

const HLC_KEY = 'hlc';

export async function loadClock(db: SqlExecutor, deviceId: string, wallClock: () => number = Date.now): Promise<HlcClock> {
  const { rows } = await db.execute<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [HLC_KEY]);
  return new HlcClock(deviceId, wallClock, rows[0]?.value);
}

export async function saveClock(tx: SqlExecutor, clock: HlcClock): Promise<void> {
  await tx.execute('INSERT INTO sync_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [HLC_KEY, clock.peek()]);
}

export async function insertOpLog(tx: SqlExecutor, op: Op, local: boolean, serverSeq: number | null): Promise<boolean> {
  const { entity, entityId, type, payload } = op;
  const res = await tx.execute(
    `INSERT OR IGNORE INTO op_log(op_id, device_id, entity, entity_id, type, payload, hlc, role, server_seq, local, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [op.opId, op.deviceId, entity, entityId, type, JSON.stringify(payload), op.hlc, op.role, serverSeq, local ? 1 : 0, Date.now()],
  );
  return res.rowsAffected === 1;
}

/**
 * The only way local state changes: drafts become ops (UUIDv7 id, HLC timestamp), are written to the op
 * log and applied — in the caller's transaction, so state and log can never disagree.
 */
export class OpWriter {
  constructor(readonly ctx: DeviceContext, readonly clock: HlcClock) {}

  stamp(draft: OpDraft): Op {
    return { ...draft, opId: uuidv7(), shopId: this.ctx.shopId, deviceId: this.ctx.deviceId, hlc: this.clock.now(), role: this.ctx.role } as Op;
  }

  async writeIn(tx: SqlExecutor, drafts: readonly OpDraft[]): Promise<{ ops: Op[]; tables: Set<Table> }> {
    const ops = drafts.map((d) => this.stamp(d));
    const tables = new Set<Table>(['sync']);
    for (const op of ops) {
      await insertOpLog(tx, op, true, null);
      for (const t of await applyOp(tx, op)) tables.add(t);
    }
    await saveClock(tx, this.clock);
    return { ops, tables };
  }

  /** Convenience: own transaction + change notification after commit. */
  async write(db: SqlDriver, drafts: readonly OpDraft[]): Promise<Op[]> {
    const { ops, tables } = await db.transaction((tx) => this.writeIn(tx, drafts));
    tablesChanged(...tables);
    return ops;
  }
}
