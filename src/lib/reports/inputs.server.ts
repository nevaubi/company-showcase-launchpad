// Server-side loader for report inputs. Reads the stored copies (company datasets mirrored to the
// private `datasets` bucket, filings/estimates/caches in tables) so reports are built from
// trusted data, never from numbers a browser sent.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { Bar, CompanyDataset, Filing, UniverseEntry } from "@/lib/financials/types";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { lastClose, peerSnapshot, selectPeers, type PeerSnapshot } from "./peers";
import type { Estimates } from "@/lib/estimates/core";
import type { TrackedPromise } from "@/lib/earnings/promises";
import type { MarketsFile } from "@/lib/markets/query";
import type { ReportInputs } from "./types";

async function storageJson<T>(path: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin.storage.from("datasets").download(path);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as T;
}

let marketsCache: { at: number; file: MarketsFile | null } | null = null;
async function markets(): Promise<MarketsFile | null> {
  if (marketsCache && Date.now() - marketsCache.at < 3600_000) return marketsCache.file;
  const file = await storageJson<MarketsFile>("markets.json");
  marketsCache = { at: Date.now(), file };
  return file;
}

let universeCache: { at: number; list: UniverseEntry[] } | null = null;
async function universe(): Promise<UniverseEntry[]> {
  if (universeCache && Date.now() - universeCache.at < 3600_000) return universeCache.list;
  // Bundled core companies + the partner-universe companies built by the backfill.
  const [core, extra] = await Promise.all([
    storageJson<{ companies: UniverseEntry[] }>("universe-core.json"),
    storageJson<{ companies: UniverseEntry[] }>("universe.json"),
  ]);
  const seen = new Set<string>();
  const list = [...(core?.companies ?? []), ...(extra?.companies ?? [])].filter((u) => !seen.has(u.ticker) && (seen.add(u.ticker), true));
  universeCache = { at: Date.now(), list };
  return universeCache.list;
}

async function loadBars(ticker: string): Promise<Bar[] | null> {
  const f = await storageJson<{ bars: Bar[] }>(`prices/${ticker}.json`);
  return f?.bars?.length ? f.bars : null;
}

/**
 * Peer snapshots, two at a time; each dataset is reduced to its sourced metrics before the next
 * loads so memory stays small. A peer that fails to load is skipped.
 */
async function loadPeers(ticker: string): Promise<PeerSnapshot[]> {
  const reverse = COVERAGE.filter((c) => c.peers.includes(ticker)).map((c) => c.ticker);
  const list = selectPeers(ticker, await universe(), coverageOf(ticker)?.peers ?? [], reverse);
  const out: PeerSnapshot[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const got = await Promise.all(list.slice(i, i + 2).map(async (t) => {
      try {
        const [raw, bars] = await Promise.all([storageJson<CompanyDataset>(`companies/${t}.json`), loadBars(t)]);
        return raw ? peerSnapshot(hydrateDataset(raw), bars, lastClose(bars)) : null;
      } catch {
        return null;
      }
    }));
    for (const g of got) if (g) out.push(g);
  }
  return out;
}

export async function loadDataset(ticker: string): Promise<CompanyDataset> {
  const raw = await storageJson<CompanyDataset>(`companies/${ticker}.json`);
  if (!raw) throw new Error(`No SEC dataset is stored for ${ticker} yet`);
  const d = hydrateDataset(raw);
  const latest = d.filings.reduce((m, f) => (f.filed > m ? f.filed : m), "");
  const { data: fresh } = await supabaseAdmin.from("sec_filings").select("accn, form, filed, report, doc, description, items, ixbrl, size")
    .eq("ticker", ticker).gt("filed", latest || "1900-01-01").order("filed", { ascending: false }).limit(100);
  if (fresh?.length) {
    const known = new Set(d.filings.map((f) => f.accn));
    const add: Filing[] = fresh.filter((r) => r.form !== "4" && !known.has(r.accn)).map((r) => ({
      accn: r.accn, form: r.form, filed: r.filed, report: r.report ?? undefined, doc: r.doc, desc: r.description ?? undefined,
      items: r.items ?? undefined, ixbrl: r.ixbrl, size: r.size ?? undefined,
    }));
    d.filings = [...add, ...d.filings];
  }
  return d;
}

async function loadPrice(ticker: string, est: Estimates | null, mk: MarketsFile | null): Promise<ReportInputs["price"]> {
  try {
    const { fetchYahoo } = await import("@/lib/market-data.server");
    const r = await fetchYahoo(ticker, "5d", "1d");
    const closes = (r.indicators.quote[0]?.close ?? []).filter((x): x is number => x != null);
    const price = r.meta.regularMarketPrice ?? closes.at(-1);
    if (price) return { price, asOf: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) };
  } catch { /* fall through */ }
  try {
    const { fetchNasdaqQuote } = await import("@/lib/market-data.server");
    const q = await fetchNasdaqQuote(ticker, "stocks");
    return { price: q.price, asOf: new Date().toISOString().slice(0, 10) };
  } catch { /* fall through */ }
  if (est?.price) return { price: est.price, asOf: est.asOf.slice(0, 10) };
  const m = mk?.companies.find((c) => c.ticker === ticker);
  return m ? { price: m.price, asOf: m.asOf } : null;
}

export async function loadReportInputs(ticker: string, coverage: ReportInputs["coverage"] = null): Promise<ReportInputs> {
  const today = new Date().toISOString().slice(0, 10);
  const [data, estRow, promRow, mk, selfBars, spyBars, peers] = await Promise.all([
    loadDataset(ticker),
    supabaseAdmin.from("analyst_estimates").select("payload").eq("ticker", ticker).maybeSingle(),
    supabaseAdmin.from("ai_cache").select("payload, created_at").like("key", `promises:v1:${ticker}:%`).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    markets(),
    loadBars(ticker).catch(() => null),
    loadBars("SPY").catch(() => null),
    loadPeers(ticker).catch(() => [] as PeerSnapshot[]),
  ]);
  const estimates = (estRow.data?.payload as unknown as Estimates) ?? null;
  const promises = ((promRow.data?.payload as unknown as { promises?: TrackedPromise[] })?.promises ?? null) || null;
  const m = mk?.companies.find((c) => c.ticker === ticker);
  const price = await loadPrice(ticker, estimates, mk);
  return {
    today,
    data,
    price,
    estimates,
    promises: promises?.length ? promises : null,
    reactions: m ? { reactions: m.reactions, stats: m.stats } : null,
    coverage,
    peers,
    prices: { self: selfBars, spy: spyBars },
  };
}
