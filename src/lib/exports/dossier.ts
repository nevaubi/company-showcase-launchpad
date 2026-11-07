// Everything a company deliverable (tear sheet, IC memo, model) needs, gathered once, plus a numbered source
// register so every printed figure carries a reference to the filing or dataset it came from.
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companyQuery, pricesQuery, quotesQuery } from "@/lib/data";
import { earningsIndexQuery, type EstimatesIndexRow } from "@/lib/calendars/data";
import { screenerFileQuery } from "@/lib/screener/use-rows";
import { rowsFromFile, type Row as ScreenRow } from "@/lib/screener/engine";
import { supplyLinksQuery } from "@/lib/supply/query";
import type { RiskLink } from "@/lib/supply/core";
import type { Bar, Cell, CompanyDataset, Filing, Statement } from "@/lib/financials/types";

export const edgarUrl = (cik: string | number, accn: string, doc?: string | null) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc ?? ""}`;

export interface SourceEntry {
  n: number;
  key: string;
  label: string;
  url: string | null;
}

/** Numbered source list: the same filing or dataset gets the same number everywhere it is cited. */
export class SourceRegister {
  private byKey = new Map<string, SourceEntry>();
  constructor(private cik: string, private filings: Map<string, Filing>) {}

  filing(accn: string | undefined | null, doc?: string): number | null {
    if (!accn) return null;
    const f = this.filings.get(accn);
    const key = `f:${accn}`;
    const hit = this.byKey.get(key);
    if (hit) return hit.n;
    const label = f ? `${f.form} filed ${f.filed}${f.report ? ` (period ${f.report})` : ""}, accession ${accn}` : `SEC filing, accession ${accn}`;
    return this.add(key, label, edgarUrl(this.cik, accn, doc ?? f?.doc ?? ""));
  }

  cell(c: Cell | null | undefined): number | null {
    if (!c) return null;
    if (c.src?.accn) return this.filing(c.src.accn, c.src.doc);
    const part = c.derived?.parts?.[0];
    return part ? this.filing(part.accn, part.doc) : null;
  }

  dataset(key: string, label: string, url: string | null = null): number {
    const hit = this.byKey.get(`d:${key}`);
    return hit ? hit.n : this.add(`d:${key}`, label, url);
  }

  private add(key: string, label: string, url: string | null): number {
    const n = this.byKey.size + 1;
    this.byKey.set(key, { n, key, label, url });
    return n;
  }

  list(): SourceEntry[] {
    return [...this.byKey.values()].sort((a, b) => a.n - b.n);
  }
}

export interface AltEvent {
  dataset: string;
  date: string | null;
  title: string;
  value: number | null;
  unit: string | null;
  source: string;
  source_url: string | null;
}

export interface Dossier {
  ticker: string;
  d: CompanyDataset;
  price: number | null;
  priceDate: string | null;
  changePct: number | null;
  screen: ScreenRow | null;
  screenAsOf: string | null;
  estimates: EstimatesIndexRow | null;
  bars: Bar[];
  links: RiskLink[];
  alt: AltEvent[];
  generated: string;
}

export async function gatherDossier(qc: QueryClient, ticker: string): Promise<Dossier> {
  const t = ticker.toUpperCase();
  const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const [d, quotes, screenFile, est, prices, links, alt] = await Promise.all([
    qc.fetchQuery(companyQuery(t)),
    qc.fetchQuery(quotesQuery([t])).catch(() => null),
    qc.fetchQuery(screenerFileQuery).catch(() => null),
    qc.fetchQuery(earningsIndexQuery).catch(() => null),
    qc.fetchQuery(pricesQuery(t, "1y", "1d")).catch(() => null),
    qc.fetchQuery(supplyLinksQuery).catch(() => [] as RiskLink[]),
    supabase
      .from("alt_data")
      .select("dataset,date,title,value,unit,source,source_url")
      .eq("ticker", t)
      .eq("kind", "event")
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(40)
      .then((r) => (r.data ?? []) as AltEvent[], () => [] as AltEvent[]),
  ]);
  const q = quotes?.quotes?.find((x) => x.symbol === t) ?? null;
  const bars = (prices?.bars ?? []) as Bar[];
  const lastBar = bars.at(-1);
  return {
    ticker: t,
    d,
    price: q?.price ?? lastBar?.[4] ?? null,
    priceDate: lastBar?.[0]?.slice(0, 10) ?? null,
    changePct: q?.changePct ?? null,
    screen: screenFile ? (rowsFromFile(screenFile).find((r) => r.ticker === t) ?? null) : null,
    screenAsOf: screenFile?.asof?.prices ?? screenFile?.generated?.slice(0, 10) ?? null,
    estimates: est?.companies.find((c) => c.ticker === t) ?? null,
    bars,
    links: (links ?? []).filter((l) => l.ticker === t),
    alt,
    generated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- statement helpers

export const ROW_KEYS = {
  revenue: ["revenue", "totalRevenue", "revenues"],
  grossProfit: ["grossProfit"],
  operatingIncome: ["operatingIncome"],
  netIncome: ["netIncome"],
  eps: ["epsDiluted", "epsBasic"],
  cfo: ["cfo"],
  capex: ["capex"],
  fcf: ["fcf"],
  cash: ["cash"],
  debt: ["totalDebt"],
  equity: ["equity", "totalEquity"],
} as const;

export function findRow(st: Statement | undefined, keys: readonly string[]) {
  if (!st) return null;
  for (const k of keys) {
    const r = st.rows.find((x) => x.key === k);
    if (r) return r;
  }
  return null;
}

/** Last `n` periods of a row with their cells (null where not reported). */
export function lastPeriods(st: Statement | undefined, keys: readonly string[], n: number) {
  const row = findRow(st, keys);
  if (!st || !row) return null;
  let end = row.cells.length - 1;
  while (end >= 0 && !row.cells[end]) end--;
  if (end < 0) return null;
  const start = Math.max(0, end - n + 1);
  return { row, periods: st.periods.slice(start, end + 1), cells: row.cells.slice(start, end + 1) };
}

export function ttmSum(st: Statement | undefined, keys: readonly string[]): { value: number; cells: Cell[] } | null {
  const row = findRow(st, keys);
  if (!row) return null;
  let end = row.cells.length - 1;
  while (end >= 0 && !row.cells[end]) end--;
  if (end < 3) return null;
  const cells = [row.cells[end - 3], row.cells[end - 2], row.cells[end - 1], row.cells[end]];
  if (cells.some((c) => !c)) return null;
  return { value: cells.reduce((s, c) => s + c!.v, 0), cells: cells as Cell[] };
}

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function fmtMoney(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(digits)}K`;
  return `${s}$${a.toFixed(2)}`;
}

export const fmtPctV = (v: number | null | undefined, d = 1, signed = false) =>
  v == null || !Number.isFinite(v) ? "n/a" : `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

export const fmtX = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(d)}x`);

export const fmtNum = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(d));

/** Insider open-market activity in the last `days` (codes P and S, non-derivative by construction of the dataset). */
export function insiderSummary(d: CompanyDataset, days = 90, today = new Date().toISOString().slice(0, 10)) {
  const cut = new Date(new Date(`${today}T12:00:00Z`).getTime() - days * 86400_000).toISOString().slice(0, 10);
  const rows = d.insiders.filter((x) => x.date >= cut && (x.code === "P" || x.code === "S"));
  const v = (x: (typeof rows)[number]) => x.shares * (x.price ?? 0);
  const buys = rows.filter((x) => x.code === "P");
  const sells = rows.filter((x) => x.code === "S");
  return {
    buys: buys.length,
    buyValue: buys.reduce((s, x) => s + v(x), 0),
    buyers: new Set(buys.map((x) => x.owner)).size,
    sells: sells.length,
    sellValue: sells.reduce((s, x) => s + v(x), 0),
    planSells: sells.filter((x) => x.plan10b5).length,
    largest: [...rows].sort((a, b) => v(b) - v(a)).slice(0, 5),
  };
}
