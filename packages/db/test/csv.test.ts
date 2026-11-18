import fc from 'fast-check';
import { CsvParser } from '../src/import/csv';

const enc = (s: string) => new TextEncoder().encode(s);

function parseAll(text: string, chunk = 7) {
  const bytes = enc(text);
  const p = new CsvParser();
  const rows = [];
  for (let i = 0; i < bytes.length; i += chunk) rows.push(...p.push(bytes.subarray(i, i + chunk)));
  rows.push(...p.end());
  return rows;
}

describe('CsvParser', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and Devanagari', () => {
    const text = 'name,price\r\n"Tata Salt, 1kg",28\r\n"Say ""hi""",5\r\n"multi\nline",1\r\nचावल,60';
    const rows = parseAll(text, 3);
    expect(rows.map((r) => r.fields)).toEqual([['name', 'price'], ['Tata Salt, 1kg', '28'], ['Say "hi"', '5'], ['multi\nline', '1'], ['चावल', '60']]);
    expect(rows.at(-1)!.endOffset).toBe(enc(text).length);
  });

  it('reports byte offsets that restart parsing exactly at a row boundary', () => {
    const text = 'a,b\nतेल,1\n"x,y",2\n';
    const rows = parseAll(text, 2);
    const resumeAt = rows[1]!.endOffset;
    const p = new CsvParser(resumeAt);
    const rest = [...p.push(enc(text).subarray(resumeAt)), ...p.end()];
    expect(rest.map((r) => r.fields)).toEqual([['x,y', '2']]);
  });

  it('is independent of chunk size (property)', () => {
    const cell = fc.string({ maxLength: 8 }).map((s) => s.replace(/\r/g, ''));
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 2, maxLength: 4 }), { minLength: 1, maxLength: 10 }), fc.integer({ min: 1, max: 64 }), (table, chunk) => {
        const text = table.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
        const parsed = parseAll(text, chunk).map((r) => r.fields);
        return JSON.stringify(parsed) === JSON.stringify(table.map((r) => r.map((c) => c.trim())));
      }),
    );
  });
});
