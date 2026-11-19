import { formatRupees } from './money';
import { formatQuantity, type Unit } from './units';

/**
 * ESC/POS byte builder for 58 mm (384 dot, 32 col) and 80 mm (576 dot, 48 col) thermal printers.
 * Cheap Bluetooth printers have no Devanagari font, so any line containing non-ASCII text is drawn
 * by the app (Skia) into a 1-bit bitmap and sent as a `GS v 0` raster block.
 */
export type Paper = '58mm' | '80mm';
export const PAPER: Record<Paper, { dots: number; cols: number }> = {
  '58mm': { dots: 384, cols: 32 },
  '80mm': { dots: 576, cols: 48 },
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = 'left' | 'center' | 'right';
/** 1 bit per pixel, row-major, MSB first, `bytesPerRow = ceil(width / 8)`. 1 = black. */
export type MonoBitmap = { width: number; height: number; data: Uint8Array };

/** UTF-8 bytes without relying on TextEncoder (Hermes has it; the core package targets plain ES2023). */
export function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export const isPrintableAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

export class EscPos {
  private chunks: number[] = [];

  init(): this {
    return this.raw(ESC, 0x40);
  }
  align(a: Align): this {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** Width/height multipliers 1–8. */
  size(w = 1, h = 1): this {
    const c = (n: number) => Math.min(Math.max(Math.trunc(n), 1), 8) - 1;
    return this.raw(GS, 0x21, (c(w) << 4) | c(h));
  }
  /** ASCII only; anything else must go through {@link raster}. */
  text(s: string): this {
    if (!isPrintableAscii(s)) throw new Error(`non-ASCII text must be rasterised: ${JSON.stringify(s)}`);
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i));
    return this;
  }
  line(s = ''): this {
    return this.text(s).raw(LF);
  }
  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.min(Math.max(lines, 0), 255));
  }
  /** Partial cut after feeding `feed` dots (printers without a cutter ignore it). */
  cut(feed = 48): this {
    return this.raw(GS, 0x56, 66, Math.min(feed, 255));
  }
  /** `GS v 0` raster bit image, split into bands of ≤ 255 rows so small printer buffers don't overflow. */
  raster(bmp: MonoBitmap, band = 255): this {
    const bpr = Math.ceil(bmp.width / 8);
    if (bmp.data.length !== bpr * bmp.height) throw new Error(`bitmap size ${bmp.data.length} != ${bpr}×${bmp.height}`);
    for (let y = 0; y < bmp.height; y += band) {
      const rows = Math.min(band, bmp.height - y);
      this.raw(GS, 0x76, 0x30, 0, bpr & 0xff, bpr >> 8, rows & 0xff, rows >> 8);
      const slice = bmp.data.subarray(y * bpr, (y + rows) * bpr);
      for (let i = 0; i < slice.length; i++) this.chunks.push(slice[i]!);
    }
    return this;
  }
  /** Native QR (GS ( k), model 2, error level M. Supported by nearly all 2015+ thermal printers. */
  qr(data: string, moduleSize = 6): this {
    const bytes = utf8(data);
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(Math.max(moduleSize, 1), 16));
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // EC level M
    this.raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30);
    for (const b of bytes) this.chunks.push(b);
    return this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  }
  raw(...bytes: number[]): this {
    for (const b of bytes) this.chunks.push(b & 0xff);
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/**
 * RGBA (e.g. Skia `readPixels`) → 1-bit. Luma threshold with alpha composited on white, so
 * anti-aliased Devanagari strokes keep their shape instead of turning into blobs.
 */
export function toMono(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, threshold = 160): MonoBitmap {
  if (rgba.length !== width * height * 4) throw new Error('rgba length does not match size');
  const bpr = Math.ceil(width / 8);
  const data = new Uint8Array(bpr * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3]! / 255;
      const luma = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * a + 255 * (1 - a);
      if (luma < threshold) data[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}

/** Fixed-width two-column row: left text truncated so the right text always fits. */
export function columns(left: string, right: string, cols: number): string {
  const room = Math.max(cols - right.length - 1, 0);
  const l = left.length > room ? left.slice(0, Math.max(room - 1, 0)) + (room > 0 ? '~' : '') : left;
  return l + ' '.repeat(Math.max(cols - l.length - right.length, 1)) + right;
}

export type ReceiptLine = { name: string; unit: Unit; qtyMilli: number; unitPaise: number; totalPaise: number };
export type Receipt = {
  shopName: string; address: string; gstin: string; billNo: string; createdAt: number;
  lines: ReceiptLine[]; taxPaise: number; discountPaise: number; roundOffPaise: number; totalPaise: number;
  payments: { mode: string; amountPaise: number }[]; footer: string; upiUri?: string;
};

/** A receipt block is either plain ESC/POS text or a request for the app to rasterise a non-ASCII line. */
export type Block =
  | { kind: 'text'; text: string; align: Align; bold?: boolean; big?: boolean }
  | { kind: 'raster-text'; text: string; align: Align; bold?: boolean; big?: boolean }
  | { kind: 'rule' }
  | { kind: 'qr'; data: string };

const rs = (p: number) => formatRupees(p, { symbol: false });

/** Lays the receipt out as blocks; {@link encodeReceipt} turns them into bytes once raster lines are drawn. */
export function receiptBlocks(r: Receipt, paper: Paper): Block[] {
  const { cols } = PAPER[paper];
  const out: Block[] = [];
  const say = (text: string, align: Align = 'left', extra: { bold?: boolean; big?: boolean } = {}) =>
    out.push({ kind: isPrintableAscii(text) ? 'text' : 'raster-text', text, align, ...extra });
  const d = new Date(r.createdAt);
  const p2 = (n: number) => String(n).padStart(2, '0');

  say(r.shopName, 'center', { bold: true, big: true });
  if (r.address) say(r.address, 'center');
  if (r.gstin) say(`GSTIN ${r.gstin}`, 'center');
  say(columns(`Bill ${r.billNo}`, `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`, cols));
  out.push({ kind: 'rule' });
  for (const l of r.lines) {
    say(l.name);
    say(columns(`  ${formatQuantity(l.qtyMilli, l.unit)} x ${rs(l.unitPaise)}`, rs(l.totalPaise), cols));
  }
  out.push({ kind: 'rule' });
  if (r.discountPaise) say(columns('Discount', `-${rs(r.discountPaise)}`, cols));
  if (r.taxPaise) say(columns('GST incl.', rs(r.taxPaise), cols));
  if (r.roundOffPaise) say(columns('Round off', rs(r.roundOffPaise), cols));
  say(columns('TOTAL', `Rs ${rs(r.totalPaise)}`, cols), 'left', { bold: true });
  for (const p of r.payments) say(columns(p.mode.toUpperCase(), rs(p.amountPaise), cols));
  if (r.upiUri) out.push({ kind: 'qr', data: r.upiUri });
  if (r.footer) say(r.footer, 'center');
  return out;
}

/** `draw` rasterises a non-ASCII line at the paper's dot width (Skia on device, a stub in tests). */
export function encodeReceipt(blocks: readonly Block[], paper: Paper, draw: (b: Extract<Block, { kind: 'raster-text' }>, widthDots: number) => MonoBitmap): Uint8Array {
  const { dots, cols } = PAPER[paper];
  const p = new EscPos().init();
  for (const b of blocks) {
    if (b.kind === 'rule') p.align('left').line('-'.repeat(cols));
    else if (b.kind === 'qr') p.align('center').qr(b.data).raw(LF);
    else if (b.kind === 'text') {
      p.align(b.align).bold(!!b.bold);
      if (b.big) p.size(2, 2);
      p.line(b.text);
      if (b.big) p.size(1, 1);
      p.bold(false);
    } else p.align('left').raster(draw(b, dots));
  }
  return p.feed(3).cut().bytes();
}
