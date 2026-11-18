/**
 * Hybrid Logical Clock. Encoded as "<ms 15 digits>:<counter 5 digits>:<node>" so that plain string
 * comparison gives the total order (physical, counter, node).
 */
export type Hlc = { ms: number; counter: number; node: string };

export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;
const MAX_COUNTER = 99_999;

export class ClockDriftError extends Error {
  constructor(readonly remote: Hlc, readonly localWallMs: number) {
    super(`remote clock ${remote.ms} is more than ${MAX_DRIFT_MS} ms ahead of local ${localWallMs}`);
  }
}

export function encodeHlc(h: Hlc): string {
  return `${String(h.ms).padStart(15, '0')}:${String(h.counter).padStart(5, '0')}:${h.node}`;
}

export function decodeHlc(s: string): Hlc {
  const first = s.indexOf(':');
  const second = s.indexOf(':', first + 1);
  if (first < 0 || second < 0) throw new Error(`bad hlc "${s}"`);
  return { ms: Number(s.slice(0, first)), counter: Number(s.slice(first + 1, second)), node: s.slice(second + 1) };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private state: Hlc;

  constructor(node: string, private readonly wallClock: () => number = Date.now, initial?: string) {
    this.state = initial ? { ...decodeHlc(initial), node } : { ms: 0, counter: 0, node };
  }

  /** Timestamp for a local event (or an outgoing message). */
  now(): string {
    const wall = this.wallClock();
    if (wall > this.state.ms) {
      this.state = { ms: wall, counter: 0, node: this.state.node };
    } else {
      this.bump(this.state.ms, this.state.counter + 1);
    }
    return encodeHlc(this.state);
  }

  /** Merge a remote timestamp; returns the new local timestamp. Throws on excessive drift. */
  receive(remoteEncoded: string): string {
    const remote = decodeHlc(remoteEncoded);
    const wall = this.wallClock();
    if (remote.ms - wall > MAX_DRIFT_MS) throw new ClockDriftError(remote, wall);
    const local = this.state;
    const ms = Math.max(local.ms, remote.ms, wall);
    let counter: number;
    if (ms === local.ms && ms === remote.ms) counter = Math.max(local.counter, remote.counter) + 1;
    else if (ms === local.ms) counter = local.counter + 1;
    else if (ms === remote.ms) counter = remote.counter + 1;
    else counter = 0;
    this.bump(ms, counter);
    return encodeHlc(this.state);
  }

  peek(): string {
    return encodeHlc(this.state);
  }

  private bump(ms: number, counter: number): void {
    // Counter overflow: borrow from the future by 1 ms rather than lose monotonicity.
    this.state = counter > MAX_COUNTER ? { ms: ms + 1, counter: 0, node: this.state.node } : { ms, counter, node: this.state.node };
  }
}
