import fc from 'fast-check';
import { columns, encodeReceipt, EscPos, PAPER, receiptBlocks, toMono, utf8, type Receipt } from '../src';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

test('basic commands', () => {
  expect(hex(new EscPos().init().align('center').bold(true).line('Hi').cut().bytes())).toBe('1b401b61011b4501' + '4869' + '0a' + '1d564230');
});

test('non-ASCII text is refused (must be rasterised)', () => {
  expect(() => new EscPos().text('चीनी')).toThrow(/rasterised/);
});

test('raster header encodes width in bytes and rows, banded at 255', () => {
  const bmp = { width: 20, height: 300, data: new Uint8Array(3 * 300).fill(0xff) };
  const out = new EscPos().raster(bmp).bytes();
  expect(hex(out.subarray(0, 8))).toBe('1d76300003 00ff00'.replace(/ /g, ''));
  const second = 8 + 3 * 255;
  expect(hex(out.subarray(second, second + 8))).toBe('1d7630000300' + '2d00');
  expect(out.length).toBe(8 * 2 + 3 * 300);
});

test('toMono thresholds luma and treats transparent as white', () => {
  // 9 px wide → 2 bytes/row: black, white, transparent-black, grey(100), ... rest white
  const w = 9, rgba = new Uint8Array(w * 4).fill(255);
  rgba.set([0, 0, 0, 255], 0);
  rgba.set([0, 0, 0, 0], 8);
  rgba.set([100, 100, 100, 255], 12);
  rgba.set([0, 0, 0, 255], 32); // x = 8
  const m = toMono(rgba, w, 1);
  expect([...m.data]).toEqual([0b10010000, 0b10000000]);
});

test('columns always fit the paper width and keep the amount whole', () => {
  fc.assert(fc.property(fc.string({ maxLength: 80 }), fc.stringMatching(/^[0-9.,]{1,12}$/), fc.constantFrom(32, 48), (l, r, cols) => {
    const s = columns(l, r, cols);
    expect(s.endsWith(r)).toBe(true);
    expect(s.length).toBeLessThanOrEqual(Math.max(cols, r.length + 1));
  }));
});

const receipt: Receipt = {
  shopName: 'Sharma Kirana', address: 'Lajpat Nagar', gstin: '', billNo: 'A-000001', createdAt: new Date(2026, 10, 19, 9, 5).getTime(),
  lines: [
    { name: 'Tata Salt 1kg', unit: 'pcs', qtyMilli: 2000, unitPaise: 2800, totalPaise: 5600 },
    { name: 'चीनी (Sugar)', unit: 'kg', qtyMilli: 1500, unitPaise: 4400, totalPaise: 6600 },
  ],
  taxPaise: 0, discountPaise: 0, roundOffPaise: 0, totalPaise: 12200,
  payments: [{ mode: 'upi', amountPaise: 12200 }], footer: 'धन्यवाद', upiUri: 'upi://pay?pa=sharma@okaxis&am=122.00&cu=INR',
};

test('receipt layout: Hindi lines become raster blocks, others stay text', () => {
  const blocks = receiptBlocks(receipt, '58mm');
  const rasters = blocks.filter((b) => b.kind === 'raster-text').map((b) => (b as { text: string }).text);
  expect(rasters).toEqual(['चीनी (Sugar)', 'धन्यवाद']);
  const texts = blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text);
  expect(texts).toContain('TOTAL                  Rs 122.00');
  for (const t of texts) if (!t.startsWith('Sharma')) expect(t.length).toBeLessThanOrEqual(PAPER['58mm'].cols);
});

test('encodeReceipt asks the drawer for full-width bitmaps and ends with feed + cut', () => {
  const widths: number[] = [];
  const bytes = encodeReceipt(receiptBlocks(receipt, '80mm'), '80mm', (_b, w) => {
    widths.push(w);
    return { width: w, height: 24, data: new Uint8Array((w / 8) * 24) };
  });
  expect(widths).toEqual([576, 576]);
  expect(hex(bytes.subarray(-7))).toBe('1b6403' + '1d564230');
  expect(hex(bytes)).toContain(hex(Uint8Array.from(utf8('upi://pay'))));
});

declare const TextEncoder: new () => { encode(s: string): Uint8Array };

test('utf8 matches the platform encoder', () => {
  const enc = new TextEncoder();
  fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => {
    expect(Uint8Array.from(utf8(s))).toEqual(enc.encode(s));
  }));
});
