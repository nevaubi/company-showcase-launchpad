// Point-in-time event features for the setup engine: earnings announcements (SEC 8-K item 2.02),
// open-market insider purchases (Form 4 code P), FINRA daily short-sale volume and SEC
// fails-to-deliver. Every value at bar i uses only events public on or before dates[i]. Pure;
// shared by the script and the job.
import type { Features } from "./features";

export interface InsiderBuy {
  filed: string;
  owner: string;
  value: number;
  plan: boolean;
}

export interface TickerEvents {
  /** 8-K item 2.02 filing dates, any order. */
  earnings: string[];
  buys: InsiderBuy[];
  /** Daily short-sale volume ratio (short / total reported volume). */
  short: { date: string; ratio: number }[];
  /** SEC fails-to-deliver per half-month: period end date and average daily fails balance in USD. */
  fails?: { end: string; value: number }[];
}

export interface EventFeatures {
  /** On the bar after an announcement bar t: 3-day return (t-1..t+1) net of the benchmark, in standard deviations. */
  earnZ: Float64Array;
  earnRet: Float64Array;
  /** Trading days until the expected next announcement (same quarter last year + 52 weeks). */
  earnAhead: Float64Array;
  /** On a bar where a purchase filing lands: distinct insiders buying in the trailing 30 days. */
  buyers30: Float64Array;
  buyValue30: Float64Array;
  /** 5-day mean short ratio vs the prior 60 days of 5-day means, in standard deviations. */
  shortZ: Float64Array;
  shortRatio5: Float64Array;
  /** Latest published fails-to-deliver reading ÷ 20-day average dollar volume. */
  failsDV: Float64Array;
  /** Latest published reading ÷ median of the 12 half-months before it (missing half-months count as zero). */
  failsX: Float64Array;
  /** 1 on the bar a new fails reading becomes public. */
  failsNew: Float64Array;
}

/**
 * `failsLagDays`: the SEC posts each half-month's file about two weeks after it ends; readings are
 * used only from period end + this many calendar days, so the backtest never sees a file early.
 */
export const EVENT_RULES = { minBuy: 25_000, buyWindowDays: 30, shortBase: 60, aheadBars: 5, failsLagDays: 16, failsBase: 12 };

/** Half-month slot number for a period end date (…-15 → first half, otherwise second half). */
const halfSlot = (end: string) => Number(end.slice(0, 4)) * 24 + (Number(end.slice(5, 7)) - 1) * 2 + (Number(end.slice(8, 10)) <= 15 ? 0 : 1);

const dayMs = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * dayMs).toISOString().slice(0, 10);

/** Index of the first calendar date >= d (dates.length when beyond the calendar). */
export function indexOnOrAfter(dates: string[], d: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] < d) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Weekdays strictly after `from` up to and including `to` (used past the end of the calendar). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(from + "T12:00:00Z") + dayMs; t <= Date.parse(to + "T12:00:00Z"); t += dayMs) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** Expected date of the next announcement given those already made (sorted ascending). */
export function expectedNext(past: string[]): string | null {
  const k = past.length;
  if (!k) return null;
  const last = past[k - 1];
  const guess = k >= 4 ? addDays(past[k - 4], 364) : addDays(last, 91);
  // A "same quarter last year" date too close to the latest one means the history has gaps.
  return Date.parse(guess) - Date.parse(last) >= 45 * dayMs ? guess : addDays(last, 91);
}

export function eventFeatures(dates: string[], f: Features, bench: ArrayLike<number>, ev: TickerEvents): EventFeatures {
  const n = dates.length;
  const nan = () => new Float64Array(n).fill(NaN);
  const earnZ = nan(), earnRet = nan(), earnAhead = nan(), shortZ = nan(), shortRatio5 = nan(), failsDV = nan(), failsX = nan();
  const failsNew = new Float64Array(n);
  const buyers30 = new Float64Array(n), buyValue30 = new Float64Array(n);
  const c = f.a.c, s = Math.max(f.a.start, 0);

  // ---- earnings announcement return
  const ann = [...new Set(ev.earnings)].sort();
  for (const d of ann) {
    const t = indexOnOrAfter(dates, d);
    if (t - 2 < s + 60 || t + 1 >= n) continue;
    const r = c[t + 1] / c[t - 2] - 1;
    const rb = bench[t + 1] / bench[t - 2] - 1;
    const v = f.vol60[t - 2];
    if (!Number.isFinite(r) || !Number.isFinite(rb) || !(v > 0)) continue;
    earnRet[t + 1] = r - rb;
    earnZ[t + 1] = (r - rb) / (v * Math.sqrt(3));
  }

  // ---- expected next announcement
  if (ann.length) {
    let k = 0; // announcements on or before dates[i]
    for (let i = s; i < n; i++) {
      while (k < ann.length && ann[k] <= dates[i]) k++;
      const next = expectedNext(ann.slice(0, k));
      if (!next || next <= dates[i]) continue;
      const j = indexOnOrAfter(dates, next);
      earnAhead[i] = j < n ? j - i : n - 1 - i + weekdaysBetween(dates[n - 1], next);
    }
  }

  // ---- insider purchase clusters
  const buys = ev.buys.filter((b) => !b.plan && b.value >= EVENT_RULES.minBuy).sort((a, b) => (a.filed < b.filed ? -1 : 1));
  for (let k = 0; k < buys.length; k++) {
    const t = indexOnOrAfter(dates, buys[k].filed);
    if (t >= n || t < s) continue;
    const lo = addDays(buys[k].filed, -EVENT_RULES.buyWindowDays);
    const owners = new Set<string>();
    let value = 0;
    for (let j = k; j >= 0 && buys[j].filed > lo; j--) {
      owners.add(buys[j].owner.toLowerCase());
      value += buys[j].value;
    }
    for (let j = k + 1; j < buys.length && buys[j].filed === buys[k].filed; j++) {
      owners.add(buys[j].owner.toLowerCase());
      value += buys[j].value;
    }
    if (owners.size > buyers30[t]) {
      buyers30[t] = owners.size;
      buyValue30[t] = value;
    }
  }

  // ---- abnormal short-selling flow
  if (ev.short.length) {
    const ratio = nan();
    for (const r of ev.short) {
      const t = indexOnOrAfter(dates, r.date);
      if (t < n && dates[t] === r.date && r.ratio >= 0 && r.ratio <= 1) ratio[t] = r.ratio;
    }
    const m5 = nan();
    for (let i = 4; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let k = 0; k < 5; k++) if (Number.isFinite(ratio[i - k])) (sum += ratio[i - k]), cnt++;
      if (cnt >= 4) m5[i] = sum / cnt;
    }
    const B = EVENT_RULES.shortBase;
    for (let i = B + 5; i < n; i++) {
      if (!Number.isFinite(m5[i])) continue;
      let sum = 0, sum2 = 0, cnt = 0;
      for (let j = i - 5 - B; j < i - 5; j++) {
        const v = m5[j];
        if (!Number.isFinite(v)) continue;
        sum += v;
        sum2 += v * v;
        cnt++;
      }
      if (cnt < 40) continue;
      const mu = sum / cnt, sd = Math.sqrt(Math.max((sum2 - (sum * sum) / cnt) / (cnt - 1), 0));
      shortRatio5[i] = m5[i];
      if (sd > 1e-4) shortZ[i] = (m5[i] - mu) / sd;
    }
  }

  // ---- fails to deliver (published with a lag; absent half-months had no reportable fails)
  if (ev.fails?.length) {
    const bySlot = new Map<number, number>();
    for (const r of ev.fails) if (r.value >= 0) bySlot.set(halfSlot(r.end), r.value);
    const readings = [...ev.fails].sort((a, b) => (a.end < b.end ? -1 : 1));
    const first = halfSlot(readings[0].end);
    let k = -1; // last reading public by dates[i]
    for (let i = s; i < n; i++) {
      let moved = false;
      while (k + 1 < readings.length && addDays(readings[k + 1].end, EVENT_RULES.failsLagDays) <= dates[i]) (k++, (moved = true));
      if (k < 0) continue;
      const r = readings[k];
      // stale: the latest public file has no row for this stock, so its fails fell below reporting
      if (addDays(r.end, EVENT_RULES.failsLagDays + 20) < dates[i]) continue;
      const dv = f.dv20[i];
      if (dv > 0) failsDV[i] = r.value / dv;
      const slot = halfSlot(r.end);
      const B = EVENT_RULES.failsBase;
      if (slot - B >= first) {
        const base: number[] = [];
        for (let j = slot - B; j < slot; j++) base.push(bySlot.get(j) ?? 0);
        base.sort((a, b) => a - b);
        const med = (base[B / 2 - 1] + base[B / 2]) / 2;
        failsX[i] = med > 0 ? r.value / med : r.value > 0 ? Infinity : NaN;
      }
      if (moved) failsNew[i] = 1;
    }
  }

  return { earnZ, earnRet, earnAhead, buyers30, buyValue30, shortZ, shortRatio5, failsDV, failsX, failsNew };
}

export interface InsiderBuyRow {
  ticker: string;
  accn: string;
  owner: string;
  role: string | null;
  is_officer: boolean;
  is_director: boolean;
  trade_date: string | null;
  filed: string;
  shares: number;
  value: number;
  plan_10b5: boolean;
  source: string;
}

const OFFICER = /officer|chief|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|president|\bvp\b|vice pres|\bevp\b|\bsvp\b|treasurer|secretary|controller|general counsel/i;

/** Open-market purchases (code P, acquired) by officers or directors, one row per filing and owner. */
export function insiderBuyRows(
  ticker: string,
  trades: { accn: string; filed: string; owner: string; role: string | null; date: string | null; code: string; shares: number | null; price: number | null; acquired: boolean; plan10b5?: boolean | null }[],
  source = "sec-form4",
): InsiderBuyRow[] {
  const by = new Map<string, InsiderBuyRow>();
  for (const t of trades) {
    if (t.code !== "P" || !t.acquired || !((t.shares ?? 0) > 0)) continue;
    const role = t.role ?? "";
    const officer = OFFICER.test(role), director = /director/i.test(role);
    if (!officer && !director) continue;
    const k = `${t.accn}|${t.owner}`;
    const r = by.get(k) ?? { ticker, accn: t.accn, owner: t.owner.slice(0, 200), role: role.slice(0, 120) || null, is_officer: officer, is_director: director, trade_date: null, filed: t.filed, shares: 0, value: 0, plan_10b5: !!t.plan10b5, source };
    r.shares += t.shares!;
    r.value += (t.price ?? 0) > 0 ? t.shares! * t.price! : 0;
    if (t.date && (!r.trade_date || t.date > r.trade_date)) r.trade_date = t.date;
    r.plan_10b5 ||= !!t.plan10b5;
    by.set(k, r);
  }
  return [...by.values()].map((r) => ({ ...r, value: Math.round(r.value) }));
}
