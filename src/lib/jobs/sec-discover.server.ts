// Market-wide filing discovery: one EDGAR list per run (current-filings feed for today, the daily
// master index for finished days), filtered to covered CIKs. Filings not yet in sec_filings are
// resolved through the company's submissions (full details, earnings events, alt rows), a few
// companies per run; 8-K item 2.02 events from the feed are stored immediately.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { COVERAGE, tickerByCik } from "@/lib/coverage";
import { fetchSec } from "@/lib/sec.server";
import { chunks, coveredOnly, dayProgress, feedUrl, FEED_TYPES, formatDayState, isEarnings, masterUrl, missingEarnings, nextDay, parseCurrentAtom, parseDayState, parseMasterIndex, repairWindow, rotate, type DiscoveredFiling } from "@/lib/jobs/sec-discover";

// Current and former CIKs: a filing by either registrant (XOM 2115436 or 34088) belongs to the company.
const CIKS = tickerByCik(COVERAGE);
const BY_TICKER = new Map(COVERAGE.map((c) => [c.ticker, c]));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Pause between companies, so SEC sees at most a few requests per second from any caller (limit 10/s). */
export const RESOLVE_PACE_MS = 150;

async function state(job: string) {
  const { data, error } = await supabaseAdmin.from("job_state").select("cursor, paused_reason").eq("job", job).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
async function put(job: string, cursor: number, paused_reason: string | null = null) {
  const { error } = await supabaseAdmin.from("job_state").upsert({ job, cursor, paused_reason, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
const dayCode = (d: string) => Number(d.replace(/-/g, ""));
const codeDay = (n: number) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

/** Covered filings in `rows` that sec_filings does not have yet. */
export async function missingFilings(rows: DiscoveredFiling[]) {
  const covered = coveredOnly(rows, CIKS);
  const have = new Set<string>();
  for (let i = 0; i < covered.length; i += 200) {
    const { data, error } = await supabaseAdmin.from("sec_filings").select("accn").in("accn", covered.slice(i, i + 200).map((r) => r.accn));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) have.add(r.accn);
  }
  return { covered, missing: covered.filter((r) => !have.has(r.accn)) };
}

/**
 * Store feed earnings events, then resolve missing companies through their submissions, one at a
 * time and paced, until `left()` says the budget is spent or `maxCompanies` were synced.
 * `deadline` (epoch ms) bounds every SEC request so a slow answer cannot outlive the run.
 */
export async function resolve(missing: (DiscoveredFiling & { ticker: string })[], left: () => boolean, maxCompanies: number, opts: { deadline?: number; order?: (tickers: string[]) => string[]; paceMs?: number } = {}) {
  const earn = missing.filter((r) => isEarnings(r.form, r.items)).map((r) => ({ ticker: r.ticker, accn: r.accn, filed: r.filed, source: "sec-8k-2.02" }));
  if (earn.length) {
    const { error } = await supabaseAdmin.from("earnings_events").upsert(earn, { onConflict: "ticker,accn", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { syncCompany } = await import("@/lib/jobs/jobs.server");
  const unique = [...new Set(missing.map((r) => r.ticker))];
  const tickers = opts.order ? opts.order(unique) : unique;
  const done: string[] = [];
  let filings = 0;
  let synced = 0;
  const errors: string[] = [];
  const cut: string[] = [];
  const pace = opts.paceMs ?? RESOLVE_PACE_MS;
  for (const t of tickers) {
    if (synced >= maxCompanies || !left()) break;
    if (synced > 0 && pace > 0) await new Promise((r) => setTimeout(r, pace));
    const r = await syncCompany(BY_TICKER.get(t)!, daysAgo(45), { form4: false, deadline: opts.deadline });
    synced++;
    filings += r.filings; errors.push(...r.errors);
    // A company the run's budget cut short is resolved again next run: reported as cut, not as an error.
    if (r.cut) cut.push(r.cut);
    else if (!r.errors.length) done.push(t);
  }
  return { earnings: earn.length, companies: tickers.length, resolved: done, filings, errors, ...(cut.length ? { cut, outcome: "cut" as const } : {}) };
}

/**
 * Bounded earnings repair: re-derive `earnings_events` from stored 8-K item 2.02 filings in one
 * five-day window per call (walking back 60 days, then wrapping), for filings whose event write
 * failed or was never made. Inserts only missing rows (idempotent).
 */
/** Pages of sec_filings one repair window may read (5,000 filings; the largest 5-day window held 721). */
const REPAIR_MAX_PAGES = 5;

export async function repairEarningsEvents(today = new Date().toISOString().slice(0, 10)) {
  const { data: st, error: stErr } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "earnings-repair").maybeSingle();
  if (stErr) throw new Error(stErr.message);
  const w = repairWindow(st?.cursor ?? 0, today);
  // Ordered and paged: an earnings-season window can hold more than one 1,000-row response.
  const list: { accn: string; ticker: string; form: string; filed: string; items: string | null }[] = [];
  for (let page = 0; page < REPAIR_MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("sec_filings")
      .select("accn, ticker, form, filed, items")
      .gte("filed", w.from)
      .lte("filed", w.to)
      .eq("form", "8-K")
      .like("items", "%2.02%")
      .order("accn")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    list.push(...((data ?? []) as typeof list));
    if ((data ?? []).length < 1000) break;
  }
  let inserted: { ticker: string; accn: string; filed: string; source: string }[] = [];
  if (list.length) {
    // Accession lists in chunks of 150 (about 3 KB of filter each), never one request of hundreds.
    const events: { ticker: string; accn: string }[] = [];
    for (const part of chunks(list.map((f) => f.accn), 150)) {
      const { data, error: evErr } = await supabaseAdmin.from("earnings_events").select("ticker, accn").in("accn", part);
      if (evErr) throw new Error(evErr.message);
      events.push(...((data ?? []) as { ticker: string; accn: string }[]));
    }
    inserted = missingEarnings(list, events);
    if (inserted.length) {
      const { error: upErr } = await supabaseAdmin.from("earnings_events").upsert(inserted, { onConflict: "ticker,accn", ignoreDuplicates: true });
      if (upErr) throw new Error(upErr.message);
    }
  }
  const { error: putErr } = await supabaseAdmin.from("job_state").upsert({ job: "earnings-repair", cursor: w.next, updated_at: new Date().toISOString() });
  if (putErr) throw new Error(putErr.message);
  return { window: `${w.from}..${w.to}`, checked: list.length, repaired: inserted.map((r) => `${r.ticker} ${r.accn}`) };
}

export async function runDiscovery(left: () => boolean, deadline?: number) {
  const rot = (await state("sec-discover"))?.cursor ?? 0;
  await put("sec-discover", rot + 1);
  // Two of three runs read the live feed (rotating form types); one verifies a finished day.
  if (rot % 3 !== 2) {
    const type = FEED_TYPES[(rot - Math.floor(rot / 3)) % FEED_TYPES.length];
    const rows = parseCurrentAtom(await (await fetchSec(feedUrl(type), { deadline })).text());
    const { covered, missing } = await missingFilings(rows);
    const r = await resolve(missing, left, Infinity, { deadline });
    return { ok: r.errors.length === 0, items: r.filings + r.earnings, detail: { source: `feed ${type}`, listed: rows.length, covered: covered.length, missing: missing.length, ...r } };
  }
  const dayState = await state("sec-discover-day");
  const day = dayState?.cursor ? codeDay(dayState.cursor) : daysAgo(7);
  const today = new Date().toISOString().slice(0, 10);
  if (day >= today) {
    // Nothing to verify until tomorrow's index: spend the idle run on the earnings repair window.
    const repair = await repairEarningsEvents(today);
    return { ok: true, items: repair.repaired.length, detail: { source: "day", note: `waiting for the ${day} daily index`, repair } };
  }
  const res = await fetchSec(masterUrl(day), { deadline, tries: 2 }).catch((e: Error & { status?: number }) => {
    // Weekend/holiday (no file) for a past day; the day before today may simply not be posted yet.
    if (e.status === 404 || e.status === 403) return null;
    throw new Error(`daily index ${day}: ${e.message}`);
  });
  if (!res) {
    if (day < daysAgo(1)) await put("sec-discover-day", dayCode(nextDay(day)));
    return { ok: true, items: 0, detail: { source: `day ${day}`, note: "no daily index" } };
  }
  const rows = parseMasterIndex(await res.text());
  const { covered, missing } = await missingFilings(rows);
  const prev = parseDayState(dayState?.paused_reason);
  // Resolve until the budget is spent; start each run further along the list.
  const r = await resolve(missing, left, Infinity, { deadline, order: (t) => rotate(t, (prev.day === day ? prev.run : 0) * 3) });
  const decision = dayProgress(prev, day, r.companies, r.resolved.length);
  if (decision.kind === "next") await put("sec-discover-day", dayCode(nextDay(day)), decision.reason);
  else await put("sec-discover-day", dayCode(day), formatDayState(decision.state));
  const tries = decision.kind === "stay" ? decision.state.tries : null;
  return { ok: r.errors.length === 0, items: r.filings + r.earnings, detail: { source: `day ${day}`, listed: rows.length, covered: covered.length, missing: missing.length, tries, complete: decision.kind === "next" && decision.complete, ...r } };
}
