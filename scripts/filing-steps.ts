// Worker step: for each newly discovered 10-K/10-Q (sec_filings, cursor on discovered_at in job_state
// `filing-steps`) build the stored redline against the prior comparable filing, then refresh that
// company's supply-chain links (recent filings only). Weekly: supply intel for the 20 companies with the
// oldest signals. A failing filing gets a receipt `filing-steps-fail:<accn>` (attempts + error) and is
// retried on later runs up to MAX_ATTEMPTS; it never blocks the cursor.
//   bun scripts/filing-steps.ts [--max=30] [--no-supply] [--no-intel]
import { spawnSync } from "node:child_process";
import { args, dbGate, log, sb, sleep, selectAll } from "./lib/supa";
import { coverageOf, COVERAGE } from "@/lib/coverage";
import { buildRedline, compactRedline, defaultBase, REDLINE_VERSION, type FilingRef } from "@/lib/redline/core";
import { loadDataset } from "@/lib/reports/inputs.server";
import { cacheFilingDocument, readCachedFiling } from "@/lib/jobs/jobs.server";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import { BATCH, failKey, fromCursor, INTEL_EVERY_MS, oldestSignals, retryable, supplyTickers, toCursor, type NewFiling } from "./lib/filing-steps";

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
  const stored = await selectAll<FilingRef & { report: string | null }>((a, b) => sb.from("sec_filings").select("accn,doc,form,filed,report").eq("ticker", f.ticker).eq("form", form).range(a, b));
  const ds = await loadDataset(f.ticker).catch(() => null);
  const pool = new Map<string, FilingRef>();
  for (const x of [...(ds?.filings ?? []), ...stored]) if (x.doc && x.form === form) pool.set(x.accn, { accn: x.accn, doc: x.doc, form: x.form, filed: x.filed, report: (x as { report?: string | null }).report ?? undefined });
  const to: FilingRef = { accn: f.accn, doc: f.doc, form, filed: f.filed, report: f.report ?? undefined };
  const from = defaultBase([...pool.values()], to);
  if (!from) return "no prior comparable filing";
  const cik = String(Number(cov.cik));
  const r = compactRedline(buildRedline({ ticker: f.ticker, form, from, to, oldHtml: await html(cik, from), newHtml: await html(cik, to) }));
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

function script(file: string, argv: string[]): boolean {
  const r = spawnSync("bun", [file, ...argv], { stdio: "inherit", env: { ...process.env, IR_AI_PROVIDER: process.env.IR_AI_PROVIDER ?? "openai" }, timeout: 30 * 60_000 });
  return r.status === 0;
}

async function main() {
  await dbGate(JOB);
  const { data: st } = await sb.from("job_state").select("*").eq("job", JOB).maybeSingle();
  if (st?.lease_until && Date.parse(st.lease_until) > Date.now()) return log(`${JOB} already running`);
  const cursor = st?.cursor ?? toCursor("2026-11-01T00:00:00Z");
  await sb.from("job_state").upsert({ job: JOB, cursor, paused_reason: null, lease_until: new Date(Date.now() + 40 * 60_000).toISOString(), updated_at: now() });

  // Retries first (bounded), then new filings after the cursor.
  const fails = (await sb.from("job_state").select("job,cursor").like("job", "filing-steps-fail:%").gt("cursor", 0).lt("cursor", 5).limit(10)).data ?? [];
  const retryAccns = fails.map((r) => r.job.slice("filing-steps-fail:".length));
  const cols = "accn,ticker,form,filed,report,doc,discovered_at";
  const retry = retryAccns.length ? ((await sb.from("sec_filings").select(cols).in("accn", retryAccns)).data ?? []) as NewFiling[] : [];
  const fresh = ((await sb.from("sec_filings").select(cols).in("form", ["10-K", "10-Q"]).gt("discovered_at", fromCursor(cursor)).order("discovered_at").limit(MAX)).data ?? []) as NewFiling[];
  log(`${JOB}: ${fresh.length} new filing(s) since ${fromCursor(cursor)}, ${retry.length} retry`);

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
    if (fresh.includes(f)) next = Math.max(next, toCursor(f.discovered_at));
    await sb.from("job_state").update({ cursor: next, updated_at: now() }).eq("job", JOB);
  }

  if (!("no-supply" in args)) {
    for (const t of supplyTickers(done)) {
      const ok = script("scripts/supply-chain.ts", [`--only=${t}`, "--years=1", "--concurrency=1"]);
      log(`${ok ? "✓" : "✗"} supply links ${t}`);
    }
  }

  if (!("no-intel" in args)) {
    const { data: wk } = await sb.from("job_state").select("updated_at").eq("job", "supply-intel-weekly").maybeSingle();
    if (!wk || Date.now() - Date.parse(wk.updated_at) > INTEL_EVERY_MS) {
      const rows = await selectAll<{ ticker: string; created_at: string }>((a, b) => sb.from("supply_signals").select("ticker,created_at").order("created_at", { ascending: false }).range(a, b));
      const newest = new Map<string, string>();
      for (const r of rows) if (!newest.has(r.ticker)) newest.set(r.ticker, r.created_at);
      const pick = oldestSignals(COVERAGE.map((c) => c.ticker), newest);
      await sb.from("job_state").upsert({ job: "supply-intel-weekly", cursor: pick.length, paused_reason: null, updated_at: now() });
      const ok = script("scripts/supply-intel.ts", [`--only=${pick.join(",")}`, "--concurrency=2"]);
      log(`${ok ? "✓" : "✗"} weekly supply intel: ${pick.join(",")}`);
    }
  }
  await sb.from("job_state").update({ lease_until: null, updated_at: now() }).eq("job", JOB);
  await sb.from("job_runs").insert({ job: JOB, started_at: now(), finished_at: now(), ok: failed === 0, items: built, detail: { fresh: fresh.length, retry: retry.length, built, failed, cursor: fromCursor(next) } });
  log(`${JOB} finished — ${built} redline(s) built, ${failed} failed`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
