/**
 * Form 4 → `insider_trades` / `insider_buys`, shared by the `sec` walk (syncCompany, two per company
 * per visit) and the worker's repair pass (`repairForm4`, every Form 4 already in `sec_filings`).
 * A filing with no non-derivative transaction gets the durable receipt `form4-seen:<accn>` instead of
 * rows, so neither path fetches it again.
 */
import { form4XmlPath, parseForm4 } from "@/lib/financials/form4";
import { insiderBuyRows } from "@/lib/signals/events";
import { archiveUrl, fetchSec } from "@/lib/sec.server";
import { failReceipt, FORM4_FAIL_PREFIX, FORM4_FORMS, FORM4_MAX_TRIES, FORM4_REPAIR_KEY, FORM4_SEEN_PREFIX, form4Todo, isSecRefusal, parseRepairDay, repairReason, seenKey, type Form4Filing } from "./form4-repair";

type SbLike = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type FetchText = (url: string, opts: { deadline?: number }) => Promise<string>;

const secText: FetchText = async (url, opts) => (await fetchSec(url, { deadline: opts.deadline })).text();

/**
 * Read one Form 4 and store its non-derivative transactions (or its receipt when it has none).
 * Throws on a fetch, XML or write failure; nothing is receipted then.
 */
export async function storeForm4(sb: SbLike, f: Form4Filing, opts: { deadline?: number; fetchText?: FetchText } = {}): Promise<{ trades: number; empty: boolean }> {
  const path = form4XmlPath(f.doc);
  const xml = await (opts.fetchText ?? secText)(archiveUrl(f.cik, f.accn, path), { deadline: opts.deadline });
  // Do not receipt a malformed response as an empty/derivative-only filing.
  if (!/<ownershipDocument\b/i.test(xml) || !/<\/ownershipDocument>/i.test(xml)) throw new Error("Invalid ownership XML");
  const parsed = parseForm4(xml, { accn: f.accn, filed: f.filed, report: f.report ?? undefined }, path);
  if (!parsed.length) {
    const { error } = await sb.from("job_state").upsert({ job: seenKey(f.accn), cursor: 0, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { trades: 0, empty: true };
  }
  const { error } = await sb.from("insider_trades").upsert(
    parsed.map((t, seq) => ({
      accn: t.accn,
      seq,
      ticker: f.ticker,
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
  // Open-market purchases by officers/directors feed the insider-cluster strategy.
  const buys = insiderBuyRows(f.ticker, parsed.map((t) => ({ ...t, date: t.date })), "sec-form4");
  if (buys.length) {
    const { error: e2 } = await sb.from("insider_buys").upsert(buys, { onConflict: "accn,owner", ignoreDuplicates: true });
    if (e2) throw new Error(e2.message);
  }
  return { trades: parsed.length, empty: false };
}

export interface RepairResult {
  days: number;
  checked: number;
  stored: number;
  trades: number;
  empty: number;
  failed: number;
  gaveUp: number;
  /** day the cursor holds after this run */
  day: string | null;
  wrapped: boolean;
  stop: string | null;
}

/**
 * One bounded repair run: at most `maxFetch` Form 4 reads and `maxDays` filing days, never past
 * `deadline`, `paceMs` between SEC requests. Idempotent: every read re-checks trades and receipts, and
 * upserts are keyed (insider_trades accn+seq, insider_buys accn+owner, receipts by job).
 */
export async function repairForm4(
  sb: SbLike,
  o: { deadline: number; maxFetch?: number; maxDays?: number; floor: string; paceMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; fetchText?: FetchText; log?: (m: string) => void },
): Promise<RepairResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => undefined);
  const maxFetch = o.maxFetch ?? 400;
  const maxDays = o.maxDays ?? 30;
  const out: RepairResult = { days: 0, checked: 0, stored: 0, trades: 0, empty: 0, failed: 0, gaveUp: 0, day: null, wrapped: false, stop: null };
  const must = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const { data: cur } = await sb.from("job_state").select("paused_reason").eq("job", FORM4_REPAIR_KEY).maybeSingle();
  // The newest filing day, and the next earlier one with Form 4s.
  const dayAtOrBefore = async (day: string | null, strict: boolean): Promise<string | null> => {
    let q = sb.from("sec_filings").select("filed").in("form", [...FORM4_FORMS]).gte("filed", o.floor);
    if (day) q = strict ? q.lt("filed", day) : q.lte("filed", day);
    const rows = must<{ filed: string }[] | null>(await q.order("filed", { ascending: false }).limit(1));
    return rows?.[0]?.filed ?? null;
  };
  let day = await dayAtOrBefore(parseRepairDay(cur?.paused_reason), false);
  if (!day) {
    day = await dayAtOrBefore(null, false);
    out.wrapped = !!cur;
  }
  const save = async (d: string) => {
    const { error } = await sb.from("job_state").upsert({ job: FORM4_REPAIR_KEY, cursor: 0, paused_reason: repairReason(d), updated_at: new Date(now()).toISOString() });
    if (error) throw new Error(error.message);
  };
  let fetched = 0;
  /** newest day this run left with failures still under their try limit */
  let holdDay: string | null = null;
  while (day && out.days < maxDays && now() < o.deadline && !out.stop) {
    out.days++;
    const rows = must<Form4Filing[] | null>(await sb.from("sec_filings").select("accn, ticker, cik, filed, report, doc").in("form", [...FORM4_FORMS]).eq("filed", day).order("accn").limit(1000)) ?? [];
    const accns = rows.map((r) => r.accn);
    const traded = new Set<string>();
    const seen = new Set<string>();
    const fails = new Map<string, number>();
    for (let i = 0; i < accns.length; i += 200) {
      const part = accns.slice(i, i + 200);
      for (const r of must<{ accn: string }[] | null>(await sb.from("insider_trades").select("accn").in("accn", part)) ?? []) traded.add(r.accn);
      const keys = [...part.map(seenKey), ...part.map((a) => `${FORM4_FAIL_PREFIX}${a}`)];
      for (const r of must<{ job: string; cursor: number | null }[] | null>(await sb.from("job_state").select("job, cursor").in("job", keys)) ?? []) {
        if (r.job.startsWith(FORM4_SEEN_PREFIX)) seen.add(r.job.slice(FORM4_SEEN_PREFIX.length));
        else fails.set(r.job.slice(FORM4_FAIL_PREFIX.length), Number(r.cursor ?? 0));
      }
    }
    const todo = form4Todo(rows, traded, seen, fails);
    out.checked += rows.length;
    let left = todo.length;
    for (const f of todo) {
      if (fetched >= maxFetch || now() >= o.deadline) break;
      if (fetched) await sleep(o.paceMs ?? 150);
      fetched++;
      try {
        const r = await storeForm4(sb, f, { deadline: o.deadline, fetchText: o.fetchText });
        left--;
        if (r.empty) out.empty++;
        else {
          out.stored++;
          out.trades += r.trades;
        }
        if (fails.has(f.accn)) await sb.from("job_state").delete().eq("job", `${FORM4_FAIL_PREFIX}${f.accn}`);
      } catch (e) {
        const msg = (e as Error).message;
        if (isSecRefusal(e)) {
          // SEC is refusing requests: stop and keep the cursor on this day; nothing is charged.
          out.stop = `SEC refused (${msg.slice(0, 120)})`;
          break;
        }
        const rec = failReceipt(f.accn, fails.get(f.accn) ?? 0, msg, now());
        const { error } = await sb.from("job_state").upsert(rec);
        if (error) {
          out.stop = `failure receipt not written: ${error.message}`;
          break;
        }
        out.failed++;
        if (rec.cursor >= FORM4_MAX_TRIES) {
          out.gaveUp++;
          left--;
        }
        log(`${f.ticker} ${f.accn}: ${msg.slice(0, 160)}`);
      }
    }
    if (out.stop || fetched >= maxFetch || now() >= o.deadline) {
      // Out of budget or refused with work left on this day: the next run starts here (or at an
      // earlier-held newer day).
      if (left > 0 || out.stop) break;
    } else if (left > 0 && !holdDay) holdDay = day; // failures under their try limit: retried next run
    const prev = await dayAtOrBefore(day, true);
    if (!prev) {
      // Past the floor: the next run starts again at the newest day (or at a day still held).
      if (holdDay) await save(holdDay);
      else {
        const { error } = await sb.from("job_state").upsert({ job: FORM4_REPAIR_KEY, cursor: 0, paused_reason: null, updated_at: new Date(now()).toISOString() });
        if (error) throw new Error(error.message);
      }
      out.day = holdDay;
      out.wrapped = true;
      return out;
    }
    day = prev;
  }
  // The cursor never passes a newer day that still has work (a failure under its try limit).
  out.day = holdDay ?? day;
  if (out.day) await save(out.day);
  return out;
}
