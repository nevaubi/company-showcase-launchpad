import { describe, expect, it } from "vitest";
import { NativeCsvReader } from "./csv";
describe("native source CSV streaming", () => {
  it("preserves leading zeros, embedded delimiters, doubled quotes, blanks and multiline cells across chunks", () => {
    const reader = new NativeCsvReader(",");
    const rows = [
      ...reader.write('\ufeffCERT,NAME,VALUE\r\n000123,"A, B "'),
      ...reader.write('"Bank""",0\r\n000124,"line1\r'),
      ...reader.write('\nline2",\r\n'), ...reader.close(),
    ];
    expect(rows).toEqual([["CERT","NAME","VALUE"],["000123",'A, B "Bank"',"0"],["000124","line1\r\nline2",""]]);
  });
  it("matches CSV empty-record semantics without dropping quoted empty values", () => {
    const reader = new NativeCsvReader("\t");
    expect([...reader.write('\n""\n\t\nlast\t0'),...reader.close()]).toEqual([[],[""],["",""],["last","0"]]);
  });
  it("refuses truncated quoted records and malformed trailing content", () => {
    const cut = new NativeCsvReader(","); cut.write('a,"incomplete');
    expect(()=>cut.close()).toThrow(/unterminated/i);
    expect(()=>new NativeCsvReader(",").write('a,"closed"junk\n')).toThrow(/quote/i);
  });
});
