import { describe, expect, it } from "vitest";
import { authoritativeCsvUrl, NativeRefreshScanner, refreshChecked, refreshColumns, refreshEligibility, refreshFailure, safeRefreshRedirect } from "./refresh-plan";
import type { SourceIngest } from "./schema";

const ingest: SourceIngest = { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: {} };
describe("official native CSV refresh", () => {
  it("requires original byte-hash evidence, an authoritative exact endpoint, and preserves FRED series/lower date", () => {
    const direct_url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&cosd=2000-01-01&coed=2026-11-24";
    expect(refreshEligibility({ provenance: { direct_url } }, ingest, new Date("2026-11-25"))).toMatchObject({ eligible: false });
    const result = refreshEligibility({ provenance: { direct_url, direct_download_sha256_verified: true } }, ingest, new Date("2026-11-25"));
    expect(result).toMatchObject({ eligible: true, family: "fred" });
    if (result.eligible) expect(new URL(result.url).searchParams.get("coed")).toBe("2026-11-25");
    expect(authoritativeCsvUrl("https://fred.stlouisfed.org.evil.test/graph/fredgraph.csv?id=GDP")).toBeNull();
    expect(authoritativeCsvUrl("https://api.fdic.gov/banks/financials?format=json")).toBeNull();
    expect(authoritativeCsvUrl("https://openapi.twse.com.tw/v1/opendata/t187ap05_L")).toBeNull();
    expect(authoritativeCsvUrl("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&redirect=http://127.0.0.1")).toBeNull();
  });
  it("rejects redirects that switch series, paths, or hosts", () => {
    const initial = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP";
    expect(safeRefreshRedirect(initial, initial)).toBe(true);
    expect(safeRefreshRedirect(initial, initial.replace("GDP", "CPIAUCSL"))).toBe(false);
    expect(safeRefreshRedirect(initial, "https://example.org/data.csv")).toBe(false);
  });
  it("retains the exact lowercase suffixes in verified official EIA MER table IDs", () => {
    for (const table of ["T03.03f", "T07.07a", "T07.07b", "T07.07c", "T07.07d", "T07.08a", "T07.08b", "T07.08c", "T07.08d"]) {
      const direct_url = `https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=${table}`;
      const result = refreshEligibility({ provenance: { direct_url, direct_download_sha256_verified: true } }, ingest, new Date("2026-11-25"));
      expect(result).toMatchObject({ eligible: true, family: "eia_mer", url: direct_url });
      expect(safeRefreshRedirect(direct_url, direct_url.replace(table, table.toUpperCase()))).toBe(false);
    }
    expect(authoritativeCsvUrl("https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=T07.07a&url=https://example.test")).toBeNull();
    expect(authoritativeCsvUrl("https://www.eia.gov/other.csv?tbl=T07.07a")).toBeNull();
  });
  it("parses across boundaries and distinguishes blank, zero, leading zeros and disclosure markers", () => {
    const reader = new NativeRefreshScanner(",", ["tract", "value", "note", "note"]);
    for (const piece of ['\ufefftract,value,note,note\r', '\n01001020100,0,"first\r', '\nsecond",\r\n01001020200,,"a "', '"quote""",(D)\n']) reader.write(piece);
    expect(reader.finish()).toEqual({ headers: ["tract", "value", "note", "note"], rows: 2, blankCounts: [0, 1, 0, 1], headerMatches: true });
  });
  it("quarantines an exact header change without copying old field units", () => {
    const reader = new NativeRefreshScanner(",", ["FIPS", "Index"]);
    reader.write("FIPS,Price\n01001,100.00\n");
    const stats = reader.finish();
    expect(stats.headerMatches).toBe(false);
    expect(refreshColumns([{ key: "a", label: "FIPS", type: "string" }, { key: "b", label: "Index", type: "string", unit: "index" }], stats)[1]).toEqual({ key: "col0002", label: "Price", type: "string" });
  });
  it("rejects ragged or truncated CSV instead of counting partial observations", () => {
    const ragged = new NativeRefreshScanner(",", ["a", "b"]);
    expect(() => ragged.write("a,b\n1,2,3\n")).toThrow(/fields/);
    const truncated = new NativeRefreshScanner(",", ["a", "b"]);
    truncated.write('a,b\n1,"unterminated');
    expect(() => truncated.finish()).toThrow(/Unterminated/);
  });
  it("never advances stage-success on 304, unchanged data or failed work", () => {
    const old = { last_success_at: "2026-11-24T00:00:00.000Z" };
    const now = new Date("2026-11-25T00:00:00Z");
    expect(refreshChecked(old, now, 1000, { url: "https://example.test" }).last_success_at).toBe(old.last_success_at);
    expect(refreshFailure(old, now, "upstream failure").last_success_at).toBe(old.last_success_at);
    expect(refreshChecked(old, now, 1000, { url: "https://example.test", stagedSnapshotId: "abc" }).last_success_at).toBe(now.toISOString());
  });
});
