import type { Op } from './ops';

/** An op as the server stores it: its place in the shop's total order. */
export type SeqOp = Op & { serverSeq: number };

export type PushResult = {
  acks: { opId: string; serverSeq: number }[];
  /** Ops the server refused (e.g. a cashier device sending an owner-only op). Never retried. */
  rejects: { opId: string; reason: string }[];
  maxSeq: number;
};

export type PullResult = { ops: SeqOp[]; nextSeq: number; hasMore: boolean };

/** The wire, abstracted: HTTP in the app, an in-memory server (with injected faults) in tests. */
export interface SyncTransport {
  push(ops: readonly Op[]): Promise<PushResult>;
  pull(since: number, limit: number): Promise<PullResult>;
  ack(seq: number): Promise<void>;
}

/** Transient failure (network down, 5xx, timeout): the engine backs off and retries. */
export class TransportError extends Error {}
