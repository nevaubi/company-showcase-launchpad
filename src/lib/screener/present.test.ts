import { describe, expect, it } from "vitest";
import { emptySpec, fmtField, run, validate, type FieldDef, type Row, type Spec } from "./engine";
import { applicable, buildFilter, decodeSpec, encodeSpec, fieldGroups, filterImpact, searchAlone, formatInput, parseInput, readShared, screenSearch, SHARE_MAX, toCsv } from "./present";
import { SERIES_FIELDS, seriesAsOf, seriesRange, withSeries } from "./series";

const fields: FieldDef[] = [
  { id: "price", g: "px", n: "Price", u: "usd", d: "Last close" },
  { id: "mcap", g: "val", n: "Market cap", u: "usd", d: "" },
  { id: "om", g: "qual", n: "Operating margin", u: "pct", d: "" },
  { id: "pe", g: "val", n: "P/E", u: "x", d: "" },
  { id: "above_sma200", g: "px", n: "Above 200-day average", u: "bool", d: "" },
];
const F = new Map(fields.map((f) => [f.id, f]));
const row = (ticker: string, o: Partial<Row>): Row => ({ ticker, name: `${ticker} Inc`, sector: "Industrials", industry: "Machinery", sp500: false, sp100: false, ...o }) as Row;
const rows: Row[] = [
  row("AAA", { mcap: 10e9, om: 0.3, pe: 12, above_sma200: true }),
  row("BBB", { mcap: 50e9, om: 0.05, pe: 30, above_sma200: false }),
  row("CCC", { mcap: 2e9, om: 0.2, pe: null, above_sma200: true }),
  row("DDD", { mcap: 800e9, om: -0.1, pe: null, above_sma200: false, name: 'Quote "and", comma' }),
];

describe("fmtField", () => {
  it("keeps one decimal convention per unit and a true minus", () => {
    expect(fmtField(F.get("om"), 0.164)).toBe("16.4%");
    expect(fmtField(F.get("om"), 0.003)).toBe("0.3%");
    expect(fmtField(F.get("om"), -0.018)).toBe("−1.8%");
    expect(fmtField(F.get("pe"), 380)).toBe("380.0×");
    expect(fmtField(F.get("price"), 1347.11)).toBe("$1,347.11");
    expect(fmtField(F.get("mcap"), 4.32e12)).toBe("$4.32T");
    expect(fmtField(F.get("mcap"), -2.5e8)).toBe("−$250M");
    expect(fmtField(F.get("om"), null)).toBe("–");
    expect(fmtField(F.get("om"), 0.15, true)).toBe("15%");
  });
});

describe("filter builder", () => {
  it("reads percentages, suffixes and minus signs back into stored values", () => {
    expect(parseInput(F.get("om")!, "15")).toBeCloseTo(0.15);
    expect(parseInput(F.get("om")!, "−2.5%")).toBeCloseTo(-0.025);
    expect(parseInput(F.get("mcap")!, "$2.5B")).toBe(2.5e9);
    expect(parseInput(F.get("mcap")!, "750m")).toBe(7.5e8);
    expect(parseInput(F.get("pe")!, "20x")).toBe(20);
    expect(parseInput(F.get("pe")!, "2B")).toBeNull();
    expect(parseInput(F.get("om")!, "abc")).toBeNull();
    for (const [id, v] of [["om", 0.152], ["mcap", 2.5e9], ["pe", 17.5]] as const) expect(parseInput(F.get(id)!, formatInput(F.get(id)!, v))).toBeCloseTo(v);
  });
  it("builds filters the engine accepts and explains bad input", () => {
    const a = buildFilter(F.get("om")!, ">", "20");
    expect(a).toEqual({ filter: { field: "om", op: ">", value: 0.2 } });
    const b = buildFilter(F.get("mcap")!, "between", "50B", "1B");
    expect(b).toEqual({ filter: { field: "mcap", op: "between", value: [1e9, 50e9] } });
    expect(buildFilter(F.get("om")!, "top", "150")).toEqual({ error: "Enter a share between 0 and 100" });
    expect(buildFilter(F.get("om")!, ">", "")).toEqual({ error: "Enter a number" });
    const spec: Spec = { ...emptySpec(), filters: [(a as { filter: Spec["filters"][number] }).filter] };
    expect(run(rows, spec, F).rows.map((r) => r.ticker)).toEqual(["AAA"]);
    expect(validate(spec, { fields, sectors: ["Industrials"], industries: ["Machinery"], tickers: rows.map((r) => r.ticker) }).errors).toEqual([]);
  });
  it("groups fields by theme in catalogue order", () => {
    const g = fieldGroups(fields, [{ id: "id", n: "Identity" }, { id: "val", n: "Valuation" }, { id: "qual", n: "Quality" }, { id: "px", n: "Price" }, { id: "risk", n: "Risk" }]);
    expect(g.map((x) => [x.id, x.fields.map((f) => f.id)])).toEqual([["val", ["mcap", "pe"]], ["qual", ["om"]], ["px", ["price", "above_sma200"]]]);
  });
});

describe("filterImpact", () => {
  it("says how many pass each filter alone and how many return without it", () => {
    const spec: Spec = { ...emptySpec(), filters: [{ field: "om", op: ">", value: 0.25 }, { field: "above_sma200", op: "false" }] };
    expect(run(rows, spec, F).rows).toHaveLength(0);
    const imp = filterImpact(rows, spec, F);
    expect(imp.map((x) => [x.alone, x.without])).toEqual([[1, 2], [2, 1]]);
    expect(imp[0].text).toBe("Operating margin > 25%");
  });

  it("counts with the find text applied, so removing a filter never promises rows the search hides", () => {
    const spec: Spec = { ...emptySpec(), filters: [{ field: "om", op: ">", value: 0.25 }] };
    expect(run(rows, spec, F, "zzz").rows).toHaveLength(0);
    expect(filterImpact(rows, spec, F, "zzz").map((x) => x.without)).toEqual([0]);
    expect(searchAlone(rows, spec, F, "zzz")).toBe(0);
    expect(searchAlone(rows, spec, F, "AAA")).toBe(1);
  });
});

describe("applicable", () => {
  it("sets aside filters and a sort on fields that are not loaded instead of failing every row", () => {
    const spec: Spec = { ...emptySpec(), filters: [{ field: "dv20", op: ">", value: 1e8 }, { field: "om", op: ">", value: 0.25 }], sort: { field: "short_vol5", dir: "desc" } };
    const a = applicable(spec, F);
    expect(a.missing).toEqual([0]);
    expect(a.spec.filters).toEqual([{ field: "om", op: ">", value: 0.25 }]);
    expect(a.spec.sort).toBeNull();
    expect(run(rows, a.spec, F).rows.length).toBeGreaterThan(0);
    const ok: Spec = { ...emptySpec(), filters: [{ field: "om", op: ">", value: 0.1 }] };
    expect(applicable(ok, F).spec).toBe(ok);
  });
});

describe("toCsv", () => {
  it("writes the shown rows and columns in order, with units in the header and full values", () => {
    const out = toCsv([rows[3], rows[0]], ["om", "mcap", "above_sma200"], F);
    expect(out.split("\n")).toEqual([
      "Ticker,Company,Operating margin (%),Market cap (USD),Above 200-day average",
      'DDD,"Quote ""and"", comma",-10,800000000000,No',
      "AAA,AAA Inc,30,10000000000,Yes",
    ]);
  });
  it("adds the group and distance columns when the table shows them", () => {
    const out = toCsv([rows[0]], ["pe"], F, { sim: new Map([["AAA", 0.5]]), groupOf: () => "Mid", groupLabel: "Size" });
    expect(out.split("\n")[0]).toBe("Size,Ticker,Company,Distance,P/E (×)");
    expect(out.split("\n")[1]).toBe("Mid,AAA,AAA Inc,0.5000,12");
  });
});

describe("screen codes", () => {
  it("round-trip a screen through validate", () => {
    const spec: Spec = { ...emptySpec(), filters: [{ field: "om", op: ">", value: 0.2 }], sort: { field: "pe", dir: "asc" }, columns: ["om", "pe"], explanation: "long text" };
    const code = encodeSpec(spec);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = validate(decodeSpec(code), { fields, sectors: [], industries: [], tickers: [] });
    expect(back.errors).toEqual([]);
    expect(back.spec.filters).toEqual(spec.filters);
    expect(back.spec.sort).toEqual(spec.sort);
    expect(back.spec.explanation).toBe("");
    expect(decodeSpec("not base64 json")).toBeNull();
  });
});

describe("series fields", () => {
  it("adds dollar volume and short-volume share as stored and drops impossible values", () => {
    const s = { ticker: "AAA", end_date: "2026-11-20", dv20: 3.2e9, r5: 0, r21: 0, vol60: 0.02, above200: true, near_high: false, short5: 0.48 };
    const r = withSeries(rows[0], s);
    expect(r.dv20).toBe(3.2e9);
    expect(r.short_vol5).toBe(0.48);
    expect(withSeries(rows[0], { ...s, short5: 1.4, dv20: 0 }).short_vol5).toBeNull();
    expect(withSeries(rows[0], undefined)).toBe(rows[0]);
    expect(seriesAsOf([{ end_date: "2026-11-19" }, { end_date: "2026-11-20" }])).toBe("2026-11-20");
    expect(SERIES_FIELDS.map((f) => f.id)).toEqual(["dv20", "short_vol5"]);
  });
});

describe("shared screen links", () => {
  it("never throws on the values the router can hand over", () => {
    expect(screenSearch({})).toEqual({});
    expect(screenSearch({ screen: 123 })).toEqual({ screen: "123" });
    expect(screenSearch({ screen: true })).toEqual({ screen: "true" });
    expect(screenSearch({ screen: { a: 1 } })).toEqual({ screen: '{"a":1}' });
    expect(screenSearch({ screen: "x".repeat(20_000) }).screen).toHaveLength(20_000);
  });
  it("opens a long ticker list that fits, and resets with a reason when it does not", () => {
    const tickers = Array.from({ length: 500 }, (_, i) => `T${i.toString().padStart(4, "0")}`);
    const code = encodeSpec({ ...emptySpec(), tickers } as Spec);
    expect(code.length).toBeGreaterThan(4000);
    expect(code.length).toBeLessThan(SHARE_MAX);
    const ok = readShared(code);
    expect(ok.ok && (ok.raw.tickers as string[]).length).toBe(500);
    const long = readShared("A".repeat(SHARE_MAX + 1));
    expect(long.ok).toBe(false);
    expect(!long.ok && long.notice).toMatch(/too long/);
    for (const bad of ["123", "true", '{"a":1}', "abc"]) expect(readShared(bad).ok).toBe(false);
  });
});

describe("seriesRange", () => {
  it("states the oldest and newest scan date", () => {
    expect(seriesRange([{ end_date: "2026-11-23" }, { end_date: "2026-11-16" }, { end_date: "2026-11-20" }])).toEqual({ from: "2026-11-16", to: "2026-11-23" });
    expect(seriesRange([])).toBeNull();
  });
});

describe("fmtField edge cases", () => {
  it("keeps cents on high share prices, never prints a signed zero, and writes ordinals and whole scores", () => {
    expect(fmtField(F.get("price"), 5468.04)).toBe("$5,468.04");
    expect(fmtField(F.get("mcap"), 999.97e9)).toBe("$1.00T");
    expect(fmtField(F.get("om"), -0.0001)).toBe("0.0%");
    expect(fmtField(F.get("om"), -0.018)).toBe("−1.8%");
    const pctl: FieldDef = { id: "r", g: "x", n: "Rank", u: "pctl", d: "" };
    expect([0.01, 0.02, 0.03, 0.11, 0.21].map((v) => fmtField(pctl, v))).toEqual(["1st", "2nd", "3rd", "11th", "21st"]);
    const score: FieldDef = { id: "s", g: "x", n: "Score", u: "score", d: "" };
    expect(fmtField(score, 7)).toBe("7");
    expect(fmtField(score, 7.25)).toBe("7.3");
  });
});
