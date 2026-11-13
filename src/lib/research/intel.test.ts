import { describe, expect, it, vi } from "vitest";

const files: Record<string, unknown> = {};
vi.mock("@/lib/data", () => ({
  partnerFile: async (p: string) => {
    if (!(p in files)) throw new Error("404");
    return files[p];
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { compact, docTitle, getKpis, kpiLines, searchDocTables, seriesOf } from "./intel";
import type { KpiFile, KpiItem } from "@/lib/statements/filed";

const qc = { fetchQuery: async (o: { queryFn: () => unknown }) => o.queryFn() } as never;
const src = (v: number, page: number, label: string) => ({ v, page, label, doc_title: "3Q26 Earnings Supplement 3Q26 Earnings Supplement PDF", quote: `Line ${v}`, url: "https://ir.example.test/s.pdf" });

const nim: KpiItem = {
  id: "nim",
  name: "NET YIELD ON INTEREST-EARNING ASSETS",
  unit: "%",
  values: { Q: { "2026-06-30": src(2.4, 7, "Q2 FY26"), "2026-09-30": src(2.48, 7, "Q3 FY26"), "2025-09-30": src(2.45, 7, "Q3 FY25"), "2025-12-31": src(2.54, 7, "Q4 FY25"), "2026-03-31": src(2.5, 7, "Q1 FY26") } },
};
const cet1 = { id: "cet1_ratio", name: "CET1 capital ratio", unit: "%", values: { Q: {}, A: {}, I: { "2026-06-30": src(12.78, 0, "Q2 FY26"), "2026-09-30": src(12.8, 0, "Q3 FY26") } } } as unknown as KpiItem;
const toc = { id: "toc", name: "CET1 Capital and Supplementary Leverage Ratios", unit: "%", values: { Q: { "2026-09-30": src(22, 0, "Q3 FY26") } } } as KpiItem;

describe("KPI series", () => {
  it("reads point-in-time values when a ratio has no quarterly series", () => {
    expect(seriesOf(cet1, "Q").basis).toBe("point in time");
    expect(Object.keys(seriesOf(cet1, "Q").vals)).toHaveLength(2);
    expect(seriesOf(nim, "Q").basis).toBe("quarterly");
  });
  it("prints level, QoQ and YoY in points for rates, with page and quote", () => {
    const [latest] = kpiLines(nim, "Q", 5);
    expect(latest).toContain("2.48%");
    expect(latest).toContain("QoQ +0.08 pp");
    expect(latest).toContain("YoY +0.03 pp");
    expect(latest).toContain("3Q26 Earnings Supplement p.7");
    expect(latest).toContain("#page=7");
  });
  it("cleans titles that repeat themselves", () => {
    expect(docTitle("3Q26 Earnings Supplement 3Q26 Earnings Supplement PDF")).toBe("3Q26 Earnings Supplement");
    expect(docTitle("Q4 2005 Financial supplement")).toBe("Q4 2005 Financial supplement");
  });
});

describe("get_kpis", () => {
  const file: KpiFile = {
    ticker: "TEST",
    groups: [
      { category: "Avg Balance Sheet & Yields", items: [nim] },
      { category: "Capital", items: [cet1] },
      { category: "Workbook: Index", items: [toc] },
    ],
  };
  files["kpis/TEST.json"] = file;
  it("maps analyst shorthand to the printed label", async () => {
    const r = await getKpis(qc, { ticker: "TEST", query: "net interest margin", frequency: null, periods: 2, max_items: 2 });
    expect(r.output).toContain("NET YIELD ON INTEREST-EARNING ASSETS");
  });
  it("finds a ratio stored point in time and ignores a workbook contents page", async () => {
    const r = await getKpis(qc, { ticker: "TEST", query: "CET1 ratio", frequency: null, periods: 2, max_items: 3 });
    expect(r.output).toContain("CET1 capital ratio");
    expect(r.output).toContain("12.8");
    expect(r.output).not.toContain("22.0%");
  });
  it("returns a category map without a query", async () => {
    const r = await getKpis(qc, { ticker: "TEST", query: null });
    expect(r.output).toMatch(/2 KPIs, 7 values/);
    expect(r.output).not.toContain("Workbook: Index");
  });
});

describe("search_doc_tables", () => {
  files["doctables/TEST/index.json"] = { ticker: "TEST", documents: [{ id: "d1", title: "3Q26 Earnings Presentation PDF || nav junk", doc_type: "presentation", url: "https://ir.example.test/p.pdf", pages: 10, n_tables: 2 }] };
  files["doctables/TEST/d1.json"] = {
    id: "d1",
    title: "3Q26 Earnings Presentation",
    url: "https://ir.example.test/p.pdf",
    tables: [
      { page: 3, caption: "Capital", n_rows: 1, n_cols: 2, header: [["", "3Q26"]], rows: [["CET1 ratio", "15.2%"]] },
      { page: 5, caption: null, n_rows: 2, n_cols: 2, header: [["", "3Q26"]], rows: [["Revenue", "$21,171"], ["Net charge-offs (NCOs)", "1,976"]] },
    ],
  };
  files["ir/TEST.json"] = { ticker: "TEST", documents: [{ id: "d1", fiscal_label: "Q3 FY26", period_end: "2026-09-30" }] };
  it("returns the matching table with page link and a clean title", async () => {
    const r = await searchDocTables(qc, { ticker: "TEST", query: "net charge-offs", doc_query: null, max_docs: null, max_tables: 1 });
    expect(r.output).toContain("3Q26 Earnings Presentation (Q3 FY26) page 5");
    expect(r.output).toContain("#page=5");
    expect(r.output).toContain("Net charge-offs (NCOs) | 1,976");
    expect(r.output).not.toContain("nav junk");
  });
});

describe("compact", () => {
  it("cuts long arrays and strings", () => {
    const c = compact({ a: Array.from({ length: 20 }, (_, i) => i), s: "x".repeat(500), n: null }, 3, 10) as Record<string, unknown>;
    expect(c.a).toEqual([0, 1, 2, "…+17 more"]);
    expect(String(c.s)).toHaveLength(11);
    expect("n" in c).toBe(false);
  });
});
