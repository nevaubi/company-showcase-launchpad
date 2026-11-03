// Scheduled refresh jobs. Each invocation handles one small slice (the scheduler's
// HTTP call is short-lived and Workers allow six concurrent outbound requests),
// advancing a cursor in job_state so successive runs rotate through everything.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BENCHMARKS, COVERAGE, MACRO_SERIES } from "@/lib/coverage";
import { form4XmlPath, parseForm4 } from "@/lib/financials/form4";
import { summarize } from "@/lib/macro";
import { fetchCboeDaily, fetchFred, fetchNasdaqDaily, fetchTreasury, fetchYahoo, isCboeIndex, isTreasurySeries, pool, toBars } from "@/lib/market-data.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import type { Json } from "@/integrations/supabase/types";

export type JobName = "prices" | "macro" | "sec" | "filing-cache" | "ir-docs" | "ir-site";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function advance(job: JobName, total: number, step: number): Promise<{ start: number; wrapped: boolean }> {
  const { data } = await supabaseAdmin.from("job_state").select("cursor").eq("job", job).maybeSingle();
  const start = (data?.cursor ?? 0) % Math.max(1, total);
  const next = start + step;
  await supabaseAdmin.from("job_state").upsert({ job, cursor: next >= total ? 0 : next, updated_at: new Date().toISOString() });
  return { start, wrapped: next >= total };
}

const slice = <T,>(all: T[], start: number, n: number) => all.slice(start, start + n);

export async function runJob(job: JobName): Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }> {
  const { data: run } = await supabaseAdmin.from("job_runs").insert({ job }).select("id").single();
  let result: { ok: boolean; items: number; detail: Record<string, unknown> };
  try {
    result = await JOBS[job]();
  } catch (e) {
    result = { ok: false, items: 0, detail: { error: (e as Error).message } };
  }
  if (run) {
    await supabaseAdmin
      .from("job_runs")
      .update({ finished_at: new Date().toISOString(), ok: result.ok, items: result.items, detail: result.detail as Json })
      .eq("id", run.id);
  }
  return result;
}

const JOBS: Record<JobName, () => Promise<{ ok: boolean; items: number; detail: Record<string, unknown> }>> = {
  /** Daily bars for ten symbols per run. */
  async prices() {
    const symbols = [...COVERAGE.map((c) => c.ticker), ...BENCHMARKS.map((b) => b.symbol)];
    const { start, wrapped } = await advance("prices", symbols.length, 10);
    const batch = slice(symbols, start, 10);
    const stocks = new Set(COVERAGE.map((c) => c.ticker));
    const results = await pool(batch, 3, async (symbol) => {
      // Yahoo first (dividend-adjusted closes); Nasdaq (stocks, ETFs) or Cboe (VIX) when Yahoo throttles.
      let bars;
      try {
        bars = toBars(await fetchYahoo(symbol, "1mo", "1d"), false);
      } catch (e) {
        const fallback = isCboeIndex(symbol)
          ? fetchCboeDaily(symbol)
          : symbol.startsWith("^")
            ? Promise.reject(new Error("no fallback for this index"))
            : fetchNasdaqDaily(symbol, stocks.has(symbol) ? "stocks" : "etf");
        bars = await fallback.catch((n: Error) => {
          throw new Error(`${(e as Error).message}; ${n.message}`);
        });
      }
      const rows = bars.map(([date, open, high, low, close, adj, volume]) => ({
        symbol,
        date,
        open,
        high,
        low,
        close,
        adj_close: adj,
        volume: Math.round(volume),
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("market_bars").upsert(rows);
      if (error) throw new Error(error.message);
      return rows.length;
    });
    if (wrapped) {
      await supabaseAdmin.from("market_bars").delete().lt("date", daysAgo(400));
      await supabaseAdmin.from("job_runs").delete().lt("started_at", new Date(Date.now() - 14 * 86400000).toISOString());
    }
    const failed = batch.flatMap((sym, i) => (results[i].status === "rejected" ? [`${sym}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? results[i])}`] : []));
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
    return { ok: failed.length < batch.length, items, detail: { symbols: batch, failed } };
  },

  /** Eight macro series per run: recent observations plus a fresh dashboard summary. */
  async macro() {
    const defs = MACRO_SERIES;
    const { start, wrapped } = await advance("macro", defs.length, 8);
    const batch = slice(defs, start, 8);
    const since = daysAgo(11 * 365);
    const results = await pool(batch, 2, async (def) => {
      const obs = isTreasurySeries(def.id) ? await fetchTreasury(def.id, since, 1) : await fetchFred(def.id, since);
      if (!obs.length) throw new Error("no observations");
      const cutoff = daysAgo(400);
      const recent = obs.filter(([d]) => d >= cutoff).map(([date, value]) => ({ series_id: def.id, date, value, updated_at: new Date().toISOString() }));
      if (recent.length) {
        const { error } = await supabaseAdmin.from("macro_observations").upsert(recent);
        if (error) throw new Error(error.message);
      }
      const summary = summarize(def, obs);
      const { error } = await supabaseAdmin
        .from("macro_summaries")
        .upsert({ series_id: def.id, summary: summary as unknown as Json, updated_at: summary.updatedAt });
      if (error) throw new Error(error.message);
      return recent.length;
    });
    if (wrapped) await supabaseAdmin.from("macro_observations").delete().lt("date", daysAgo(420));
    const failed = batch.flatMap((d, i) => (results[i].status === "rejected" ? [`${d.id}: ${String((results[i] as PromiseRejectedResult).reason?.message ?? "")}`] : []));
    const items = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
    return { ok: failed.length < batch.length, items, detail: { series: batch.map((d) => d.id), failed } };
  },

  /** New filings and Form 4 insider trades for four companies per run. */
  async sec() {
    const { start } = await advance("sec", COVERAGE.length, 2);
    const batch = slice(COVERAGE, start, 2);
    const since = daysAgo(45);
    let filings = 0;
    let trades = 0;
    const errors: string[] = [];
    for (const c of batch) {
      try {
        const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)).json()) as {
          filings: { recent: Record<string, (string | number)[]> };
        };
        const r = sub.filings.recent;
        const rows = (r.accessionNumber as string[])
          .map((accn, i) => ({
            accn,
            ticker: c.ticker,
            cik: c.cik,
            form: String(r.form[i]),
            filed: String(r.filingDate[i]),
            report: (r.reportDate[i] as string) || null,
            doc: String(r.primaryDocument[i]),
            description: (r.primaryDocDescription[i] as string) || null,
            items: (r.items[i] as string) || null,
            ixbrl: !!r.isInlineXBRL[i],
            size: Number(r.size[i]) || null,
          }))
          .filter((f) => f.filed >= since && !/^(424B|FWP|SC 13|S-3)/.test(f.form));
        if (!rows.length) continue;
        const { data: known } = await supabaseAdmin.from("sec_filings").select("accn").in("accn", rows.map((f) => f.accn));
        const have = new Set((known ?? []).map((k) => k.accn));
        const fresh = rows.filter((f) => !have.has(f.accn));
        if (fresh.length) {
          const { error } = await supabaseAdmin.from("sec_filings").upsert(fresh);
          if (error) throw new Error(error.message);
          filings += fresh.length;
        }
        // Parse up to two new Form 4s per company per run; the rest are picked up on later passes.
        const { data: parsedAlready } = await supabaseAdmin.from("insider_trades").select("accn").eq("ticker", c.ticker).gte("filed", since);
        const done = new Set((parsedAlready ?? []).map((x) => x.accn));
        for (const f of rows.filter((x) => x.form === "4" && !done.has(x.accn)).slice(0, 2)) {
          const path = form4XmlPath(f.doc);
          const xml = await (await fetchSec(archiveUrl(c.cik, f.accn, path))).text();
          const parsed = parseForm4(xml, { accn: f.accn, filed: f.filed, report: f.report ?? undefined }, path);
          if (!parsed.length) {
            // Derivative-only filings carry no common-stock rows; record a marker so they aren't re-fetched.
            continue;
          }
          const { error } = await supabaseAdmin.from("insider_trades").upsert(
            parsed.map((t, seq) => ({
              accn: t.accn,
              seq,
              ticker: c.ticker,
              filed: t.filed,
              owner: t.owner,
              role: t.role,
              trade_date: t.date,
              code: t.code,
              security: t.security,
              shares: t.shares,
              price: t.price,
              acquired: t.acquired,
              owned_after: t.ownedAfter,
              direct: t.direct,
              plan_10b5: t.plan10b5,
              doc: t.doc,
            })),
          );
          if (error) throw new Error(error.message);
          trades += parsed.length;
        }
      } catch (e) {
        errors.push(`${c.ticker}: ${(e as Error).message}`);
      }
    }
    return { ok: errors.length < batch.length, items: filings + trades, detail: { companies: batch.map((c) => c.ticker), filings, trades, errors } };
  },

  /** Store new 8-K exhibits (releases, presentations, supplements) for one company per run. */
  async "ir-docs"() {
    const { start } = await advance("ir-docs", COVERAGE.length, 1);
    const { collectIr } = await import("@/lib/jobs/ir.server");
    const r = await collectIr(COVERAGE[start], "sec", 10);
    return { ok: true, items: r.stored, detail: r as unknown as Record<string, unknown> };
  },

  /** Store files hosted on one company's IR website per run (found with Firecrawl). */
  async "ir-site"() {
    const { start } = await advance("ir-site", COVERAGE.length, 1);
    const { collectIr } = await import("@/lib/jobs/ir.server");
    const r = await collectIr(COVERAGE[start], "site", 25);
    return { ok: true, items: r.stored, detail: r as unknown as Record<string, unknown> };
  },

  /** Mirror one recent 10-K/10-Q primary document into file storage per run. */
  async "filing-cache"() {
    const { start } = await advance("filing-cache", COVERAGE.length * 2, 1);
    const c = COVERAGE[Math.floor(start / 2)];
    const form = start % 2 === 0 ? "10-K" : "10-Q";
    const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)).json()) as {
      filings: { recent: { accessionNumber: string[]; form: string[]; primaryDocument: string[] } };
    };
    const r = sub.filings.recent;
    const i = r.form.findIndex((f) => f === form);
    if (i < 0) return { ok: true, items: 0, detail: { ticker: c.ticker, form, skipped: "no filing" } };
    const accn = r.accessionNumber[i];
    const doc = r.primaryDocument[i];
    const cached = await cacheFilingDocument(c.cik, accn, doc);
    return { ok: true, items: cached.stored ? 1 : 0, detail: { ticker: c.ticker, form, accn, doc, ...cached } };
  },
};

const BUCKET = "sec-filings";
const MAX_BYTES = 20 * 1024 * 1024;
const storagePath = (cik: string, accn: string, doc: string) => `${Number(cik)}/${accn}/${doc}.gz`;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Store an SEC document (gzip) in file storage unless it's already there. */
export async function cacheFilingDocument(cik: string, accn: string, doc: string, text?: string, contentType = "text/html") {
  const { data: have } = await supabaseAdmin.from("filing_documents").select("bytes").eq("accn", accn).eq("doc", doc).maybeSingle();
  if (have) return { stored: false, bytes: have.bytes, reason: "already cached" };
  let body = text;
  if (body == null) {
    const res = await fetchSec(archiveUrl(cik, accn, doc));
    contentType = res.headers.get("content-type") ?? contentType;
    body = await res.text();
  }
  if (body.length > MAX_BYTES) return { stored: false, bytes: body.length, reason: "too large" };
  const gz = await gzip(body);
  const path = storagePath(cik, accn, doc);
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, gz, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("filing_documents").upsert({ accn, doc, path, bytes: body.length, content_type: contentType });
  return { stored: true, bytes: body.length, compressed: gz.length };
}

/** Read a cached SEC document, or null when it isn't mirrored yet. */
export async function readCachedFiling(accn: string, doc: string): Promise<{ html: string; contentType: string } | null> {
  const { data: row } = await supabaseAdmin.from("filing_documents").select("path, content_type").eq("accn", accn).eq("doc", doc).maybeSingle();
  if (!row) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.path);
  if (error || !data) return null;
  return { html: await gunzip(await data.arrayBuffer()), contentType: row.content_type };
}
