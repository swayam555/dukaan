/**
 * Streaming RFC 4180 CSV parser over UTF-8 bytes. Works on bytes (all CSV syntax characters are ASCII)
 * so every row boundary has an exact byte offset — that offset is the resume checkpoint.
 */
export type CsvRow = { fields: string[]; endOffset: number };

const QUOTE = 0x22;
const COMMA = 0x2c;
const CR = 0x0d;
const LF = 0x0a;

export class CsvParser {
  private fields: string[] = [];
  private field: number[] = [];
  private inQuotes = false;
  private quotePending = false;
  private offset: number;
  private readonly decoder = new TextDecoder('utf-8');
  private pendingCr = false;

  constructor(startOffset = 0, private readonly delimiter = COMMA) {
    this.offset = startOffset;
  }

  /** Feeds a chunk; returns complete rows. Partial trailing row stays buffered. */
  push(chunk: Uint8Array): CsvRow[] {
    const rows: CsvRow[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      if (this.pendingCr) {
        this.pendingCr = false;
        if (b === LF) {
          this.offset += 1;
          this.emit(rows);
          continue;
        }
        this.emit(rows);
      }
      this.offset += 1;
      if (this.inQuotes) {
        if (this.quotePending) {
          this.quotePending = false;
          if (b === QUOTE) {
            this.field.push(QUOTE);
            continue;
          }
          this.inQuotes = false;
        } else if (b === QUOTE) {
          this.quotePending = true;
          continue;
        } else {
          this.field.push(b);
          continue;
        }
      }
      if (b === QUOTE && this.field.length === 0) {
        this.inQuotes = true;
      } else if (b === this.delimiter) {
        this.endField();
      } else if (b === LF) {
        this.endField();
        this.emit(rows);
      } else if (b === CR) {
        this.endField();
        this.pendingCr = true;
      } else {
        this.field.push(b);
      }
    }
    return rows;
  }

  private emit(rows: CsvRow[]): void {
    const fields = this.fields;
    this.fields = [];
    if (!(fields.length === 1 && fields[0] === '')) rows.push({ fields, endOffset: this.offset });
  }

  /** Flushes a final row without a trailing newline. */
  end(): CsvRow[] {
    const rows: CsvRow[] = [];
    if (this.pendingCr) {
      this.pendingCr = false;
      this.emit(rows);
      return rows;
    }
    this.quotePending = false;
    this.inQuotes = false;
    if (this.field.length === 0 && this.fields.length === 0) return rows;
    this.endField();
    this.emit(rows);
    return rows;
  }

  private endField(): void {
    this.fields.push(this.decoder.decode(new Uint8Array(this.field)).trim());
    this.field = [];
  }
}

/** Strips a UTF-8 BOM (Excel "CSV UTF-8" exports start with one). */
export function bomLength(head: Uint8Array): number {
  return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
}

export function detectDelimiter(headerLine: string): number {
  const counts = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0]!;
  return best[0].charCodeAt(0);
}
