// Worker step: for each newly discovered 10-K/10-Q (sec_filings, cursor on discovered_at in job_state
// `filing-steps`) build the stored redline against the prior comparable filing, then refresh that
// company's supply-chain links (recent filings only). Weekly: supply intel for the 20 companies with the
// oldest signals. A failing filing gets a receipt `filing-steps-fail:<accn>` (attempts + error) and is
// retried on later runs up to MAX_ATTEMPTS; it never blocks the cursor. The cursor is (second, accession)
// so any number of filings sharing one second make progress. The weekly intel marker advances only
// after signals were stored (or every stage ran clean and found nothing); otherwise it retries.
//   bun scripts/filing-steps.ts [--max=30] [--no-supply] [--no-intel]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { routeDecision, routeOf } from "@/lib/jobs/provider-health";
import { providerStates } from "@/lib/jobs/provider-health.server";
import { IR_MODELS } from "@/lib/openai.server";
import { loadRank } from "./lib/rank";
import { args, dbGate, log, sb, sleep, selectAll } from "./lib/supa";
import { coverageOf, COVERAGE } from "@/lib/coverage";
import { buildRedline, compactRedline, defaultBase, REDLINE_VERSION, type FilingRef } from "@/lib/redline/core";
import { loadDataset } from "@/lib/reports/inputs.server";
import { cacheFilingDocument, readCachedFiling } from "@/lib/jobs/jobs.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import { accnOf, accnReason, ACCN_KEY, afterCursor, BATCH, completeSeconds, failKey, fromCursor, INTEL_EVERY_MS, INTEL_KEY, intelMarker, nextCursor, oldestSignals, retryable, supplyTickers, toCursor, type IntelResult, type NewFiling, type StepCursor } from "./lib/filing-steps";

const JOB = "filing-steps";
const MAX = Number(args.max ?? BATCH);
const now = () => new Date().toISOString();

async function html(cik: string, f: FilingRef): Promise<string> {
  const cached = await readCachedFiling(f.accn, f.doc).catch(() => null);
  if (cached) return cached.html;
  const res = await fetchSec(archiveUrl(cik, f.accn, f.doc));
  const text = await res.text();
  await cacheFilingDocument(cik, f.accn, f.doc, text, res.headers.get("content-type") ?? "text/html").catch(() => undefined);
  await sleep(150);
  return text;
}

/** Returns a note when no redline can exist (first filing of its kind), throws on real failures. */
async function redline(f: NewFiling): Promise<string> {
  const cov = coverageOf(f.ticker);
  if (!cov) return "not covered";
  const form = f.form.replace("/A", "") as "10-K" | "10-Q";
  const have = await sb.from("filing_redlines").select("id").eq("to_accn", f.accn).eq("version", REDLINE_VERSION).limit(1);
  if (have.data?.length) return "already stored";
  const stored = await selectAll<FilingRef & { report: string | null; cik: string | null }>((a, b) => sb.from("sec_filings").select("accn,doc,form,filed,report,cik").eq("ticker", f.ticker).eq("form", form).range(a, b));
  const ds = await loadDataset(f.ticker).catch(() => null);
  const pool = new Map<string, FilingRef>();
  // Each filing's archive CIK: the index that listed it (sec_filings.cik, the dataset's own CIK);
  // a company that changed registrant has filings under both (XOM 34088 and 2115436).
  const cikOf = new Map<string, string>();
  for (const x of ds?.filings ?? []) if (ds?.profile.cik) cikOf.set(x.accn, ds.profile.cik);
  for (const x of stored) if (x.cik) cikOf.set(x.accn, x.cik);
  for (const x of [...(ds?.filings ?? []), ...stored]) if (x.doc && x.form === form) pool.set(x.accn, { accn: x.accn, doc: x.doc, form: x.form, filed: x.filed, report: (x as { report?: string | null }).report ?? undefined });
  const to: FilingRef = { accn: f.accn, doc: f.doc, form, filed: f.filed, report: f.report ?? undefined };
  const from = defaultBase([...pool.values()], to);
  if (!from) return "no prior comparable filing";
  const cikFor = (accn: string) => String(Number(cikOf.get(accn) ?? cov.cik));
  const r = compactRedline(buildRedline({ ticker: f.ticker, form, from, to, oldHtml: await html(cikFor(from.accn), from), newHtml: await html(cikFor(to.accn), to) }));
  const found = r.sections.filter((s) => s.found === "both").length;
  if (!found) throw new Error("no comparable sections found");
  const high = r.changes.filter((c) => c.level === "high").length, medium = r.changes.filter((c) => c.level === "medium").length;
  const { error } = await sb.from("filing_redlines").upsert({ ticker: f.ticker, form, from_accn: from.accn, to_accn: to.accn, to_filed: to.filed, version: REDLINE_VERSION, stats: r.sections as never, high, medium, payload: r as never, summary: null }, { onConflict: "from_accn,to_accn,version" });
  if (error) throw new Error(error.message);
  return `stored (${r.changes.length} changes)`;
}

async function receipt(accn: string, attempts: number, error: string | null) {
  await sb.from("job_state").upsert({ job: failKey(accn), cursor: attempts, paused_reason: error?.slice(0, 200) ?? null, updated_at: now() });
}

const INTEL_ENV = { ...process.env, IR_AI_PROVIDER: process.env.IR_AI_PROVIDER ?? "openai" };
function script(file: string, argv: string[]): number {
  const r = spawnSync("bun", [file, ...argv], { stdio: "inherit", env: INTEL_ENV, timeout: 30 * 60_000 });
  return r.status ?? 1;
}

/** New 10-K/10-Q filings after the cursor, every second in the batch complete (see completeSeconds). */
async function freshAfter(c: StepCursor): Promise<NewFiling[]> {
  const cols = "accn,ticker,form,filed,report,doc,discovered_at";
  const PAGE = 200;
  const page = ((await sb.from("sec_filings").select(cols).in("form", ["10-K", "10-Q"]).gte("discovered_at", fromCursor(c.sec)).order("discovered_at").order("accn").limit(PAGE)).data ?? []) as NewFiling[];
  const { rows, partialSec } = completeSeconds(page, PAGE);
  if (partialSec != null) {
    const whole = ((await sb.from("sec_filings").select(cols).in("form", ["10-K", "10-Q"]).gte("discovered_at", fromCursor(partialSec)).lt("discovered_at", fromCursor(partialSec + 1)).order("accn").limit(1000)).data ?? []) as NewFiling[];
    rows.push(...whole);
  }
  return afterCursor(rows, c).slice(0, MAX);
}

async function main() {
  await dbGate(JOB);
  const { data: st } = await sb.from("job_state").select("*").eq("job", JOB).maybeSingle();
  if (st?.lease_until && Date.parse(st.lease_until) > Date.now()) return log(`${JOB} already running`);
  const cursor = st?.cursor ?? toCursor("2026-11-01T00:00:00Z");
  const { data: accnRow } = await sb.from("job_state").select("paused_reason").eq("job", ACCN_KEY).maybeSingle();
  let at: StepCursor = { sec: cursor, accn: accnOf(accnRow?.paused_reason) };
  await sb.from("job_state").upsert({ job: JOB, cursor, paused_reason: null, lease_until: new Date(Date.now() + 40 * 60_000).toISOString(), updated_at: now() });

  // Retries first (bounded), then new filings after the cursor.
  const fails = (await sb.from("job_state").select("job,cursor").like("job", "filing-steps-fail:%").gt("cursor", 0).lt("cursor", 5).limit(10)).data ?? [];
  const retryAccns = fails.map((r) => r.job.slice("filing-steps-fail:".length));
  const cols = "accn,ticker,form,filed,report,doc,discovered_at";
  const retry = retryAccns.length ? ((await sb.from("sec_filings").select(cols).in("accn", retryAccns)).data ?? []) as NewFiling[] : [];
  const fresh = await freshAfter(at);
  log(`${JOB}: ${fresh.length} new filing(s) after ${fromCursor(at.sec)} ${at.accn || ""}, ${retry.length} retry`);

  const done: NewFiling[] = [];
  let built = 0, failed = 0, next = cursor;
  for (const f of [...retry, ...fresh]) {
    const attempts = fails.find((r) => r.job === failKey(f.accn))?.cursor ?? 0;
    try {
      const note = await redline(f);
      if (note.startsWith("stored")) built++;
      log(`✓ ${f.ticker} ${f.form} ${f.filed}: ${note}`);
      if (attempts) await receipt(f.accn, 0, null);
      done.push(f);
    } catch (e) {
      failed++;
      const m = (e as Error).message;
      log(`✗ ${f.ticker} ${f.form} ${f.filed}: ${m}`);
      await receipt(f.accn, retryable(attempts + 1) ? attempts + 1 : 99, m);
      if (/responded 403/.test(m)) { log("SEC refused requests; stopping this run"); break; }
    }
    if (fresh.includes(f)) {
      at = nextCursor(at, f);
      next = at.sec;
      await sb.from("job_state").upsert({ job: ACCN_KEY, cursor: at.sec, paused_reason: accnReason(at.accn), updated_at: now() });
    }
    await sb.from("job_state").update({ cursor: next, updated_at: now() }).eq("job", JOB);
  }

  if (!("no-supply" in args)) {
    for (const t of supplyTickers(done)) {
      const ok = script("scripts/supply-chain.ts", [`--only=${t}`, "--years=1", "--concurrency=1"]) === 0;
      log(`${ok ? "✓" : "✗"} supply links ${t}`);
    }
  }

  if (!("no-intel" in args)) await weeklyIntel();
  await sb.from("job_state").update({ lease_until: null, updated_at: now() }).eq("job", JOB);
  await sb.from("job_runs").insert({ job: JOB, started_at: now(), finished_at: now(), ok: failed === 0, items: built, detail: { fresh: fresh.length, retry: retry.length, built, failed, cursor: fromCursor(next) } });
  log(`${JOB} finished — ${built} redline(s) built, ${failed} failed`);
}
/** Weekly supply intel: the marker moves only after stored work (intelMarker); a run row records each try. */
async function weeklyIntel() {
  const { data: wk } = await sb.from("job_state").select("cursor, paused_reason, updated_at").eq("job", INTEL_KEY).maybeSingle();
  if (wk && Date.now() - Date.parse(wk.updated_at) <= INTEL_EVERY_MS) return;
  // A provider that is out of money or misconfigured: leave the marker due and try on a later run.
  const route = routeOf(IR_MODELS.reason, INTEL_ENV);
  try {
    const d = routeDecision(await providerStates(route), route, Date.now());
    if (d.state === "open") return log(`weekly supply intel waits: ${route.join("/")} closed (${d.cls}: ${(d.message ?? "").slice(0, 100)})`);
  } catch {
    /* unreadable circuit: try anyway */
  }
  const rows = await selectAll<{ ticker: string; created_at: string }>((a, b) => sb.from("supply_signals").select("ticker,created_at").order("created_at", { ascending: false }).range(a, b));
  const newest = new Map<string, string>();
  for (const r of rows) if (!newest.has(r.ticker)) newest.set(r.ticker, r.created_at);
  const pick = oldestSignals(COVERAGE.map((c) => c.ticker), newest, undefined, await loadRank());
  const resultFile = `/tmp/supply-intel-${process.pid}.json`;
  rmSync(resultFile, { force: true });
  const started = now();
  // Retry marker first (review F17): a deadline kill of this step during intel leaves the week due
  // after the retry backoff instead of at once; the result below overwrites it.
  const pre = intelMarker(null, wk ? { cursor: wk.cursor, paused_reason: wk.paused_reason } : null, Date.now(), "interrupted before supply intel finished");
  await sb.from("job_state").upsert({ job: INTEL_KEY, cursor: pre.cursor, paused_reason: pre.paused_reason, updated_at: pre.updated_at });
  const code = script("scripts/supply-intel.ts", [`--only=${pick.join(",")}`, "--concurrency=2", `--result-file=${resultFile}`]);
  let result: IntelResult | null = null;
  try {
    if (existsSync(resultFile)) result = JSON.parse(readFileSync(resultFile, "utf8")) as IntelResult;
  } catch {
    result = null;
  }
  const m = intelMarker(result, wk ? { cursor: wk.cursor, paused_reason: wk.paused_reason } : null, Date.now(), `no result file (exit ${code})`);
  await sb.from("job_state").upsert({ job: INTEL_KEY, cursor: m.cursor, paused_reason: m.paused_reason, updated_at: m.updated_at });
  await sb.from("job_runs").insert({ job: "supply-intel", started_at: started, finished_at: now(), ok: m.action === "advance", items: result?.stored ?? 0, detail: { tickers: pick, code, result, marker: m.action, reason: m.paused_reason } as never });
  log(`${m.action === "advance" ? "✓" : "✗"} weekly supply intel (${m.action}${m.paused_reason ? `: ${m.paused_reason}` : ""}): ${pick.join(",")}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
