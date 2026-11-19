import { ClockDriftError, decodeHlc, MAX_DRIFT_MS, type HlcClock } from '@dukaan/core';
import type { SqlDriver, SqlExecutor } from '../driver';
import { tablesChanged, type Table } from '../changes';
import { applyOp } from './apply';
import { KNOWN_TYPES, OWNER_ONLY, type Op } from './ops';
import type { SeqOp, SyncTransport } from './transport';
import { insertOpLog, saveClock } from './writer';

export type SyncState = 'idle' | 'pushing' | 'pulling' | 'backoff';

export type SyncReport = { pushed: number; rejected: number; pulled: number; applied: number; quarantined: number; seq: number };

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

export type SyncEngineOptions = {
  pushBatch?: number;
  pullLimit?: number;
  /** Injectable for tests (fake time) — defaults to setTimeout/clearTimeout. */
  timers?: Timers;
  random?: () => number;
  wallClock?: () => number;
  onState?: (s: SyncState, detail?: { failures: number; retryInMs?: number; error?: unknown }) => void;
};

const PULL_SEQ = 'pull_seq';
const ACK_SEQ = 'ack_seq';
const BASE_DELAY = 2_000;
const MAX_DELAY = 5 * 60_000;

export async function readSeq(db: SqlExecutor, key: string): Promise<number> {
  const { rows } = await db.execute<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return rows[0] ? Number(rows[0].value) : 0;
}

async function writeSeq(tx: SqlExecutor, key: string, seq: number): Promise<void> {
  await tx.execute('INSERT INTO sync_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(seq)]);
}

type OpRow = { op_id: string; device_id: string; entity: string; entity_id: string; type: string; payload: string; hlc: string; role: string };

function rowToOp(r: OpRow, shopId: string): Op {
  return { opId: r.op_id, shopId, deviceId: r.device_id, entity: r.entity, entityId: r.entity_id, type: r.type, payload: JSON.parse(r.payload), hlc: r.hlc, role: r.role } as Op;
}

/** Backoff for the n-th consecutive failure (n ≥ 1): 2 s·2^(n-1), capped at 5 min, ±20 % jitter. */
export function backoffDelay(n: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.min(n - 1, 20));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Device side of sync. Push local ops (oldest HLC first, ≤ 500 per request), then pull pages from the
 * server's per-shop sequence and apply each page in one transaction together with the cursor — so a
 * crash at any point re-pulls at most one page, and re-applying it is a no-op (op_log dedupes by op_id).
 *
 * Single-flight: `sync()` while a run is in progress returns that run's promise and schedules exactly
 * one follow-up run (ops written mid-push must not wait for the next trigger).
 */
export class SyncEngine {
  state: SyncState = 'idle';
  failures = 0;
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private retry: unknown = null;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly wall: () => number;

  constructor(
    private readonly db: SqlDriver,
    private readonly transport: SyncTransport,
    private readonly clock: HlcClock,
    private readonly ctx: { shopId: string; deviceId: string },
    private readonly opts: SyncEngineOptions = {},
  ) {
    this.timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.random = opts.random ?? Math.random;
    this.wall = opts.wallClock ?? Date.now;
  }

  sync(): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (this.retry !== null) {
      this.timers.clear(this.retry);
      this.retry = null;
    }
    const run = (async () => {
      let report: SyncReport;
      try {
        do {
          this.again = false;
          report = await this.runOnce();
        } while (this.again);
        this.failures = 0;
        this.setState('idle');
        return report;
      } catch (error) {
        this.failures += 1;
        const retryInMs = backoffDelay(this.failures, this.random);
        this.setState('backoff', { failures: this.failures, retryInMs, error });
        this.retry = this.timers.set(() => {
          this.retry = null;
          this.sync().catch(() => undefined);
        }, retryInMs);
        throw error;
      } finally {
        this.running = null;
      }
    })();
    this.running = run;
    return run;
  }

  /** Stop retrying (app going to background without a scheduled task, logout). */
  stop(): void {
    if (this.retry !== null) this.timers.clear(this.retry);
    this.retry = null;
  }

  private setState(s: SyncState, detail?: { failures: number; retryInMs?: number; error?: unknown }) {
    this.state = s;
    this.opts.onState?.(s, detail ?? { failures: this.failures });
  }

  private async runOnce(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, rejected: 0, pulled: 0, applied: 0, quarantined: 0, seq: 0 };
    this.setState('pushing');
    await this.push(report);
    this.setState('pulling');
    await this.retryQuarantined(report);
    await this.pull(report);
    const acked = await readSeq(this.db, ACK_SEQ);
    if (report.seq > acked) {
      await this.transport.ack(report.seq);
      await writeSeq(this.db, ACK_SEQ, report.seq);
    }
    return report;
  }

  private async push(report: SyncReport): Promise<void> {
    const limit = this.opts.pushBatch ?? 500;
    for (;;) {
      const { rows } = await this.db.execute<OpRow>(
        `SELECT op_id, device_id, entity, entity_id, type, payload, hlc, role FROM op_log
         WHERE server_seq IS NULL AND local = 1 ORDER BY hlc LIMIT ?`, [limit]);
      if (rows.length === 0) return;
      const res = await this.transport.push(rows.map((r) => rowToOp(r, this.ctx.shopId)));
      await this.db.transaction(async (tx) => {
        await tx.executeMany('UPDATE op_log SET server_seq = ? WHERE op_id = ?', res.acks.map((a) => [a.serverSeq, a.opId]));
        // Rejected: parked with server_seq = -1 so they are never re-sent, and recorded for diagnostics.
        await tx.executeMany('UPDATE op_log SET server_seq = -1 WHERE op_id = ?', res.rejects.map((r) => [r.opId]));
        await tx.executeMany('INSERT OR IGNORE INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)',
          res.rejects.map((r) => [r.opId, JSON.stringify(rows.find((x) => x.op_id === r.opId) ?? null), `rejected: ${r.reason}`, this.wall()]));
      });
      report.pushed += res.acks.length;
      report.rejected += res.rejects.length;
      if (res.acks.length + res.rejects.length < rows.length) throw new Error('server acknowledged only part of a push batch');
      if (rows.length < limit) return;
    }
  }

  private async pull(report: SyncReport): Promise<void> {
    const limit = this.opts.pullLimit ?? 1000;
    let since = await readSeq(this.db, PULL_SEQ);
    for (;;) {
      const page = await this.transport.pull(since, limit);
      const tables = new Set<Table>(['sync']);
      await this.db.transaction(async (tx) => {
        for (const op of [...page.ops].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0))) {
          const res = await this.applyRemote(tx, op, op.serverSeq);
          if (res === 'quarantined') report.quarantined += 1;
          else if (res) {
            report.applied += 1;
            for (const t of res) tables.add(t);
          }
        }
        await writeSeq(tx, PULL_SEQ, page.nextSeq);
        await saveClock(tx, this.clock);
      });
      tablesChanged(...tables);
      report.pulled += page.ops.length;
      since = page.nextSeq;
      if (!page.hasMore) break;
    }
    report.seq = since;
  }

  /** Returns the touched tables when applied, null when already known (own op / redelivery), or 'quarantined'. */
  private async applyRemote(tx: SqlExecutor, op: Op, seq: number | null): Promise<Table[] | null | 'quarantined'> {
    const reason = !KNOWN_TYPES.has(op.type) ? `unknown type ${op.type}`
      : op.role !== 'owner' && OWNER_ONLY.has(op.type) && op.deviceId !== 'server' ? `${op.type} needs owner role`
      : null;
    if (reason) return this.quarantine(tx, op, reason);
    try {
      this.clock.receive(op.hlc);
    } catch (e) {
      if (e instanceof ClockDriftError) return this.quarantine(tx, op, 'drift');
      throw e;
    }
    if (await insertOpLog(tx, op, false, seq)) {
      await tx.execute('DELETE FROM op_quarantine WHERE op_id = ?', [op.opId]);
      return applyOp(tx, op);
    }
    // Already in the log: our own op whose push ack was lost, or a page re-pulled after a crash.
    if (seq !== null) await tx.execute('UPDATE op_log SET server_seq = ? WHERE op_id = ? AND server_seq IS NULL', [seq, op.opId]);
    return null;
  }

  private async quarantine(tx: SqlExecutor, op: Op, reason: string): Promise<'quarantined'> {
    await tx.execute('INSERT OR IGNORE INTO op_quarantine(op_id, raw, reason, at) VALUES (?, ?, ?, ?)', [op.opId, JSON.stringify(op), reason, this.wall()]);
    return 'quarantined';
  }

  /** Ops held back for clock drift are applied once our wall clock has caught up with them. */
  private async retryQuarantined(report: SyncReport): Promise<void> {
    const { rows } = await this.db.execute<{ op_id: string; raw: string }>("SELECT op_id, raw FROM op_quarantine WHERE reason = 'drift'");
    const due = rows.map((r) => JSON.parse(r.raw) as Op).filter((op) => decodeHlc(op.hlc).ms - this.wall() <= MAX_DRIFT_MS);
    if (due.length === 0) return;
    const tables = new Set<Table>();
    await this.db.transaction(async (tx) => {
      for (const op of due) {
        await tx.execute('DELETE FROM op_quarantine WHERE op_id = ?', [op.opId]);
        const res = await this.applyRemote(tx, op, (op as Partial<SeqOp>).serverSeq ?? null);
        if (res && res !== 'quarantined') {
          report.applied += 1;
          for (const t of res) tables.add(t);
        }
      }
      await saveClock(tx, this.clock);
    });
    tablesChanged(...tables);
  }
}
