import { describe, expect, it } from "vitest";
import { filterHighlights, signalCounts, resolveDoc, searchPhrase, type RedlineHighlight } from "./feed";

const h = (o: Partial<RedlineHighlight>): RedlineHighlight => ({
  kind: "quarterly",
  form: "10-Q",
  filed: "2026-11-05",
  section: "Item 1A",
  section_id: "x",
  change: "added",
  score: 10,
  signals: [],
  excerpt: "text",
  ticker: "AAA",
  name: "Aaa Corp",
  ...o,
});

describe("filings feed", () => {
  it("filters by form, sector, signal and window, newest first", () => {
    const rows = [
      h({ ticker: "A", filed: "2026-11-01", score: 5, signals: ["tariffs/trade"] }),
      h({ ticker: "B", filed: "2026-11-05", score: 1, form: "10-K" }),
      h({ ticker: "C", filed: "2026-11-05", score: 9 }),
      h({ ticker: "D", filed: "2026-09-01" }),
    ];
    const sec = (t: string) => (t === "C" ? "Energy" : "Tech");
    const base = { form: "all" as const, sector: "all", signal: "all", days: 30, q: "" };
    expect(filterHighlights(rows, base, sec, "2026-11-07").map((r) => r.ticker)).toEqual([
      "C",
      "B",
      "A",
    ]);
    expect(
      filterHighlights(rows, { ...base, form: "10-K" }, sec, "2026-11-07").map((r) => r.ticker),
    ).toEqual(["B"]);
    expect(
      filterHighlights(rows, { ...base, sector: "Energy" }, sec, "2026-11-07").map((r) => r.ticker),
    ).toEqual(["C"]);
    expect(
      filterHighlights(rows, { ...base, signal: "tariffs/trade" }, sec, "2026-11-07").map(
        (r) => r.ticker,
      ),
    ).toEqual(["A"]);
  });
  it("resolves the filing holding the passage", () => {
    const doc = {
      comparisons: [
        {
          kind: "quarterly",
          new: { accn: "N", doc: "n.htm", filed: "2026-11-05" },
          old: { accn: "O", doc: "o.htm", filed: "2025-11-05" },
        },
      ],
    };
    expect(resolveDoc(h({ change: "removed" }), doc)).toEqual({
      accn: "O",
      doc: "o.htm",
      filed: "2025-11-05",
    });
    expect(resolveDoc(h({}), doc)?.accn).toBe("N");
    expect(resolveDoc(h({ accn: "X", doc: "x.htm" }), null)?.accn).toBe("X");
    expect(searchPhrase("  a  b c ", 2)).toBe("a b");
  });
});

describe("signal filter (L6)", () => {
  const H = (signals: string[], excerpt = "text"): RedlineHighlight => ({ ticker: "AAPL", name: "Apple", form: "10-K", filed: "2026-11-03", section: "Risk factors", section_id: "1A", change: "added", score: 1, excerpt, signals }) as RedlineHighlight;
  it("counts each signal once per passage, most frequent first", () => {
    expect(signalCounts([H(["guidance", "guidance", "tariff"]), H(["tariff"]), H([])])).toEqual([{ signal: "tariff", n: 2 }, { signal: "guidance", n: 1 }]);
  });
  it("search matches signal words too", () => {
    const f = { form: "all" as const, sector: "all", signal: "all", days: 30, q: "tarif" };
    expect(filterHighlights([H(["tariff"]), H(["guidance"])], f, () => undefined, "2026-11-23")).toHaveLength(1);
  });
});
