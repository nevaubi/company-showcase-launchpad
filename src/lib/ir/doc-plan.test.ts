// The rebuild's document plan: one copy per document family, decks for two years, older history from the
// primary statement documents only, nothing older than 15 years.
import { describe, expect, it } from "vitest";
import { planDocuments, type PlanDocRow } from "@/lib/ir/doc-plan";

const row = (
  id: string,
  filed: string | null,
  kind: string,
  ext = "htm",
  extra: Partial<PlanDocRow> = {},
): PlanDocRow => ({
  id,
  kind,
  ext,
  filed,
  title: extra.title ?? `${kind} ${filed}`,
  period: extra.period ?? null,
  source_url: extra.source_url ?? null,
  rendition_path: extra.rendition_path ?? null,
});

describe("document plan", () => {
  it("keeps one copy of a supplement stored as SEC exhibit, IR-site PDF and spreadsheet (auda-02)", () => {
    const p = planDocuments([
      row("pdf", "2026-10-14", "supplement", "pdf", {
        title: "3Q26 Financial Supplement",
        rendition_path: "r/1.html",
      }),
      row("sec", "2026-10-13", "supplement", "htm", {
        title: "3Q26 Financial Supplement",
        source_url: "https://www.sec.gov/Archives/x.htm",
      }),
      row("xlsx", "2026-10-15", "supplement", "xlsx", { title: "3Q26 Financial Supplement" }),
      row("deck", "2026-10-13", "presentation", "pdf"),
    ]);
    // The family counts from its latest copy (Oct 15), so it lists before the deck of Oct 13.
    expect(p.load).toEqual(["sec", "deck"]);
    expect(p.counts).toEqual({ stored: 4, loaded: 2, left: { copy: 2 } });
  });
  it("matches copies by period when titles differ", () => {
    const p = planDocuments([
      row("a", "2026-10-13", "press-release", "htm", {
        title: "Earnings release",
        period: "2026Q3",
        source_url: "https://www.sec.gov/a.htm",
      }),
      row("b", "2026-10-14", "press-release", "pdf", { title: "3Q26 results", period: "2026Q3" }),
      row("c", "2026-10-30", "press-release", "htm", { title: "Earnings release" }),
    ]);
    expect(p.load).toEqual(["c", "a"]);
  });
  it("keeps decks for two years and, before 37 months, only supplements (else releases) per quarter", () => {
    const p = planDocuments([
      row("new", "2026-10-13", "press-release"),
      row("deck-1y", "2025-10-13", "presentation", "pdf"),
      row("deck-3y", "2024-01-13", "presentation", "pdf"),
      row("old-pr", "2022-10-13", "press-release"),
      row("old-sup", "2022-10-13", "supplement", "htm", { title: "supplement" }),
      row("old-other", "2022-10-14", "other"),
      row("old-pr-only", "2021-04-20", "press-release"),
      row("ancient", "2010-04-20", "press-release"),
      row("undated", null, "other"),
    ]);
    expect(p.load).toEqual(["new", "deck-1y", "old-sup", "old-pr-only"]);
    expect(p.counts.left).toEqual({ undated: 1, deck: 1, older: 2, "too-old": 1 });
  });
});
