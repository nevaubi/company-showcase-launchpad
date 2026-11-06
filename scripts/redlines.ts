// Precompute filing redlines: latest 10-K vs the prior 10-K and latest 10-Q vs the same quarter a
// year earlier (plus --history earlier pairs), stored in filing_redlines for instant viewing.
//
//   bun scripts/redlines.ts [--tickers=NVDA,AAPL] [--forms=10-K,10-Q] [--history=1] [--max=200] [--concurrency=3] [--force]
//
// Bounded (--max pairs), single-flight (lease in job_state), idempotent (existing pair+version skipped),
// stops on SEC access errors (403) so it never hammers EDGAR.
import { args, log, sb, sleep } from "./lib/supa";
import { CURATED_COVERAGE, coverageOf } from "@/lib/coverage";
import { buildRedline, compactRedline, defaultBase, REDLINE_VERSION, type FilingRef } from "@/lib/redline/core";
import { loadDataset } from "@/lib/reports/inputs.server";
import { cacheFilingDocument, readCachedFiling } from "@/lib/jobs/jobs.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";

const JOB = "redlines";
const tickers = args.tickers?.split(",").map((t) => t.trim().toUpperCase()) ?? CURATED_COVERAGE.map((c) => c.ticker);
const forms = (args.forms?.split(",") ?? ["10-K", "10-Q"]).filter((f): f is "10-K" | "10-Q" => f === "10-K" || f === "10-Q");
const HISTORY = Math.max(1, Number(args.history ?? 1));
const MAX = Number(args.max ?? 200);
const CONCURRENCY = Math.max(1, Math.min(4, Number(args.concurrency ?? 3)));
const force = args.force !== undefined;

async function html(cik: string, f: FilingRef): Promise<string> {
  const cached = await readCachedFiling(f.accn, f.doc).catch(() => null);
  if (cached) return cached.html;
  const res = await fetchSec(archiveUrl(cik, f.accn, f.doc));
  const text = await res.text();
  await cacheFilingDocument(cik, f.accn, f.doc, text, res.headers.get("content-type") ?? "text/html").catch(() => undefined);
  await sleep(150);
  return text;
}

async function main() {
  const { data: state } = await sb.from("job_state").select("*").eq("job", JOB).maybeSingle();
  if (state?.lease_until && Date.parse(state.lease_until) > Date.now()) { log(`${JOB} already running`); return; }
  const renew = () => sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + 3 * 60_000).toISOString(), updated_at: new Date().toISOString() });
  await renew();
  const lease = setInterval(() => { renew().then(({ error }) => error && log(`lease renewal failed: ${error.message}`)); }, 60_000);

  const work: { ticker: string; cik: string; form: "10-K" | "10-Q"; from: FilingRef; to: FilingRef }[] = [];
  for (const t of tickers) {
    const cov = coverageOf(t);
    if (!cov) continue;
    const d = await loadDataset(t).catch(() => null);
    if (!d) { log(`skip ${t}: no dataset`); continue; }
    for (const form of forms) {
      const list = d.filings.filter((f) => f.form === form && f.doc).sort((a, b) => b.filed.localeCompare(a.filed));
      for (const to of list.slice(0, HISTORY)) {
        const from = defaultBase(d.filings.filter((f) => f.doc), to);
        if (from) work.push({ ticker: t, cik: String(Number(cov.cik)), form, from, to });
      }
    }
  }
  const existing = new Set<string>();
  for (let i = 0; i < work.length; i += 200) {
    const { data } = await sb.from("filing_redlines").select("from_accn, to_accn").eq("version", REDLINE_VERSION).in("to_accn", work.slice(i, i + 200).map((w) => w.to.accn));
    for (const r of data ?? []) existing.add(`${r.from_accn}:${r.to_accn}`);
  }
  const queue = work.filter((w) => force || !existing.has(`${w.from.accn}:${w.to.accn}`)).slice(0, MAX);
  log(`${JOB}: ${queue.length} comparison(s) to build (${work.length - queue.length} already stored or over the cap)`);

  let stop: string | null = null, done = 0, failed = 0;
  const worker = async () => {
    while (!stop && queue.length) {
      const w = queue.shift()!;
      try {
        const [oldHtml, newHtml] = [await html(w.cik, w.from), await html(w.cik, w.to)];
        const r = compactRedline(buildRedline({ ticker: w.ticker, form: w.form, from: w.from, to: w.to, oldHtml, newHtml }));
        const found = r.sections.filter((s) => s.found === "both").length;
        if (!found) { failed++; log(`✗ ${w.ticker} ${w.form} ${w.to.filed}: no comparable sections found`); continue; }
        const high = r.changes.filter((c) => c.level === "high").length, medium = r.changes.filter((c) => c.level === "medium").length;
        const { error } = await sb.from("filing_redlines").upsert({
          ticker: w.ticker, form: w.form, from_accn: w.from.accn, to_accn: w.to.accn, to_filed: w.to.filed, version: REDLINE_VERSION,
          stats: r.sections as never, high, medium, payload: r as never, summary: null,
        }, { onConflict: "from_accn,to_accn,version" });
        if (error) throw new Error(error.message);
        done++;
        log(`✓ ${w.ticker} ${w.form} ${w.from.filed} → ${w.to.filed}: ${r.changes.length} changes (${high} high, ${medium} medium) in ${found} sections`);
      } catch (e) {
        failed++;
        const m = (e as Error).message;
        log(`✗ ${w.ticker} ${w.form} ${w.to.filed}: ${m}`);
        if (/responded 403/.test(m)) stop = "SEC refused requests (403); try again later";
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(lease);
  await sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: null, updated_at: new Date().toISOString() });
  log(stop ? `${JOB} STOPPED — ${stop} (${done} built, ${failed} failed)` : `${JOB} finished — ${done} built, ${failed} failed`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
