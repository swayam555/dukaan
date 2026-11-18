/** Shared by the host benchmark (bench/search.ts) and the on-device Diagnostics benchmark. */
export const BENCH_QUERIES: readonly string[] = [
  'b', 'ba', 'bas', 'basm', 'basmati', 'basmati 5kg', 'chawal', 'चावल', 'chaawal', 'rice', 'atta 10kg', 'आटा',
  'maggi', 'magi', 'noodles', 'toothpaste', 'colgate tooth', 'surf excel 1kg', 'ghee', 'घी', 'dal', 'toor', 'tur dal',
  'paracetamol', 'parcetamol', 'haldi', 'हल्दी', 'masala', 'garam', 'pan masala', 'soap', 'sabun', 'lux', 'parle g',
  'biscuit', 'oil 1l', 'sarson tel', 'sunflower', 'amul', 'butter', 'tea', 'chai patti', 'kaju', 'cashew', 'agarbatti',
  'xyzzy', 'ab', 'n', 'namak', '8901000012345',
];

export function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}
