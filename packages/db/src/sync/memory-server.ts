import { financialYear, HlcClock, uuidv7 } from '@dukaan/core';
import { OWNER_ONLY, type Op, type Role } from './ops';
import type { PullResult, PushResult, SeqOp, SyncTransport } from './transport';

/**
 * Reference implementation of the server's sync rules, in memory. The Spring service implements the
 * same contract against Postgres; this one lets the device engine be tested against faults
 * (dropped requests/responses, duplicates, partitions) thousands of times per second.
 *
 * Rules: op_id is idempotent (a re-push returns the original seq); one gap-free sequence per shop;
 * owner-only op types from a cashier device are rejected; every new bill.create gets a server-authored
 * bill.number op carrying a gap-free number per financial year.
 */
export class MemorySyncServer {
  readonly log: SeqOp[] = [];
  private readonly byId = new Map<string, number>();
  private readonly billNo = new Map<string, number>();
  readonly acks = new Map<string, number>();
  private readonly clock: HlcClock;

  constructor(readonly shopId: string, wallClock: () => number = Date.now) {
    this.clock = new HlcClock('server', wallClock);
  }

  get maxSeq(): number {
    return this.log.length;
  }

  push(device: { deviceId: string; role: Role }, ops: readonly Op[]): PushResult {
    const res: PushResult = { acks: [], rejects: [], maxSeq: 0 };
    for (const op of ops) {
      const known = this.byId.get(op.opId);
      if (known !== undefined) {
        res.acks.push({ opId: op.opId, serverSeq: known });
        continue;
      }
      if (op.shopId !== this.shopId || op.deviceId !== device.deviceId) {
        res.rejects.push({ opId: op.opId, reason: 'wrong shop or device' });
        continue;
      }
      if (OWNER_ONLY.has(op.type) && device.role !== 'owner') {
        res.rejects.push({ opId: op.opId, reason: `${op.type} needs owner role` });
        continue;
      }
      // The role on the op is what peers check; the server stamps the device's real role.
      const seq = this.append({ ...op, role: device.role });
      res.acks.push({ opId: op.opId, serverSeq: seq });
      try { this.clock.receive(op.hlc); } catch { /* drifted device: still stored; peers quarantine it */ }
      if (op.type === 'bill.create') {
        const fy = financialYear(new Date(`${op.payload.day}T00:00:00`));
        const no = (this.billNo.get(fy) ?? 0) + 1;
        this.billNo.set(fy, no);
        this.append({ type: 'bill.number', entity: 'bill', entityId: op.entityId, payload: { globalNo: no, fy }, opId: uuidv7(), shopId: this.shopId, deviceId: 'server', hlc: this.clock.now(), role: 'owner' });
      }
    }
    res.maxSeq = this.maxSeq;
    return res;
  }

  pull(since: number, limit: number): PullResult {
    const ops = this.log.slice(since, since + limit);
    const nextSeq = since + ops.length;
    return { ops: ops.map((o) => ({ ...o })), nextSeq, hasMore: nextSeq < this.log.length };
  }

  ack(deviceId: string, seq: number): void {
    this.acks.set(deviceId, Math.max(seq, this.acks.get(deviceId) ?? 0));
  }

  /** A transport bound to one device, as the HTTP layer would authenticate it. */
  transport(device: { deviceId: string; role: Role }): SyncTransport {
    return {
      push: async (ops) => this.push(device, JSON.parse(JSON.stringify(ops)) as Op[]),
      pull: async (since, limit) => JSON.parse(JSON.stringify(this.pull(since, limit))) as PullResult,
      ack: async (seq) => this.ack(device.deviceId, seq),
    };
  }

  private append(op: Op): number {
    const serverSeq = this.log.length + 1;
    this.log.push({ ...op, serverSeq });
    this.byId.set(op.opId, serverSeq);
    return serverSeq;
  }
}
