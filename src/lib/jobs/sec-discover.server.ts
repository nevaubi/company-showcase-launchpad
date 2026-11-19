// Market-wide filing discovery: one EDGAR list per run (current-filings feed for today, the daily
// master index for finished days), filtered to covered CIKs. Filings not yet in sec_filings are
// resolved through the company's submissions (full details, earnings events, alt rows), a few
// companies per run; 8-K item 2.02 events from the feed are stored immediately.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { COVERAGE } from "@/lib/coverage";
import { fetchSec } from "@/lib/sec.server";
import { coveredOnly, feedUrl, FEED_TYPES, isEarnings, masterUrl, nextDay, parseCurrentAtom, parseMasterIndex, type DiscoveredFiling } from "@/lib/jobs/sec-discover";

const CIKS = new Map<string, string>();
for (const c of COVERAGE) if (!CIKS.has(String(Number(c.cik)))) CIKS.set(String(Number(c.cik)), c.ticker);
const BY_TICKER = new Map(COVERAGE.map((c) => [c.ticker, c]));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Give up on a finished day's stragglers after this many runs (recorded), so one bad filer never blocks. */
export const DAY_MAX_TRIES = 20;

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

/** Store feed earnings events, then resolve missing companies through their submissions. */
export async function resolve(missing: (DiscoveredFiling & { ticker: string })[], left: () => boolean, maxCompanies: number) {
  const earn = missing.filter((r) => isEarnings(r.form, r.items)).map((r) => ({ ticker: r.ticker, accn: r.accn, filed: r.filed, source: "sec-8k-2.02" }));
  if (earn.length) {
    const { error } = await supabaseAdmin.from("earnings_events").upsert(earn, { onConflict: "ticker,accn", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { syncCompany } = await import("@/lib/jobs/jobs.server");
  const tickers = [...new Set(missing.map((r) => r.ticker))];
  const done: string[] = [];
  let filings = 0;
  const errors: string[] = [];
  for (const t of tickers.slice(0, maxCompanies)) {
    if (!left()) break;
    const r = await syncCompany(BY_TICKER.get(t)!, daysAgo(45), { form4: false });
    filings += r.filings; errors.push(...r.errors);
    if (!r.errors.length) done.push(t);
  }
  return { earnings: earn.length, companies: tickers.length, resolved: done, filings, errors };
}

export async function runDiscovery(left: () => boolean) {
  const rot = (await state("sec-discover"))?.cursor ?? 0;
  await put("sec-discover", rot + 1);
  // Two of three runs read the live feed (rotating form types); one verifies a finished day.
  if (rot % 3 !== 2) {
    const type = FEED_TYPES[(rot - Math.floor(rot / 3)) % FEED_TYPES.length];
    const rows = parseCurrentAtom(await (await fetchSec(feedUrl(type))).text());
    const { covered, missing } = await missingFilings(rows);
    const r = await resolve(missing, left, 2);
    return { ok: r.errors.length === 0, items: r.filings + r.earnings, detail: { source: `feed ${type}`, listed: rows.length, covered: covered.length, missing: missing.length, ...r } };
  }
  const dayState = await state("sec-discover-day");
  const day = dayState?.cursor ? codeDay(dayState.cursor) : daysAgo(7);
  const today = new Date().toISOString().slice(0, 10);
  if (day >= today) return { ok: true, items: 0, detail: { source: "day", note: `waiting for the ${day} daily index` } };
  const res = await fetch(masterUrl(day), { headers: { "User-Agent": "FiledUnder Research research@filedunder.ai" } });
  if (res.status === 404 || res.status === 403) {
    // Weekend/holiday (no file) for a past day; the day before today may simply not be posted yet.
    if (day < daysAgo(1)) await put("sec-discover-day", dayCode(nextDay(day)));
    return { ok: true, items: 0, detail: { source: `day ${day}`, note: "no daily index" } };
  }
  if (!res.ok) throw new Error(`daily index ${day}: HTTP ${res.status}`);
  const rows = parseMasterIndex(await res.text());
  const { covered, missing } = await missingFilings(rows);
  const r = await resolve(missing, left, 2);
  const tries = Number(dayState?.paused_reason?.match(/^tries (\d+)/)?.[1] ?? 0) + 1;
  const complete = r.resolved.length === r.companies;
  if (complete || tries >= DAY_MAX_TRIES) await put("sec-discover-day", dayCode(nextDay(day)), complete ? null : `gave up on ${day}: ${r.companies - r.resolved.length} companies unresolved`);
  else await put("sec-discover-day", dayCode(day), `tries ${tries} on ${day}`);
  return { ok: r.errors.length === 0, items: r.filings + r.earnings, detail: { source: `day ${day}`, listed: rows.length, covered: covered.length, missing: missing.length, tries, ...r } };
}
