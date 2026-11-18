import fc from 'fast-check';
import { ClockDriftError, compareHlc, decodeHlc, encodeHlc, HlcClock, MAX_DRIFT_MS } from '../src/hlc';

describe('HLC', () => {
  it('encodes so that string order equals (ms, counter, node) order', () => {
    const h = fc.record({ ms: fc.integer({ min: 0, max: 2 ** 47 }), counter: fc.integer({ min: 0, max: 99_999 }), node: fc.constantFrom('a', 'b', 'c') });
    fc.assert(fc.property(h, h, (a, b) => {
      const tuple = a.ms - b.ms || a.counter - b.counter || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0);
      return Math.sign(compareHlc(encodeHlc(a), encodeHlc(b))) === Math.sign(tuple);
    }));
    expect(decodeHlc(encodeHlc({ ms: 5, counter: 3, node: 'dev:1' }))).toEqual({ ms: 5, counter: 3, node: 'dev:1' });
  });

  it('is strictly monotonic even when the wall clock goes backwards', () => {
    let wall = 1000;
    const clock = new HlcClock('a', () => wall);
    const seen: string[] = [];
    for (const step of [0, 5, -100, 0, 0, 3, -2]) {
      wall += step;
      seen.push(clock.now());
    }
    for (let i = 1; i < seen.length; i++) expect(compareHlc(seen[i - 1]!, seen[i]!)).toBe(-1);
  });

  it('receive() moves past the remote timestamp (happens-before is preserved)', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.boolean(), fc.integer({ min: -50, max: 50 })), { maxLength: 60 }), (steps) => {
      let wallA = 10_000;
      let wallB = 9_000; // B's clock is behind
      const a = new HlcClock('a', () => wallA);
      const b = new HlcClock('b', () => wallB);
      for (const [aToB, drift] of steps) {
        wallA += Math.max(0, drift);
        wallB += Math.max(0, -drift);
        const [from, to] = aToB ? [a, b] : [b, a];
        const sent = from.now();
        const received = to.receive(sent);
        if (compareHlc(received, sent) <= 0) return false;
      }
      return true;
    }));
  });

  it('rejects a remote clock more than 24h ahead', () => {
    const clock = new HlcClock('a', () => 1_000);
    const evil = encodeHlc({ ms: 1_000 + MAX_DRIFT_MS + 1, counter: 0, node: 'z' });
    expect(() => clock.receive(evil)).toThrow(ClockDriftError);
  });

  it('survives counter overflow without going backwards', () => {
    const clock = new HlcClock('a', () => 5);
    let prev = clock.now();
    for (let i = 0; i < 100_005; i++) {
      const next = clock.now();
      expect(next > prev).toBe(true);
      prev = next;
    }
  });
});
