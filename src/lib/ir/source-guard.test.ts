import { describe, expect, it, vi } from "vitest";
import { buildExternalPayload, type ExtDef, type ExtDoc, type ExtValue } from "@/lib/ir/external";
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import { GUARDED_SOURCES } from "@/lib/ir/source-guard-list";
import { GUARD_STATUS, guardedDocIds, guardedSourceOf, hasGuardedSources, isIrFileAllowed, siteIsGuarded, withoutGuardedCells, withoutGuardedDocs, withoutGuardedFacts } from "@/lib/ir/source-guard";

// Real ir_documents rows (id|ticker|source_url|extract_facts), copied 24 Nov 2026 with the
// checksum-verified transfer (TRANSFER.md, linecheck OK 26 rows). For each ticker: up to two files
// of the wrong company and up to two of the company's own.
const DOC_ROWS = `6d23da4f-ec63-4a87-862b-1a1f4164148d|BEN|https://www.sec.gov/Archives/edgar/data/38777/000119312509089372/dex991.htm|464
fd980cc7-408f-44b8-a34d-87baa4fa5f82|BEN|https://www.sec.gov/Archives/edgar/data/38777/000003877711000173/dex991.htm|413
116a5672-0816-454f-984a-9bf6d99b87f2|BEN|https://fele.widen.net/content/rfsigfmyvd/pdf/2021_Annual_Report_Chairmans_Letter.pdf?u=bt7ctv|0
1467e76a-35ce-40db-831d-08d3527fac63|BEN|https://fele.widen.net/content/8fcwsixfks/pdf/2022_form_10-k-1.pdf?u=bt7ctv|0
13bfdf8d-d65f-4a3e-8de0-cfc8a08836e1|COKE|https://investor.cokeconsolidated.com/news-releases/news-release-details/coca-cola-consolidated-announces-preliminary-results-tender|0
1eece47d-d71d-4afe-b06d-1c3e4bf8f50f|COKE|https://investor.cokeconsolidated.com/news-releases/news-release-details/coca-cola-consolidated-inc-release-first-quarter-2026-results|0
6f566892-c870-45cf-89ac-e5d11d0fa211|COKE|https://investors.coca-colacompany.com/news-events/press-releases/detail/1168/coca-cola-reports-second-quarter-2026-results-and-raises-full-year-guidance|0
e2f893bd-ea4e-4531-a046-2f7fc13b9137|CSCO|https://d18rn0p25nwr6d.cloudfront.net/CIK-0000858877/b713e8ea-e102-4870-88c3-2b28dd872b98.xls|771
46b6db46-3a36-4c9d-a071-d717cd6ee864|CSCO|https://d18rn0p25nwr6d.cloudfront.net/CIK-0000858877/7e7da7a7-cc13-4cd6-be22-f1aaa8aa07b2.xls|589
7fdea5dc-d164-4e45-af4f-4a63f677e9f7|CSCO|https://d18rn0p25nwr6d.cloudfront.net/CIK-0000093751/dfe69441-cc38-4827-8545-58b9e1e2e742.pdf|0
0bc477fb-0c51-488e-86f9-fdbf2d96bbd0|DGII|https://www.sec.gov/Archives/edgar/data/854775/000085477526000029/digiq4fy26investordeckfi018.jpg|0
0d797b88-9ae1-415d-965d-643990b19561|DGII|https://www.sec.gov/Archives/edgar/data/854775/000085477524000027/dgii-ex991_20240807.htm|0
06db9f11-c73d-4037-9bae-2e7f322f7e1b|DGII|https://www.digi-communications.ro/en/see-file/DIGI-Q3-2025-Financial-results-presentation.pdf|0
0e8d74de-abe3-4952-b624-28f5df5b8e27|DGII|https://www.digi-communications.ro/en/see-file/DIGI_20250430205640_Digi-Communications-N-V-2024-Annual-Report.pdf|0
ac77021c-dfa4-4df6-be1c-003911652c9d|FOXA|https://www.sec.gov/Archives/edgar/data/1754301/000119312521236300/d243827dex991.htm|308
1ec025a2-c338-40b1-8267-80691c707a1b|FOXA|https://www.sec.gov/Archives/edgar/data/1754301/000119312520025355/d857196dex991.htm|261
77c37037-ab10-43fc-8ba1-d18b02b7926e|FOXA|https://investor.ridefox.com/news-releases/news-release-details/fox-factory-holding-corp-reports-fourth-quarter-fiscal-2025|118
f0c1c6cd-7218-4fba-97d2-1ba4f04dc278|FOXA|https://investor.ridefox.com/news-releases/news-release-details/fox-factory-holding-corp-reports-fourth-quarter-fiscal-2024|108
008e30ea-1ce0-4ff3-bd6d-cc93b4675d1f|ON|https://www.sec.gov/Archives/edgar/data/1097864/000119312520239594/d84446dex991.htm|0
0480bf35-80ba-4aaa-93a9-61fc931a6487|ON|https://www.sec.gov/Archives/edgar/data/1097864/000119312514230420/d740917dex992.htm|0
1c2a79c4-2b91-418f-b061-4d61d21cb3ca|ON|https://sonal.co.in/wp-content/uploads/Board-Meeting-Notice-June-2023-Results.pdf|0
2d62d700-6687-4a1e-8428-32a2c95d709d|ON|https://sonal.co.in/wp-content/uploads/Board-Meeting-Notice-September-2024-Results.pdf|0
0e909fec-77a3-43a5-8b13-29ef0495ccf1|WABC|https://www.sec.gov/Archives/edgar/data/311094/000117184324000294/exh_991.htm|0
2130f0a6-d2ef-462f-867e-0d7747a2af56|WABC|https://www.sec.gov/Archives/edgar/data/311094/000117184325000282/exh_991.htm|0
019b5884-e315-42fc-b553-540982706b86|WABC|https://s21.q4cdn.com/328636679/files/doc_news/Western-Alliance-Bancorporation-to-Host-2026-Investor-Day-Tuesday-in-New-York-2026.pdf|0
02d0bd32-8bb9-4bcc-8fb5-2f2155743d52|WABC|https://investors.westernalliancebancorporation.com/News-and-Presentations/news/news-details/2026/Western-Alliance-Bank-Named-One-of-Arizonas-Most-Admired-Compa|0`;

// Real FOXA ir_kpi_facts rows (id|document_id|label|period_end|months|value|unit), same transfer
// method (linecheck OK 6 rows): three from a Fox Factory release, three from Fox Corp's own 8-K.
const FACT_ROWS = `01ca1e48-468b-4b47-8941-7dd86f73083b|77c37037-ab10-43fc-8ba1-d18b02b7926e|Prepaids and other current assets|2026-01-02|3|108424000|usd
03b102a4-3a26-48f9-bb96-449c43e2f69f|77c37037-ab10-43fc-8ba1-d18b02b7926e|Powered Vehicles Group|2025-01-03|12|461403000|usd
04766515-99ee-477b-9ef4-2580b78b97e8|77c37037-ab10-43fc-8ba1-d18b02b7926e|Operating expenses: Amortization of purchased intangibles|2025-01-03|12|44528000|usd
01245c32-5f04-4d80-9197-9a68699cf05c|ac77021c-dfa4-4df6-be1c-003911652c9d|Interest expense|2021-06-30|12|395000000|usd
01288549-13cf-46fd-99a6-c870e81b9b0b|ac77021c-dfa4-4df6-be1c-003911652c9d|Segment EBITDA|2020-06-30|3|169000000|usd
025fdcc9-9adf-46a6-8a77-5f9b43a5dc30|ac77021c-dfa4-4df6-be1c-003911652c9d|Other|2021-06-30|3|140000000|usd`;

const docs = DOC_ROWS.split("\n").map((l) => {
  const [id, ticker, source_url, facts] = l.split("|");
  return { id, ticker, source_url, extract_facts: Number(facts) };
});
const facts = FACT_ROWS.split("\n").map((l) => {
  const [id, document_id, label, period_end, months, value, unit] = l.split("|");
  return { id, document_id, label, period_end, months: Number(months), value: Number(value), unit };
});
const own = (t: string) => docs.filter((d) => d.ticker === t && !/sonal|ridefox|digi-communications|CIK-0000093751|widen|coca-colacompany|westernalliance|328636679/.test(d.source_url));
const wrong = (t: string) => docs.filter((d) => d.ticker === t && !own(t).includes(d));

describe("source guard: reviewed wrong pairs", () => {
  it("refuses every wrong file in the real rows and keeps every own file", () => {
    for (const t of ["BEN", "COKE", "CSCO", "DGII", "FOXA", "ON", "WABC"]) {
      expect(wrong(t).length).toBeGreaterThan(0);
      for (const d of wrong(t)) expect(isIrFileAllowed(t, d.source_url), d.source_url).toBe(false);
      for (const d of own(t)) expect(isIrFileAllowed(t, d.source_url), d.source_url).toBe(true);
    }
  });

  it("is scoped to the ticker: the same host stays allowed for its real owner", () => {
    expect(isIrFileAllowed("KO", "https://investors.coca-colacompany.com/news-events/press-releases/detail/1168/x")).toBe(true);
    expect(isIrFileAllowed("FELE", "https://fele.widen.net/content/xkb0wn158w/pdf/2025_10-K.pdf?u=bt7ctv")).toBe(true);
    expect(isIrFileAllowed("STT", "https://d18rn0p25nwr6d.cloudfront.net/CIK-0000093751/dfe69441-cc38-4827-8545-58b9e1e2e742.pdf")).toBe(true);
    // a path-scoped entry refuses only that folder of a shared CDN
    expect(isIrFileAllowed("WABC", "https://s21.q4cdn.com/534284578/files/doc_financials/2025/ar/2025-Annual-Report.pdf")).toBe(true);
  });

  it("refuses the q4cdn folders the 24 Nov title sample showed to be another company's (real rows)", () => {
    // NBTB: The Bancorp's q4 site; SBCF: First Seacoast Bancorp's (FSEA) annual report.
    expect(isIrFileAllowed("NBTB", "https://s27.q4cdn.com/928525813/files/doc_news/The-Bancorp-Advances-Apex-2030-Through-Continued-Organizational-Alignment-2026.pdf")).toBe(false);
    expect(isIrFileAllowed("SBCF", "https://s24.q4cdn.com/806922067/files/doc_financials/2024/ar/FSEA-2024-Annual-Report.pdf")).toBe(false);
    // their own stored releases stay, and the folder stays open to its real owner
    expect(isIrFileAllowed("NBTB", "https://www.sec.gov/Archives/edgar/data/790359/000114036125015461/ef20047848_ex99-1.htm")).toBe(true);
    expect(isIrFileAllowed("SBCF", "https://www.sec.gov/Archives/edgar/data/730708/000073070825000210/sbcf3q2025earningsrelease.htm")).toBe(true);
    expect(isIrFileAllowed("TBBK", "https://s27.q4cdn.com/928525813/files/doc_news/x.pdf")).toBe(true);
  });

  it("matches subdomains of a listed host and survives bad urls", () => {
    expect(isIrFileAllowed("ON", "https://www.sonal.co.in/x.pdf")).toBe(false);
    expect(isIrFileAllowed("ON", "https://notsonal.co.in/x.pdf")).toBe(true);
    expect(isIrFileAllowed("ON", "upload://ir/ON/1/x.pdf")).toBe(true);
    expect(isIrFileAllowed("ON", null)).toBe(true);
    expect(guardedSourceOf("on", "https://sonal.co.in/a.pdf")?.owner).toMatch(/not onsemi/);
  });

  it("every list entry carries its evidence and refuses a file on its own host", () => {
    for (const g of GUARDED_SOURCES) {
      expect(g.evidence.length).toBeGreaterThan(20);
      expect(g.owner.length).toBeGreaterThan(5);
      expect(isIrFileAllowed(g.ticker, `https://${g.host}${g.path ?? "/"}file.pdf`)).toBe(false);
    }
    expect(hasGuardedSources("AAPL")).toBe(false);
  });
});

describe("source guard: page document list and series build", () => {
  it("drops wrong documents from a company's list", () => {
    const kept = withoutGuardedDocs("FOXA", docs.filter((d) => d.ticker === "FOXA"));
    expect(kept.map((d) => d.id)).toEqual(own("FOXA").map((d) => d.id));
    expect(withoutGuardedDocs("AAPL", docs)).toBe(docs);
  });

  it("keeps Fox Factory's stored figures out of Fox Corp's series", () => {
    const refused = guardedDocIds("FOXA", docs.filter((d) => d.ticker === "FOXA"));
    expect([...refused].sort()).toEqual(wrong("FOXA").map((d) => d.id).sort());
    const kept = withoutGuardedFacts(facts, refused);
    expect(kept.map((f) => f.label)).toEqual(["Interest expense", "Segment EBITDA", "Other"]);
    expect(kept.some((f) => f.label === "Powered Vehicles Group")).toBe(false);
  });

  it("drops cells sourced to a refused document from a stored payload", () => {
    const foxFactory = wrong("FOXA")[0].id;
    const sec = own("FOXA")[0].id;
    const cell = (v: number, d: number, e: string): PayloadCell => ({ v, d, e, m: 3 });
    const s = (k: string, q: Record<string, PayloadCell>, y: Record<string, PayloadCell> = {}): PayloadSeries => ({ k, cat: "Segments", met: "Revenue", label: k, parent: null, total: false, unit: "usd", q, y });
    const payload: IrPayload = {
      v: 2,
      ticker: "FOXA",
      builtAt: "2026-11-19T00:00:00Z",
      quarters: ["2025-01-03", "2021-06-30"],
      years: [],
      docs: [
        { id: sec, accn: "0001193125-21-236300", doc: "d243827dex991.htm", kind: "press-release", filed: "2021-08-03" },
        { id: foxFactory, accn: null, doc: null, kind: "press-release", filed: "2025-02-25" },
      ],
      series: [
        s("powered", { "2025-01-03": cell(461403000, 1, "2025-01-03") }),
        s("ebitda", { "2021-06-30": { ...cell(169000000, 0, "2021-06-30"), alt: { v: 1, d: 1, kind: "conflict" } } }),
        s("formula", { "2021-06-30": { v: 5, e: "2021-06-30", m: 3, f: { formula: "a-b", parts: [{ label: "a", v: 6, sign: 1, d: 1, e: "2021-06-30", m: 3 }] } } }),
      ],
      groups: [{ id: "g", cat: "Segments", met: "Revenue", unit: "usd", label: "Revenue", root: "powered", rows: [{ k: "powered", depth: 0 }, { k: "ebitda", depth: 0 }, { k: "formula", depth: 0 }] }],
      checks: [{ k: "powered", e: "2025-01-03", kind: "q", total: 1, sum: 1, ok: true, n: 1 }],
      stats: { series: 3, groups: 1, documents: 2, facts: 3, firstPeriod: null, lastPeriod: null, checksQ: { ok: 1, total: 1 }, checksFY: { ok: 0, total: 0 } },
    };
    const out = withoutGuardedCells(payload, guardedDocIds("FOXA", docs.filter((d) => d.ticker === "FOXA")));
    expect(out.series.map((x) => x.k)).toEqual(["ebitda"]);
    expect(out.series[0].q["2021-06-30"].alt).toBeUndefined();
    expect(out.groups[0].rows.map((r) => r.k)).toEqual(["ebitda"]);
    expect(out.groups[0].root).toBeNull();
    expect(out.checks).toEqual([]);
    expect(withoutGuardedCells(payload, new Set())).toBe(payload);
  });

  it("drops partner figures read from a refused file where partner data is converted", () => {
    const defs: ExtDef[] = [{ kpi_id: "rev", name: "Revenue", category: "Income", unit: "USD", parent_id: null, sums_to_parent: false, sort: 1 }];
    const ext: ExtDoc[] = [
      { id: "p1", url: wrong("FOXA")[0].source_url, title: "Fox Factory Holding Corp. Reports Fourth Quarter Fiscal 2025", doc_type: "press-release", published: "2025-02-25" },
      { id: "p2", url: own("FOXA")[0].source_url, title: "Fox Corporation Reports Fiscal 2021", doc_type: "press-release", published: "2021-08-03" },
    ];
    const values: ExtValue[] = [
      { kpi_id: "rev", period_kind: "Q", period_end: "2025-01-03", fiscal_label: "Q4 FY24", value: 461403000, source_id: "p1", anchor: null, derived: null },
      { kpi_id: "rev", period_kind: "Q", period_end: "2021-06-30", fiscal_label: "Q4 FY21", value: 2560000000, source_id: "p2", anchor: null, derived: null },
    ];
    const p = buildExternalPayload("FOXA", defs, values, ext);
    const cells = p.series.flatMap((x) => Object.values(x.q));
    expect(cells.map((c) => c.v)).toEqual([2560000000]);
    expect(p.docs.map((d) => d.id)).toEqual(["x:p2"]);
    // the same rows under the host's real owner are kept
    expect(buildExternalPayload("FOXF", defs, values, ext).series.flatMap((x) => Object.values(x.q))).toHaveLength(2);
  });

  it("collectors skip a company whose listed IR site is a wrong source", () => {
    expect(siteIsGuarded("ON", "https://sonal.co.in/investor-relations")).toBe(true);
    expect(siteIsGuarded("FOXA", "https://investor.ridefox.com")).toBe(true);
    expect(siteIsGuarded("FOXF", "https://investor.ridefox.com")).toBe(false);
    expect(siteIsGuarded("AAPL", "https://investor.apple.com")).toBe(false);
  });
});

// The readers (ir-extract, ir-vision, ir-prose) all claim through runBatch.
const db = vi.hoisted(() => ({ urls: new Map<string, string>() }));
vi.mock("../../../scripts/lib/supa", () => ({
  args: {},
  dbGate: async () => undefined,
  dbLatency: () => 0,
  log: () => undefined,
  sleep: async () => undefined,
  sb: {
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { source_url: db.urls.get(id) ?? null }, error: null }) }) }),
      upsert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }), lt: async () => ({ error: null }) }) }),
    }),
  },
}));

describe("source guard: readers", () => {
  it("refusedClaim refuses a claimed wrong file and passes an own file", async () => {
    const { refusedClaim } = await import("../../../scripts/lib/runner");
    for (const d of docs) db.urls.set(d.id, d.source_url);
    for (const d of wrong("FOXA")) expect(await refusedClaim({ id: d.id, ticker: "FOXA", label: "" })).toMatch(/Fox Factory/);
    for (const d of own("FOXA")) expect(await refusedClaim({ id: d.id, ticker: "FOXA", label: "" })).toBeNull();
    // a url already on the claim is used as is
    expect(await refusedClaim({ id: "none", ticker: "ON", label: "", source_url: wrong("ON")[0].source_url })).toMatch(/onsemi/);
    expect(await refusedClaim({ id: "none", ticker: "AAPL", label: "" })).toBeNull();
    expect(GUARD_STATUS).toBe("skipped:other-company");
  });
});
