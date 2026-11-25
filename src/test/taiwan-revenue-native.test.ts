import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCsvReader } from "../lib/sources/csv";
import {
  TAIWAN_REVENUE_FIELDS,
  collectTaiwanRevenue,
  lastClosedTaipeiMonth,
  parseStringRecordArray,
  parseTaiwanRevenue,
  rocMonthToGregorian,
  taiwanRevenueCsv,
  validateTaiwanRevenueSchema,
} from "../../scripts/lib/taiwan-revenue-native";

const example = (code = "1101", period = "11510") =>
  Object.fromEntries(
    TAIWAN_REVENUE_FIELDS.map((field) => [
      field,
      (
        {
          出表日期: "1151117",
          資料年月: period,
          公司代號: code,
          公司名稱: "台灣範例公司",
          產業別: "水泥工業",
          備註: "-",
        } as Record<string, string>
      )[field] ?? "0",
    ]),
  );
const parse = (rows: unknown) =>
  parseTaiwanRevenue(JSON.stringify(rows), { expectedPeriod: "2026-10", asOfDate: "2026-11-25" });

describe("Taiwan native monthly revenue", () => {
  it("retains a smaller complete response and discloses the population change without an invented floor", async () => {
    const folder = await mkdtemp(join(tmpdir(), "taiwan-native-test-"));
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        TAIWAN_REVENUE_FIELDS.map((field) => [field, { type: "string" }]),
      ),
    };
    const spec = JSON.stringify({
      paths: { "/opendata/t187ap05_L": { get: { responses: { "200": { schema } } } } },
    });
    const body = JSON.stringify([example("1101"), example("1102")]);
    const response = (text: string) =>
      new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "identity",
          "Content-Length": String(Buffer.byteLength(text)),
        },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response(spec)).mockResolvedValueOnce(response(body)),
    );
    try {
      const collected = await collectTaiwanRevenue({
        market: "TWSE",
        workDir: folder,
        signal: new AbortController().signal,
        expectedPeriod: "2026-10",
        previousCompanyCodes: Array.from({ length: 20 }, (_, i) => String(1101 + i)),
      });
      expect(collected.rows).toBe(2);
      expect(collected.coverage.reported_population_decreased).toBe(true);
      expect(collected.coverage.reported_issuer_count_change).toBe(-18);
      expect(collected.coverage.previously_reported_codes_absent).toHaveLength(18);
      expect(collected.coverage.completeness_basis).toContain("not independently established");
    } finally {
      vi.unstubAllGlobals();
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("keeps decimal strings, zeros, leading-zero codes and Chinese text exactly", () => {
    const row: Record<string, string> = {
      ...example("0011"),
      "營業收入-當月營收": "9007199254740993123.0040",
      "營業收入-上月比較增減(%)": "-19.3878813808027000001",
      備註: '含逗號,及"引號"\n第二行',
    };
    const result = parse([row]);
    expect(result.rows[0]).toEqual(TAIWAN_REVENUE_FIELDS.map((field) => row[field]));
    expect(result.companyCodes).toEqual(["0011"]);
    expect(result.nativePeriod).toBe("11510");
    expect(result.period).toBe("2026-10");
  });

  it("rejects a numeric JSON value before any financial-number coercion", () => {
    for (const value of ["9007199254740993123.0040", "null", "true", "{}", "[]"]) {
      expect(() => parseStringRecordArray(`[{"營業收入-當月營收":${value}}]`)).toThrow(/string/i);
    }
  });

  it("rejects duplicate object properties instead of silently overwriting source text", () => {
    expect(() => parseStringRecordArray('[{"公司代號":"1101","公司代號":"1102"}]')).toThrow(
      /duplicate/i,
    );
    expect(() => parseStringRecordArray('[{"公司代號":"1101",}]')).toThrow();
    expect(() => parseStringRecordArray('[{"公司代號":"1101"}] trailing')).toThrow(/trailing/i);
  });

  it("decodes JSON string escapes without changing their logical native value", () => {
    expect(parseStringRecordArray('[{"\\u516c\\u53f8":"台灣\\n😀"}]')[0]["公司"]).toBe("台灣\n😀");
    expect(() => parseStringRecordArray('[{"備註":"\\ud800"}]')).toThrow(/Unicode/i);
  });

  it("requires the full reviewed native schema on every returned issuer", () => {
    const missing = example();
    delete missing["營業收入-當月營收"];
    expect(() => parse([missing])).toThrow(/missing|omitted/i);
    expect(() => parse([{ ...example(), 新欄位: "1" }])).toThrow(/unexpected/i);
    expect(() => parse([])).toThrow(/empty/i);
  });

  it("rejects duplicate company plus reporting-month identities", () => {
    expect(() => parse([example(), example()])).toThrow(/duplicate/i);
    expect(parse([example("1101"), example("1102")]).rows).toHaveLength(2);
  });

  it("rejects mixed, unexpected, and malformed reporting periods", () => {
    expect(() => parse([example("1101"), example("1102", "11509")])).toThrow(/period/i);
    expect(() => parse([example("1101", "11509")])).toThrow(/period/i);
    expect(() => parse([example("1101", "11513")])).toThrow(/month/i);
    expect(() => parse([{ ...example(), 出表日期: "1151232" }])).toThrow(/date/i);
    expect(() => parse([{ ...example(), 出表日期: "1151126" }])).toThrow(/future/i);
  });

  it("indexes only the verified ROC calendar conversion and preserves the native month", () => {
    expect(rocMonthToGregorian("11510")).toBe("2026-10");
    expect(rocMonthToGregorian("00101")).toBe("1912-01");
    expect(() => rocMonthToGregorian("00001")).toThrow(/ROC/i);
    expect(() => rocMonthToGregorian("202610")).toThrow(/ROC/i);
  });

  it("uses Taipei's calendar boundary when selecting the expected closed month", () => {
    expect(lastClosedTaipeiMonth(new Date("2026-11-30T15:59:59Z"))).toBe("2026-10");
    expect(lastClosedTaipeiMonth(new Date("2026-11-30T16:00:00Z"))).toBe("2026-11");
    expect(lastClosedTaipeiMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12");
  });

  it("keeps the exact native string values in the assembled CSV", () => {
    const original: Record<string, string> = {
      ...example(),
      備註: '中文, "引號"\n第二行',
      "營業收入-當月營收": "",
      "營業收入-去年當月營收": "N/A",
    };
    const native = parse([original]);
    const csv = taiwanRevenueCsv(native.rows);
    const reader = new NativeCsvReader(",");
    const rows = [...reader.write(csv), ...reader.close()];
    expect(rows).toEqual([
      [...TAIWAN_REVENUE_FIELDS],
      TAIWAN_REVENUE_FIELDS.map((field) => original[field]),
    ]);
    expect(native.emptyCounts[TAIWAN_REVENUE_FIELDS.indexOf("營業收入-當月營收")]).toBe(1);
  });

  it("checks the endpoint-specific official schema and rejects type changes or pagination", () => {
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        TAIWAN_REVENUE_FIELDS.map((field) => [field, { type: "string" }]),
      ),
    };
    const spec = {
      paths: { "/opendata/t187ap05_L": { get: { responses: { "200": { schema } } } } },
    };
    expect(() => validateTaiwanRevenueSchema("TWSE", spec)).not.toThrow();
    const changed = structuredClone(spec);
    changed.paths["/opendata/t187ap05_L"].get.responses["200"].schema.properties[
      "營業收入-當月營收"
    ].type = "number";
    expect(() => validateTaiwanRevenueSchema("TWSE", changed)).toThrow(/type/i);
    const paged = structuredClone(spec) as any;
    paged.paths["/opendata/t187ap05_L"].get.parameters = [{ name: "page", in: "query" }];
    expect(() => validateTaiwanRevenueSchema("TWSE", paged)).toThrow(/parameter|pagination/i);
  });
});
