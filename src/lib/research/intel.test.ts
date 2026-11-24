import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const files: Record<string, unknown> = {};
/** Daily bars from the repository's fixtures: covered companies from src/test/fixtures, SPY and sector funds from public/data. */
const priceRows = (t: string) =>
  (JSON.parse(readFileSync(t === "SPY" || t.startsWith("XL") ? `public/data/prices/${t}.json` : `src/test/fixtures/prices/${t}.json`, "utf8")) as { bars: [string, number, number, number, number, number, number][] }).bars;
const companies: Record<string, unknown> = {};
vi.mock("@/lib/data", () => ({
  partnerFile: async (p: string) => {
    if (!(p in files)) throw new Error("404");
    return files[p];
  },
  pricesQuery: (symbol: string, range = "1y", interval = "1d") => ({ queryKey: ["prices", symbol, range, interval], queryFn: async () => ({ bars: priceRows(symbol) }) }),
  companyQuery: (t: string) => ({
    queryKey: ["company", t],
    queryFn: async () => {
      if (!(t in companies)) throw new Error("404");
      return companies[t];
    },
  }),
  usePrices: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
/** SEC primary documents for the view-time read: Apple's reduced 10-Q (Q3 FY26) and 10-K (FY26). */
const DOCS: Record<string, string> = {
  "aapl-20260926.htm": "src/lib/company/fixtures/docs/aapl-20260926.reduced.htm",
  "aapl-20260627.htm": "src/lib/company/fixtures/docs/aapl-20260627.reduced.htm",
};
const sec = vi.hoisted(() => ({ calls: [] as string[], fail: false }));
vi.mock("@/lib/sec.functions", () => ({
  getFilingDocument: async ({ data }: { data: { cik: string; accn: string; doc: string } }) => {
    sec.calls.push(data.accn);
    if (sec.fail || !(data.doc in DOCS)) throw new Error("SEC refused");
    return { html: readFileSync(DOCS[data.doc], "utf8") };
  },
}));

import { compact, docTitle, getCallAnalysis, getKpis, getTrialCatalysts, kpiLines, searchDocTables, seriesOf } from "./intel";
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

describe("get_call_analysis", () => {
  files["calls/TEST.json"] = {
    ticker: "TEST",
    docs: { d9: { id: "d9", title: "3Q26 transcript", url: "https://ir.example.test/t.pdf" }, d8: { id: "d8", title: "2Q26 transcript", url: "https://ir.example.test/t2.pdf" } },
    calls: [
      { call_id: "a", doc: "d8", event_type: "earnings", title: "2Q26", date: "2026-07-14", label: "Q2 FY26", period_end: "2026-06-30", has_qa: true, pending: true },
      {
        call_id: "b",
        doc: "d9",
        event_type: "earnings",
        title: "3Q26",
        date: "2026-10-13",
        label: "Q3 FY26",
        period_end: "2026-09-30",
        has_qa: true,
        summary: "Strong quarter.",
        guidance: [{ metric: "Total NII", period: "Q4 FY26", low: 28e9, high: 28e9, unit: "USD", basis: "new", quote: { q: "total NII to be about $28 billion", p: 2 } }],
        themes: [{ theme: "ai", label: "AI", sentiment: 0.1, confidence: 0.6, summary: "Discussed AI.", quotes: [{ q: "agentic", p: 3 }] }],
        speakers: [{ name: "CFO", role: "Chief Financial Officer", kind: "management", share: 0.6, hedge: 26, tone: 2.1 }],
      },
    ],
  };
  it("returns the newest analysed call with guidance quotes and lists the unanalysed one", async () => {
    const r = await getCallAnalysis(qc, { ticker: "TEST", calls: null, event_type: null });
    expect(r.output).toContain("CALL Q3 FY26");
    expect(r.output).toContain('Total NII Q4 FY26: $28.00B (new) "total NII to be about $28 billion" p.2');
    expect(r.output).toContain("Not yet analysed");
    expect(r.output).toContain("Q2 FY26 doc d8");
  });
});

describe("get_trial_catalysts", () => {
  files["regulatory/catalysts.json"] = {
    as_of: "2026-11-12",
    rows: [
      { ticker: "AAA", nct: "NCT1", title: "Soon", phase: "P3", status: "ACTIVE_NOT_RECRUITING", primary_completion: "2026-11-20" },
      { ticker: "BBB", nct: "NCT2", title: "Later", phase: "P3", status: "RECRUITING", primary_completion: "2027-09-01" },
      { ticker: "CCC", nct: "NCT3", title: "Past", phase: "P2", status: "COMPLETED", primary_completion: "2026-01-01" },
    ],
  };
  it("keeps the calendar window and links each trial", async () => {
    const r = await getTrialCatalysts(qc, { ticker: null, days: 60, phase: null });
    expect(r.output).toContain("AAA P3");
    expect(r.output).toContain("https://clinicaltrials.gov/study/NCT1");
    expect(r.output).not.toContain("BBB");
    expect(r.output).not.toContain("CCC");
  });
});

/* ---------------------------------------------------------------- the two tools that must say what the pages show */

import { QueryClient } from "@tanstack/react-query";
import { hydrateDataset } from "@/lib/financials/dataset";
import { assessCurrency } from "@/lib/financials/currency";
import { extendStatements } from "@/lib/financials/extend";
import type { CompanyDataset, Filing, Statement } from "@/lib/financials/types";
import { readPlan, readSentence } from "@/components/financials/currency";
import { earningsReleasesOf } from "@/components/technicals/use-technicals";
import { analyze, barsFromPriceRows, type Technicals } from "@/lib/technicals/analysis";
import { EVIDENCE } from "@/lib/technicals/evidence";
import type { BenchSeries } from "@/lib/technicals/measures";
import type { SignalsFile } from "@/lib/technicals/data";
import { fmtPct, fmtNum } from "@/lib/technicals/read";
import { fmtVal, getFinancials, getQuantProfile, technicalsText } from "./intel";

const fixture = (t: string) => hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as CompanyDataset);
/** tech/signals.json as the pipeline's code writes it for the eleven fixture companies (the technicals unit's preview file; not production figures). */
const SIGNALS = JSON.parse(readFileSync("src/lib/research/fixtures/tech-signals.json", "utf8")) as SignalsFile;

describe("get_quant_profile gives the Technicals page's analysis", () => {
  files["tech/signals.json"] = SIGNALS;
  const SECTOR = { AAPL: "XLK", NVDA: "XLK", JPM: "XLF" } as const;
  const bench = (sym: string, kind: BenchSeries["kind"]): BenchSeries => {
    const B = barsFromPriceRows(priceRows(sym));
    return { sym, kind, d: B.d, tr: B.tr };
  };
  for (const t of ["AAPL", "NVDA", "JPM"] as const) {
    it(`${t}: the verdict and every figure quoted equal analyze() on the same inputs`, async () => {
      companies[t] = fixture(t);
      const qc = new QueryClient();
      const r = await getQuantProfile(qc, { ticker: t });
      // The page's input: the ten-year price file (no stored long history here), SPY and the sector fund, the 8-K results releases, the cross-company file.
      const T = analyze({
        sym: t,
        bars: barsFromPriceRows(priceRows(t)),
        bench: [bench("SPY", "market"), bench(SECTOR[t], "sector")],
        releases: earningsReleasesOf(companies[t] as CompanyDataset),
        pooled: SIGNALS.signals,
        pooledBase: SIGNALS.base,
        universe: null,
      }) as Technicals;
      expect(r.summary).toBe(`technicals for ${t} as of ${T.asOf}`);
      expect(r.output.length).toBeLessThan(9000);
      const text = technicalsText(T, "prices");
      expect(r.output).toBe([...text.head, ...text.detail].join("\n"));
      // Independently of the formatter: the verdict sentence, its aside, every read sentence and the detectable effects.
      const verdict = T.read.find((s) => s.key === "verdict")!;
      expect(r.output).toContain(`Evidence: ${verdict.text}`);
      expect(r.output).toContain(verdict.aside!);
      for (const s of T.read) expect(r.output).toContain(s.text);
      for (const h of EVIDENCE.horizons) expect(r.output).toContain(`${h} days ${(T.evidence.detectable[h]! * 100).toFixed(2)}%`);
      // Each tested cell of a condition in force: cases, log excess, adjusted q and its verdict.
      for (const row of T.evidence.rows.filter((x) => x.active))
        for (const h of EVIDENCE.horizons) {
          const c = row.cells[h];
          if (!c) continue;
          const sign = (v: number) => fmtPct(v, 2);
          expect(r.output).toContain(`${h} days: ${c.test.nEff} independent cases (${c.test.n} days held)`);
          expect(r.output).toContain(`log excess ${sign(c.test.excess)}`);
          if (c.q != null) expect(r.output).toContain(`q ${fmtNum(c.q, 3)}`);
        }
      // The untested pooled averages are gone.
      expect(r.output).not.toMatch(/hit rate|historically \d+ events/);
    }, 60_000);
  }

  it("AAPL: the scan's recent events carry their tested cross-company verdict, not the untested average", async () => {
    files["tech/states.json"] = { generated: "2026-11-20", as_of: "2026-11-20", rows: [{ t: "AAPL", sector: "Information Technology", d: "2026-11-20", close: 342.56, trend: "up", rsi: 46.4, events: [["macd_bear", "2026-11-19"], ["rsi_bear_div", "2026-11-20"]] }] };
    companies.AAPL = fixture("AAPL");
    const r = await getQuantProfile(new QueryClient(), { ticker: "AAPL" });
    delete files["tech/states.json"];
    const line = r.output.split("\n").find((l) => l.includes("event rsi_bear_div on 2026-11-20"))!;
    expect(line).toMatch(/across companies 20 days, excess [−+]?\d+\.\d\d%, q \d\.\d{3}, (reliable across companies|not distinguishable from all days|small sample|smaller than trading costs|sign differs between periods)/);
    expect(r.output).not.toMatch(/mean return|hit rate/);
  }, 60_000);
});

/** Apple's served dataset cut back to Q2 FY26 (period ending 28 Mar 2026), with the 10-K for FY26 in its filing list. */
const K26: Filing = { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm", ixbrl: true };
function appleAtQ2(): CompanyDataset {
  const d = fixture("AAPL");
  const cut = (s: Statement): Statement => {
    const keep = s.periods.filter((p) => p.end <= "2026-03-28").length;
    return { periods: s.periods.slice(0, keep), rows: s.rows.map((r) => ({ ...r, cells: r.cells.slice(0, keep) })) };
  };
  const Q = d.statements.quarterly;
  return { ...d, statements: { ...d.statements, quarterly: { ...Q, income: cut(Q.income), balance: cut(Q.balance), cashflow: cut(Q.cashflow) } }, filings: [K26, ...d.filings] };
}

describe("get_financials gives the statements the Financials tab shows", () => {
  const served = appleAtQ2();
  const plan = readPlan(served, assessCurrency(served, { ciks: ["320193"] }));
  const ext = extendStatements(
    served,
    plan.map((f) => ({ filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc }, html: readFileSync(DOCS[f.doc], "utf8") })),
  );
  const args = (frequency: string, statement = "income") => ({ ticker: "AAPL", statement, frequency, periods: 4, metrics: null });
  const lineOf = (out: string, key: string) => out.split("\n").find((l) => l.includes(`[${key}]:`))!;
  const cells = (d: CompanyDataset, freq: "annual" | "quarterly", key: string, n: number) => {
    const row = d.statements[freq].income.rows.find((r) => r.key === key)!;
    return row.cells.slice(-n).map((c) => (c ? `${fmtVal(c.v, row.unit)}${c.derived ? "*" : ""}` : "—")).join(" | ");
  };

  it("the served dataset ends at Q2 FY26, and the read adds Q3 FY26, FY2026 and the derived Q4 FY26", () => {
    expect(served.statements.quarterly.income.periods.at(-1)!.label).toBe("Q2 FY26");
    expect(ext.added.map((a) => [a.accn, a.annual, a.quarterly])).toEqual([
      ["0000320193-26-000020", [], ["FY2026Q3"]],
      [K26.accn, ["FY2026"], ["FY2026Q4"]],
    ]);
  });

  it("quarterly: the new columns, marked with their filing, with figures equal to extendStatements", async () => {
    sec.calls = [];
    const qc = new QueryClient();
    const r = await getFinancials(qc, served, args("quarterly"));
    expect(r.output).toContain("Q3 FY26 [2026-03-29→2026-06-27] (read at view time from the 10-Q 0000320193-26-000020)");
    expect(r.output).toContain(`Q4 FY26 [2026-06-28→2026-09-26] (read at view time from the 10-K ${K26.accn})`);
    for (const key of ["revenue", "netIncome", "epsDiluted"]) expect(lineOf(r.output, key)).toBe(`${lineOf(r.output, key).split(": ")[0]}: ${cells(ext.dataset, "quarterly", key, 4)}`);
    expect(lineOf(r.output, "revenue")).toMatch(/\*$/); // the fourth quarter is the year less nine months
    expect(r.output).toContain(readSentence(ext.dataset, ext));
    expect(r.output).toContain("3 columns (Q3 FY2026, FY2026 and Q4 FY2026) are read at view time from the 10-Q filed on 31 Jul 2026 and the 10-K filed on 3 Nov 2026; the scheduled rebuild has not added them yet. Q4 FY2026 is derived: the year less the first nine months.");
    expect(r.output).toContain(`${K26.accn} = 10-K for period 2026-09-26 filed 2026-11-03 (read at view time)`);
    expect(r.summary).toBe("AAPL income, 4 quarterly periods, 2 read at view time");
    expect(sec.calls.sort()).toEqual(["0000320193-26-000020", K26.accn].sort());
    // A second question on the same page state reads nothing again (the page's query keys).
    const a = await getFinancials(qc, served, args("annual"));
    expect(sec.calls).toHaveLength(2);
    expect(a.output).toContain(`FY2026 [2025-09-28→2026-09-26] (read at view time from the 10-K ${K26.accn})`);
    expect(lineOf(a.output, "revenue").endsWith(cells(ext.dataset, "annual", "revenue", 4))).toBe(true);
  });

  it("a failed read falls back to the served statements and says so in the currency line", async () => {
    sec.fail = true;
    try {
      const r = await getFinancials(new QueryClient(), served, args("quarterly"));
      expect(r.output).not.toContain("read at view time");
      expect(r.output).toContain("Columns: Q3 FY25");
      expect(lineOf(r.output, "revenue")).toBe(`${lineOf(r.output, "revenue").split(": ")[0]}: ${cells(served, "quarterly", "revenue", 4)}`);
      expect(r.output).toMatch(/Statement currency: .*could not be read here; the scheduled rebuild will add them\./);
    } finally {
      sec.fail = false;
    }
  });

  it("nothing to read: the served statements, unchanged", async () => {
    sec.calls = [];
    const r = await getFinancials(new QueryClient(), ext.dataset, args("quarterly"));
    expect(sec.calls).toHaveLength(0);
    expect(lineOf(r.output, "revenue").endsWith(cells(ext.dataset, "quarterly", "revenue", 4))).toBe(true);
  });
});
