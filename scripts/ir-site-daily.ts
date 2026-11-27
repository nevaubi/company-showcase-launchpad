/**
 * Scheduled IR-website collection (run by the Render worker loop): companies that reported in the
 * last 14 days first, then a rotation through everyone, within a hard daily Firecrawl credit cap
 * recorded in job_state (`ir-site-credits:<date>`). A 402 pauses cleanly (`ir-site` paused_reason)
 * and the next attempt is an hourly probe of one company.
 *   bun scripts/ir-site-daily.ts
 */
import { COVERAGE } from "@/lib/coverage";
import { reviewedCompanyDetails } from "@/lib/company/issuer-directory.server";
import { collectIr } from "@/lib/jobs/ir.server";
import { siteIsGuarded } from "@/lib/ir/source-guard";
import { firecrawlUsage } from "@/lib/web.server";
import { dbGate, log, sb } from "./lib/supa";
import { canSpend, IR_SITE_DAILY_CREDITS, IR_SITE_PAUSE_REASON, IR_SITE_PROBE_MS, irSiteOrder, isCreditError } from "./lib/ir-site-plan";

const now = () => new Date().toISOString();
const day = now().slice(0, 10);
const CREDITS = `ir-site-credits:${day}`;
async function get(job: string) {
  await dbGate("ir-site");
  const { data, error } = await sb.from("job_state").select("cursor, paused_reason, updated_at").eq("job", job).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
async function put(job: string, patch: { cursor?: number; paused_reason?: string | null }) {
  await dbGate("ir-site");
  const prev = await get(job);
  const { error } = await sb.from("job_state").upsert({ job, cursor: patch.cursor ?? prev?.cursor ?? 0, paused_reason: patch.paused_reason === undefined ? (prev?.paused_reason ?? null) : patch.paused_reason, updated_at: now() });
  if (error) throw new Error(error.message);
}

const pause = await get("ir-site-pause");
if ((pause?.cursor ?? 0) * 1000 > Date.now()) {
  log(`ir-site paused until ${new Date((pause!.cursor) * 1000).toISOString()}`);
  process.exit(0);
}
const probing = (await get("ir-site"))?.paused_reason === IR_SITE_PAUSE_REASON;
let used = (await get(CREDITS))?.cursor ?? 0;
const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
const { data: recent } = await sb.from("earnings_events").select("ticker, filed").gte("filed", since);
const { data: scans } = await sb.from("job_state").select("job, updated_at").like("job", "ir-site-seen:%");
const lastScan = new Map((scans ?? []).map((s) => [s.job.slice("ir-site-seen:".length), s.updated_at as string]));
const covered = new Set(COVERAGE.map((c) => c.ticker));
const rotationCursor = (await get("ir-site"))?.cursor ?? 0;
const order = irSiteOrder((recent ?? []).filter((r) => covered.has(r.ticker)), lastScan, COVERAGE.map((c) => c.ticker), rotationCursor);
const byTicker = new Map(COVERAGE.map((c) => [c.ticker, c]));
let stored = 0;
let companies = 0;
let rotated = 0;
for (const t of order) {
  if (!canSpend(used)) { log(`ir-site: daily cap reached (${used}/${IR_SITE_DAILY_CREDITS} credits)`); break; }
  const c = byTicker.get(t)!;
  // The site listed for this company is another company's (reviewed list, source-guard.ts): collecting it would store their files.
  if (siteIsGuarded(t, (await reviewedCompanyDetails(t, c.cik)).ir)) {
    log(`${t.padEnd(5)} site: skipped, the listed IR site is another company's`);
    if (!(recent ?? []).some((r) => r.ticker === t)) { rotated++; await put("ir-site", { cursor: (rotationCursor + rotated) % COVERAGE.length }); }
    continue;
  }
  const before = firecrawlUsage.calls;
  try {
    const r = await collectIr(c, "site", 25);
    stored += r.stored; companies++;
    log(`${t.padEnd(5)} site: ${r.stored} files stored (${firecrawlUsage.calls - before} credits)`);
    await put(`ir-site-seen:${t}`, { cursor: r.stored });
    if (probing && companies === 1) await put("ir-site", { paused_reason: null });
  } catch (e) {
    const msg = (e as Error).message;
    if (isCreditError(msg)) {
      used += firecrawlUsage.calls - before;
      await put(CREDITS, { cursor: used });
      await put("ir-site", { paused_reason: IR_SITE_PAUSE_REASON });
      await put("ir-site-pause", { cursor: Math.ceil((Date.now() + IR_SITE_PROBE_MS) / 1000) });
      log(`ir-site: ${msg.slice(0, 160)} — paused, probing hourly`);
      break;
    }
    log(`${t.padEnd(5)} site FAILED: ${msg.slice(0, 160)}`);
    await put(`ir-site-seen:${t}`, { cursor: 0 });
  }
  used += firecrawlUsage.calls - before;
  await put(CREDITS, { cursor: used });
  if (!(recent ?? []).some((r) => r.ticker === t)) { rotated++; await put("ir-site", { cursor: (rotationCursor + rotated) % COVERAGE.length }); }
}
log(`ir-site daily: ${stored} files from ${companies} companies; ${used}/${IR_SITE_DAILY_CREDITS} credits used today`);
