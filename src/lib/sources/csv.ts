/** Streaming CSV; deliberately has no number, date or missing-value inference. */
export class NativeCsvReader {
  private field = "";
  private row: string[] = [];
  private quoted = false;
  private afterQuote = false;
  private skipLf = false;
  private beginning = true;
  private started = false;
  private closed = false;
  constructor(private readonly delimiter: string) { if (delimiter.length !== 1) throw new Error("CSV delimiter must be one character"); }
  private endField() { this.row.push(this.field); this.field = ""; this.afterQuote = false; }
  private endRow(): string[] {
    if (this.started || this.row.length || this.field) this.endField();
    const row = this.row; this.row = []; this.started = false; this.afterQuote = false; return row;
  }
  write(text: string): string[][] {
    if (this.closed) throw new Error("CSV reader is closed");
    const out: string[][] = [];
    for (const char of text) {
      if (this.beginning) { this.beginning = false; if (char === "\ufeff") continue; }
      if (this.skipLf) { this.skipLf = false; if (char === "\n") continue; }
      if (this.quoted) {
        if (char === '"') { this.quoted = false; this.afterQuote = true; }
        else this.field += char;
        continue;
      }
      if (this.afterQuote && char === '"') { this.field += '"'; this.quoted = true; this.afterQuote = false; continue; }
      if (char === this.delimiter) { this.endField(); this.started = true; continue; }
      if (char === "\n" || char === "\r") { out.push(this.endRow()); this.skipLf = char === "\r"; continue; }
      if (this.afterQuote) throw new Error("Unexpected content after a closing CSV quote");
      if (char === '"') {
        // Like Python csv.reader(strict=True), a quote inside an unquoted field is literal.
        if (this.field.length) { this.field += char; continue; }
        this.quoted = true; this.started = true; continue;
      }
      this.field += char; this.started = true;
    }
    return out;
  }
  close(): string[][] {
    if (this.quoted) throw new Error("Unterminated CSV quoted cell");
    if (this.closed) return [];
    this.closed = true;
    return this.started || this.row.length || this.field ? [this.endRow()] : [];
  }
}
