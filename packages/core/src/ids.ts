export type RandomBytes = (n: number) => Uint8Array;

type WebCrypto = { getRandomValues<T extends Uint8Array>(array: T): T };

let randomSource: RandomBytes = (n) => {
  const bytes = new Uint8Array(n);
  (globalThis as unknown as { crypto: WebCrypto }).crypto.getRandomValues(bytes);
  return bytes;
};

/** Lets the app plug in expo-crypto and tests plug in a seeded generator. */
export function setRandomSource(source: RandomBytes): void {
  randomSource = source;
}

let lastMs = 0;
let seq = 0;

/** RFC 9562 UUIDv7: 48-bit unix ms, 12-bit monotonic counter in rand_a, 62 random bits. */
export function uuidv7(nowMs: number = Date.now()): string {
  if (nowMs <= lastMs) {
    seq += 1;
    if (seq > 0xfff) {
      lastMs += 1;
      seq = 0;
    }
  } else {
    lastMs = nowMs;
    seq = 0;
  }
  const ms = lastMs;
  const rand = randomSource(8);
  const b = new Uint8Array(16);
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = (ms >>> 24) & 0xff;
  b[3] = (ms >>> 16) & 0xff;
  b[4] = (ms >>> 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | ((seq >>> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (rand[0]! & 0x3f);
  for (let i = 1; i < 8; i++) b[8 + i] = rand[i]!;
  let hex = '';
  for (const byte of b) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
