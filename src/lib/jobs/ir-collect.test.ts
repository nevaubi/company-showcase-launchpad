import { beforeEach, describe, expect, it, vi } from "vitest";

// A small in-memory database and SEC archive: enough of supabase-js (select/eq/in/is/range/limit,
// update, upsert) and of fetchSec for the collector's own paths.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, uploads: [] as string[], sec: {} as Record<string, string | object>, fetched: [] as string[] }));

vi.mock("@/integrations/supabase/client.server", () => {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "upsert"; value: Row | Row[]; on: string } = { kind: "select" };
    let lo = 0;
    let hi = Infinity;
    const q: Record<string, unknown> = {};
    const chain = (f?: (r: Row) => boolean) => {
      if (f) filters.push(f);
      return q;
    };
    q.select = () => chain();
    q.order = () => chain();
    q.like = () => chain();
    q.gte = () => chain();
    q.or = () => chain();
    q.eq = (c: string, v: unknown) => chain((r) => r[c] === v);
    // Like the API gateway, a long address list is refused (a 400-address list is a 40 KB request line).
    let refused: string | null = null;
    q.in = (c: string, v: unknown[]) => {
      if (v.length > 40) refused = "request line too long";
      return chain((r) => v.includes(r[c]));
    };
    q.is = (c: string, v: unknown) => chain((r) => (r[c] ?? null) === v);
    q.limit = (n: number) => ((hi = Math.min(hi, lo + n - 1)), q);
    q.range = (a: number, b: number) => ((lo = a), (hi = b), q);
    q.update = (patch: Row) => ((op = { kind: "update", patch }), q);
    q.upsert = (value: Row | Row[], o?: { onConflict?: string }) => ((op = { kind: "upsert", value, on: o?.onConflict ?? (table === "ir_release_scan" ? "accn" : table === "job_state" ? "job" : "id") }), q);
    q.maybeSingle = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (refused) return Promise.resolve({ error: { message: refused }, data: null }).then(resolve);
      const rows = (db.tables[table] ??= []);
      if (op.kind === "update") {
        for (const r of rows.filter((r) => filters.every((f) => f(r)))) Object.assign(r, op.patch);
        return Promise.resolve({ error: null, data: null }).then(resolve);
      }
      if (op.kind === "upsert") {
        const on = op.on;
        for (const v of Array.isArray(op.value) ? op.value : [op.value]) {
          const old = rows.find((r) => r[on] === v[on]);
          if (old) Object.assign(old, v);
          else rows.push({ id: `${table}-${rows.length + 1}`, ...v });
        }
        return Promise.resolve({ error: null, data: null }).then(resolve);
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(lo, hi + 1);
      return Promise.resolve({ error: null, data: hit }).then(resolve);
    };
    return q;
  };
  return { supabaseAdmin: { from, storage: { from: () => ({ upload: async (path: string) => (db.uploads.push(path), { error: null }) }) } } };
});
vi.mock("@/lib/sec.server", () => ({
  archiveUrl: (c: string, a: string, d: string) => `https://www.sec.gov/Archives/edgar/data/${Number(c)}/${a.replace(/-/g, "")}/${d}`,
  fetchSec: async (url: string) => {
    db.fetched.push(url);
    const body = db.sec[url];
    if (body == null) return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() };
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const type = /\.jpg$/.test(url) ? "image/jpeg" : /\.json$/.test(url) ? "application/json" : "text/html";
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer, headers: new Headers({ "content-type": type }) };
  },
}));

import { COVERAGE } from "@/lib/coverage";
import { collectIr, collectRecentRelease } from "./ir.server";

const company = (t: string) => COVERAGE.find((c) => c.ticker === t)!;
const base = (cik: string, accn: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/`;
/** An EDGAR filing index: one row per document (seq, description, document, type, size). */
const index = (cik: string, accn: string, docs: [name: string, type: string, description: string][]) =>
  `<table class="tableFile">${docs.map(([n, t, d], i) => `<tr><td>${i + 1}</td><td>${d}</td><td><a href="/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${n}">${n}</a></td><td>${t}</td><td>100</td></tr>`).join("")}</table>`;
const pageImage = (i: number) => `JPEG page ${i} of the trend report ${"x".repeat(50)}`;

beforeEach(() => {
  db.tables = {};
  db.uploads = [];
  db.sec = {};
  db.fetched = [];
});

describe("an image-only exhibit held from the partner corpus (NTRS 3Q26 Trend Report)", () => {
  // https://www.sec.gov/Archives/edgar/data/73124/000007312426000063/ (filed 2026-10-21): the EX-99.3
  // Trend Report is 13 page images in an HTML wrapper; the partner corpus holds the three HTML files only.
  const accn = "0000073124-26-000063";
  const cik = "73124";
  const htm: [string, string, string][] = [
    ["q32026earningsreleaseex991.htm", "EX-99.1", "EX-99.1"],
    ["q32026presentationmateri.htm", "EX-99.2", "EX-99.2"],
    ["q32026trendreport_ex993.htm", "EX-99.3", "EX-99.3"],
  ];
  const images: [string, string, string][] = Array.from({ length: 13 }, (_, i) => [`q32026trendreport_ex993${String(i + 1).padStart(3, "0")}.jpg`, "GRAPHIC", ""]);
  function setup() {
    db.tables.ir_documents = htm.map(([n], i) => ({ id: `p${i}`, ticker: "NTRS", source: "partner", source_url: base(cik, accn) + n, accn, exhibit: null, kind: i === 0 ? "press-release" : i === 1 ? "presentation" : "supplement", sha256: `partner-${i}` }));
    db.sec[`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`] = { filings: { recent: { accessionNumber: [accn], form: ["8-K"], filingDate: ["2026-10-21"], reportDate: ["2026-10-21"], items: ["2.02,7.01,9.01"] }, files: [] } };
    db.sec[base(cik, accn) + `${accn}-index.htm`] = index(cik, accn, [...htm, ...images]);
    images.forEach(([n], i) => (db.sec[base(cik, accn) + n] = pageImage(i + 1)));
  }
  it("stores the page images, numbers the held exhibits and records the filing as done", async () => {
    setup();
    const r = await collectIr(company("NTRS"), "sec", 20, { since: "2026-10-01" });
    expect(r.stored).toBe(13);
    const docs = db.tables.ir_documents;
    expect(docs.filter((d) => d.kind === "image")).toHaveLength(13);
    expect(docs.filter((d) => d.source === "partner").map((d) => d.exhibit)).toEqual(["EX-99.1", "EX-99.2", "EX-99.3"]);
    // The held HTML files are not fetched again.
    expect(db.fetched.filter((u) => /\.htm$/.test(u) && !/index/.test(u))).toEqual([]);
    expect(db.tables.ir_release_scan).toEqual([expect.objectContaining({ accn, ticker: "NTRS", files: 16, stored: 16, status: "done" })]);
    // Next pass: the filing is done and its index is not read again.
    db.fetched = [];
    expect((await collectIr(company("NTRS"), "sec", 20, { since: "2026-10-01" })).stored).toBe(0);
    expect(db.fetched.some((u) => /index\.htm$/.test(u))).toBe(false);
  });
  it("a filing the collector stored itself is still skipped", async () => {
    setup();
    db.tables.ir_documents.push({ id: "own", ticker: "NTRS", source: "sec-exhibit", source_url: base(cik, accn) + images[0][0], accn, exhibit: "GRAPHIC", kind: "image", sha256: "own" });
    expect((await collectIr(company("NTRS"), "sec", 20, { since: "2026-10-01" })).stored).toBe(0);
    expect(db.fetched.some((u) => /index\.htm$/.test(u))).toBe(false);
  });
});

describe("XOM's filings under its new CIK, held from the partner corpus without accession or exhibit", () => {
  // https://www.sec.gov/Archives/edgar/data/2115436/000211543626000018/ (3Q26, filed 2026-10-30)
  const accn = "0002115436-26-000018";
  const cik = "2115436";
  it("the release collector fills in the exhibit number and accession and downloads nothing it holds", async () => {
    db.tables.sec_filings = [{ accn, ticker: "XOM", cik, filed: "2026-10-30", report: "2026-10-30", items: "2.02,7.01", form: "8-K" }];
    db.tables.ir_documents = [
      { id: "x1", ticker: "XOM", source: "partner", source_url: base(cik, accn) + "livef8k3q26991.htm", accn: null, exhibit: null, sha256: "a" },
      { id: "x2", ticker: "XOM", source: "partner", source_url: base(cik, accn) + "livef8k3q26992.htm", accn: null, exhibit: null, sha256: "b" },
    ];
    db.sec[base(cik, accn) + `${accn}-index.htm`] = index(cik, accn, [
      ["livef8k3q26991.htm", "EX-99.1", "EX-99.1"],
      ["livef8k3q26992.htm", "EX-99.2", "EX-99.2"],
    ]);
    const r = await collectRecentRelease([company("XOM")]);
    expect(r).toMatchObject({ accn, status: "done", stored: 0 });
    expect(db.tables.ir_documents.map((d) => [d.exhibit, d.accn])).toEqual([["EX-99.1", accn], ["EX-99.2", accn]]);
    expect(db.uploads).toEqual([]);
    expect(db.fetched.filter((u) => /\.htm$/.test(u) && !/index/.test(u))).toEqual([]);
  });
});

describe("a filing with many files (WFC 3Q26: 25 page images and 3 exhibits, here 60 images)", () => {
  const accn = "0000072971-26-000318";
  const cik = "72971";
  it("looks held files up in short address lists and stores only the ones missing", async () => {
    const names = Array.from({ length: 60 }, (_, i) => `ex993-wellsfargo3q26pres${String(i + 1).padStart(3, "0")}.jpg`);
    db.tables.sec_filings = [{ accn, ticker: "WFC", cik, filed: "2026-10-13", report: "2026-09-30", items: "2.02,9.01", form: "8-K" }];
    db.tables.ir_documents = names.slice(0, 50).map((n, i) => ({ id: `w${i}`, ticker: "WFC", source: "sec-exhibit", source_url: base(cik, accn) + n, accn, exhibit: "GRAPHIC", kind: "image", sha256: `w${i}` }));
    db.sec[base(cik, accn) + `${accn}-index.htm`] = index(cik, accn, names.map((n) => [n, "GRAPHIC", ""]));
    names.forEach((n, i) => (db.sec[base(cik, accn) + n] = pageImage(100 + i)));
    const r = await collectRecentRelease([company("WFC")]);
    expect(r).toMatchObject({ accn, status: "done", stored: 10 });
    expect(db.tables.ir_documents).toHaveLength(60);
  });
});

describe("a file whose bytes the ticker already holds is not stored again (UNH EX-99.1 and EX-99.2)", () => {
  // https://www.sec.gov/Archives/edgar/data/731766/000073176626000255/ (3Q26, filed 2026-10-13): the
  // release is filed twice under two names. Here the second name carries the same bytes.
  const accn = "0000731766-26-000255";
  const cik = "731766";
  it("stores the first copy, skips the second without a failure, and the filing is done", async () => {
    db.tables.sec_filings = [{ accn, ticker: "UNH", cik, filed: "2026-10-13", report: "2026-09-30", items: "2.02,9.01", form: "8-K" }];
    db.tables.ir_documents = [];
    const release = "<html><body><p>EX-99.1</p><p>UnitedHealth Group Reports Third Quarter 2026 Results</p></body></html>";
    db.sec[base(cik, accn) + `${accn}-index.htm`] = index(cik, accn, [
      ["earningsrelease3q26unh.htm", "EX-99.1", "EX-99.1"],
      ["earningsrelease3q26unh-copy.htm", "EX-99.2", "EX-99.2"],
    ]);
    db.sec[base(cik, accn) + "earningsrelease3q26unh.htm"] = release;
    db.sec[base(cik, accn) + "earningsrelease3q26unh-copy.htm"] = release;
    // One at a time so the first copy is held when the second arrives (production stores three at a time;
    // the next run or the walk then meets the held bytes the same way).
    let calls = 0;
    const r = await collectRecentRelease([company("UNH")], () => calls++ < 1);
    expect(r).toMatchObject({ stored: 1, status: "partial" });
    const again = await collectRecentRelease([company("UNH")]);
    expect(again).toMatchObject({ stored: 0, status: "done" });
    expect(again!.results).toEqual([expect.objectContaining({ duplicate: expect.any(String) })]);
    expect(db.tables.ir_documents).toHaveLength(1);
    expect(db.uploads).toHaveLength(1);
  });
});

describe("kind from the exhibit's own first lines (C 3Q26 EX-99.2)", () => {
  const accn = "0001104659-26-115323";
  const cik = "831001";
  it("stores c-ex99d2.htm, Quarterly Financial Data Supplement, as a supplement", async () => {
    db.tables.sec_filings = [{ accn, ticker: "C", cik, filed: "2026-10-13", report: "2026-09-30", items: "2.02,9.01", form: "8-K" }];
    db.sec[base(cik, accn) + `${accn}-index.htm`] = index(cik, accn, [["c-ex99d2.htm", "EX-99.2", "EX-99.2"]]);
    db.sec[base(cik, accn) + "c-ex99d2.htm"] = "<html><body><p>EX-99.2 3 c-ex99d2.htm EX-99.2</p><p>Exhibit 99.2</p><p>&#8203;</p><p>CITIGROUP&#8212;QUARTERLY FINANCIAL DATA SUPPLEMENT 3Q26</p></body></html>";
    await collectRecentRelease([company("C")]);
    expect(db.tables.ir_documents).toEqual([expect.objectContaining({ exhibit: "EX-99.2", kind: "supplement", sha256: expect.any(String) })]);
  });
});
