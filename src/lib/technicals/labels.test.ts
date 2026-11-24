import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/financials/types";
import { analyze, barsFromPriceRows } from "./analysis";
import type { EvidenceCell } from "./evidence";
import { cellLabel, evidenceLayout, fmtQ } from "./labels";

const rows = (t: string) => (JSON.parse(readFileSync(`src/test/fixtures/prices/${t}.json`, "utf8")) as { bars: Bar[] }).bars;

const cell = (over: Partial<EvidenceCell>, nEff = 18, excess = 0.01): EvidenceCell =>
  ({ test: { nEff, excess } as EvidenceCell["test"], q: 0.5, verdict: "context", reason: "base", pooled: null, ...over }) as EvidenceCell;

describe("one label per evidence cell", () => {
  it("names what failed first, in the page's words", () => {
    expect(cellLabel(undefined).text).toBe("too few cases");
    expect(cellLabel(cell({ q: null, reason: "small" })).text).toBe("small sample (18)");
    expect(cellLabel(cell({ reason: "base" })).text).toBe("no clear difference");
    expect(cellLabel(cell({ reason: "interval" })).text).toBe("interval includes zero");
    expect(cellLabel(cell({ reason: "cost" })).text).toBe("smaller than costs");
    expect(cellLabel(cell({ reason: "unstable" })).text).toBe("not stable over time");
    expect(cellLabel(cell({ reason: "pooled" })).text).toBe("not seen across companies");
    expect(cellLabel(cell({ reason: "ok", verdict: "reliable" }, 40, -0.02)).text).toBe("reliable: lower after");
  });
  it("prints q with one convention", () => {
    expect(fmtQ(0.954)).toBe("0.95");
    expect(fmtQ(0.0412)).toBe("0.041");
    expect(fmtQ(null)).toBe("–");
  });
});

describe("the Evidence table leads with what is in force", () => {
  for (const t of ["AAPL", "NVDA", "JPM"]) {
    const T = analyze({ sym: t, bars: barsFromPriceRows(rows(t)), bench: [], intervals: "candidates" })!;
    for (const h of [5, 20, 60] as const) {
      it(`${t}, ${h} days: every row is either listed or counted in the sentence`, () => {
        const L = evidenceLayout(T.evidence, h);
        const inactive = T.evidence.rows.filter((r) => !r.active);
        expect(L.active.length + L.notable.length + L.quietBase + L.quietFew).toBe(T.evidence.rows.length);
        // listed below the in-force rows: only verdicts other than no clear difference or too few cases
        for (const r of L.notable) expect(cellLabel(r.cells[h]).quiet).toBeNull();
        expect(L.quietBase).toBe(inactive.filter((r) => r.cells[h]?.reason === "base" && r.cells[h]?.q != null).length);
        expect(L.quietFew).toBe(inactive.filter((r) => !r.cells[h] || r.cells[h]!.q == null).length);
        expect(L.summary).toMatch(new RegExp(`^${L.quietBase + L.quietFew} other conditions at ${h} days: `));
      });
    }
  }
  it("builds its sentence from the counts", () => {
    const T = analyze({ sym: "AAPL", bars: barsFromPriceRows(rows("AAPL")), bench: [], intervals: "candidates" })!;
    const L = evidenceLayout(T.evidence, 20);
    expect(L.summary).toBe(`${L.quietBase + L.quietFew} other conditions at 20 days: ${L.quietBase} with no clear difference from the base rate, ${L.quietFew} with too few cases to test.`);
  });
});
