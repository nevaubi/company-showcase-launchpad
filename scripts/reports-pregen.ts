// Keep standard reports ready before anyone asks: writes or refreshes shared primers / previews /
// recaps / IC memos whose data version moved (new 10-Q/10-K/earnings release, or a new week).
//
//   bun scripts/reports-pregen.ts [--kinds=primer,preview] [--tickers=AAPL,NVDA] [--max=40] [--concurrency=2] [--resume] [--dry]
//
// Bounded (--max per run), single-flight (lease in job_state), idempotent (fresh slots are skipped by
// ensureReport), circuit breaker (credit/permission errors pause the job; repeated rate limits stop it),
// paused guard (refuses to run while paused unless --resume).
import { args, log, sb, sleep } from "./lib/supa";
import { CURATED_COVERAGE } from "@/lib/coverage";
import { STALE_LOCK_MS, ensureReport } from "@/lib/reports/store.server";
import { loadReportInputs, loadDataset } from "@/lib/reports/inputs.server";
import { dataVersionOf } from "@/lib/reports/facts";
import { KIND_ORDER } from "@/lib/reports/kinds";
import type { ReportKind } from "@/lib/reports/types";

const JOB = "reports-pregen";
const kinds = (args.kinds?.split(",") ?? KIND_ORDER).filter((k): k is ReportKind => (KIND_ORDER as string[]).includes(k));
const tickers = args.tickers?.split(",").map((t) => t.trim().toUpperCase()) ?? CURATED_COVERAGE.map((c) => c.ticker);
const MAX = Number(args.max ?? 40);
const CONCURRENCY = Math.max(1, Math.min(4, Number(args.concurrency ?? 2)));
const dry = args.dry !== undefined;

async function main() {
  const { data: state } = await sb.from("job_state").select("*").eq("job", JOB).maybeSingle();
  if (state?.paused_reason && args.resume === undefined) { log(`${JOB} paused: ${state.paused_reason} — rerun with --resume once fixed`); return; }
  if (state?.lease_until && Date.parse(state.lease_until) > Date.now()) { log(`${JOB} already running (lease until ${state.lease_until})`); return; }
  const renew = () => sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + 3 * 60_000).toISOString(), updated_at: new Date().toISOString() });
  await renew();
  const lease = setInterval(() => { renew().then(({ error }) => error && log(`lease renewal failed: ${error.message}`)); }, 60_000);

  // Work list: slots that are missing or whose data version moved.
  const { data: rows } = await sb.from("reports").select("ticker, kind, status, data_version, started_at").eq("scope", "shared").eq("variant", "base");
  const have = new Map((rows ?? []).map((r) => [`${r.ticker}:${r.kind}`, r]));
  const today = new Date().toISOString().slice(0, 10);
  const todo: { ticker: string; kind: ReportKind }[] = [];
  for (const t of tickers) {
    let version: string | null = null;
    for (const k of kinds) {
      const r = have.get(`${t}:${k}`);
      // Skip slots another writer holds; a lock older than the stale window was abandoned and is retaken.
      if (r?.status === "generating" && r.started_at && Date.now() - Date.parse(r.started_at) < STALE_LOCK_MS) continue;
      if (r?.status === "ready") {
        version ??= await loadDataset(t).then((d) => dataVersionOf(d, today)).catch(() => null);
        if (!version || r.data_version === version) continue;
      }
      todo.push({ ticker: t, kind: k });
    }
    if (todo.length >= MAX) break;
  }
  const queue = todo.slice(0, MAX);
  log(`${JOB}: ${queue.length} report(s) to write${dry ? " (dry run)" : ""} — ${queue.map((q) => `${q.ticker}/${q.kind}`).join(", ")}`);
  if (dry || !queue.length) { clearInterval(lease); await sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: null, updated_at: new Date().toISOString() }); return; }

  let stop: string | null = null;
  let busy = 0, done = 0, failed = 0;
  const worker = async () => {
    while (!stop && queue.length) {
      const item = queue.shift()!;
      const t0 = Date.now();
      try {
        const row = await ensureReport(sb as never, {
          ticker: item.ticker, kind: item.kind, scope: "shared", firmId: null, firmName: null, userId: null,
          coverage: null, source: "pregen",
        }, () => loadReportInputs(item.ticker));
        if (row.error) {
          failed++;
          log(`✗ ${item.ticker}/${item.kind}: ${row.error}`);
          if (/credits are exhausted|permission|not enabled|denied/i.test(row.error)) stop = `AI access: ${row.error}`;
          else if (/busy|rate/i.test(row.error)) { busy++; if (busy >= 3) stop = "AI rate-limited repeatedly; try later"; await sleep(30_000); }
        } else {
          done++;
          log(`✓ ${item.ticker}/${item.kind} in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${row.title}`);
        }
      } catch (e) {
        failed++;
        const m = (e as Error).message;
        log(`✗ ${item.ticker}/${item.kind}: ${m}`);
        if (/writing limit/i.test(m)) stop = m;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(lease);
  const paused = stop && /AI access/.test(stop) ? stop : null;
  await sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: paused, lease_until: null, updated_at: new Date().toISOString() });
  log(stop ? `${JOB} STOPPED — ${stop} (${done} written, ${failed} failed)` : `${JOB} finished — ${done} written, ${failed} failed`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
