// One company's alt data, turned into what the tab, the Overview snapshot and the assistant show:
// per dataset a few headline figures (each with the rows it came from), a chartable series, the
// rows for its table, and an unusual-change verdict against the company's own history. Pure.
//
// What the stored rows can support is decided once, in `history.ts`: a count over a window is
// shown only where the stored history covers that window (otherwise what is on file, labelled
// "since <day>"), the rise rule compares only windows collected the same way, and a reading for a
// period still running is never compared or tested.
import { DATASETS, THEMES, fmtAlt, fmtChange, fmtShare, type AltTheme } from "@/lib/alt/catalog";
import { addDays, daysBetween, quarterOnly, rangeVerdict, recency, revenueNear, riseVerdict, pLabel, trailingTwelveMonths, yearOnYear, type RevenuePoint } from "@/lib/alt/derive";
import { countSupport, dayLabel, rangeRulesOf, rowsOf, settled, trailingCount, wholeWindows, type CountSupport, type RangeRule, type TrailingCount } from "@/lib/alt/history";
import { isPartial, periodLabel } from "@/lib/alt/periods";

export interface CompanyAltRow {
  uid: string;
  ticker: string;
  dataset: string;
  kind: "event" | "series" | string;
  date: string | null;
  title: string;
  value: number | null;
  unit: string | null;
  // stored meta differs per dataset (same shape as AltRow.meta in query.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Record<string, any>;
  source: string;
  source_url: string | null;
}

export interface Figure {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
  /** the period or day the figure describes */
  asOf?: string;
  /** rows the figure was computed from (their source URLs are its evidence) */
  rows: CompanyAltRow[];
  /** a company revenue figure used in the calculation, with its filing */
  revenue?: RevenuePoint;
  /** how it was computed, in words */
  formula?: string;
  /** the amount behind `value`, for materiality checks (USD, count, pounds...) */
  num?: number;
}

export interface Flag {
  dataset: string;
  /** "rise": a count over 90 days against earlier whole windows; "range": a series reading against its own range */
  kind: "rise" | "range";
  direction: "up" | "down";
  /** "5 8-K filings in the last 90 days; at most 2 in any of the prior 8 windows" */
  text: string;
  /** how strong, within its kind only: −log10 p for a rise, the ratio to the range edge for a range reading */
  strength: number;
  date: string | null;
  rows: CompanyAltRow[];
  rule: string;
  /** the flagged reading itself, so a tile carrying the flag shows what the flag is about */
  figure: Figure;
  /** counts per whole 90-day window, oldest first (rise flags) */
  history?: number[];
}

export interface ChartPoint {
  label: string;
  value: number;
  partial: boolean;
  row: CompanyAltRow;
}

export interface DatasetView {
  dataset: string;
  label: string;
  source: string;
  theme: AltTheme;
  latest: string | null;
  count: number;
  figures: Figure[];
  chart?: { kind: "bar" | "line"; unit: string | null; title: string; points: ChartPoint[] };
  /** rows for the dataset's table, most telling first */
  table: CompanyAltRow[];
  flag?: Flag;
  rows: CompanyAltRow[];
  /** what the stored history covers, when it is less than the source holds */
  coverage?: string;
  /** nothing recent or material: the tab shows one quiet line instead of a panel */
  quiet?: string;
}

export interface CompanyAlt {
  views: DatasetView[];
  themes: { id: AltTheme; label: string; short: string; anchor: string; views: DatasetView[] }[];
  flags: Flag[];
  /** material records of the last 90 days (activist stakes, red-flag 8-K items, recalls, large awards) */
  notable: CompanyAltRow[];
  latest: string | null;
}

/** 8-K items that rarely appear and usually matter (the tab, the hub and the assistant use this one list). */
export const RED_FLAG_8K: Record<string, string> = {
  "1.03": "Bankruptcy", "1.05": "Cyber incident", "2.04": "Debt acceleration", "2.05": "Restructuring costs", "2.06": "Impairment",
  "3.01": "Listing notice", "4.01": "Auditor change", "4.02": "Restatement",
};

const ACTIVE_TRIAL = new Set(["RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION", "NOT_YET_RECRUITING"]);
const BANK_ORDER = ["Total deposits", "Total assets", "Net loans & leases", "Net income (YTD)", "Net interest margin", "Net charge-off rate", "Noncurrent loans / loans", "Return on assets", "CET1 ratio"];
/** Bank ratios where a rise is bad news. */
export const BANK_RISK = ["Net charge-off rate", "Noncurrent loans / loans"];

const byDateDesc = (a: CompanyAltRow, b: CompanyAltRow) => (b.date ?? "").localeCompare(a.date ?? "") || a.uid.localeCompare(b.uid);
const tone = (c: number | null | undefined, goodUp = true): Figure["tone"] => (c == null || Math.abs(c) < 0.0005 ? undefined : (c > 0) === goodUp ? "positive" : "negative");
const vs = (c: number | null, label: string) => (c == null ? undefined : `${fmtChange(c)} vs ${label}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const subOf = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ") || undefined;

function seriesOf(rows: CompanyAltRow[], title: string) {
  return rows.filter((r) => r.kind === "series" && r.title === title && r.value != null && r.date).sort((a, b) => a.date!.localeCompare(b.date!));
}

function chartOf(rows: CompanyAltRow[], today: string, yearly: boolean, max: number): ChartPoint[] {
  return rows.slice(-max).map((r) => ({ label: periodLabel(r, today, yearly), value: r.value!, partial: isPartial(r, today), row: r }));
}

/* ---------------- counts and the rise rule ---------------- */

/** A count over the trailing window, worded by what the stored history covers. */
function countFigure<T extends CompanyAltRow>(t: TrailingCount<T>, label: string, units: number, opts: { sub?: string; tone?: Figure["tone"]; rows?: T[]; change?: boolean } = {}): Figure {
  const before = t.before ? t.before.length : null;
  const change = opts.change !== false && t.whole && before ? units / before - 1 : null;
  return {
    label: `${label}, ${t.span}`,
    value: units.toLocaleString("en-US"),
    sub: subOf(opts.sub, vs(change, "prior 12 months")),
    tone: opts.tone,
    rows: opts.rows ?? rowsOf(t.units),
    num: units,
  };
}

/** Where a count's stored history starts, when that is later than the window shown. */
const coverageOf = (s: CountSupport<CompanyAltRow>, t: TrailingCount<CompanyAltRow>) => (!t.whole && s.since ? `Stored history starts ${dayLabel(s.since)}: counts cover what is on file since then.` : undefined);

/**
 * The rise rule on one dataset's watched streams (`riseVerdict` over `wholeWindows`). Flags a rise
 * only; returns nothing when fewer than a year of whole windows precede the latest one.
 */
export function riseFlag(dataset: string, rows: CompanyAltRow[], today: string): Flag | undefined {
  const s = countSupport(dataset, rows, { watched: true });
  if (s.none) return undefined;
  const w = wholeWindows(s, today);
  if (w.counts.length < 2) return undefined;
  const v = riseVerdict(w.counts);
  if (v.status !== "rise") return undefined;
  const [one, many] = s.noun;
  const evidence = rowsOf(w.latest).sort(byDateDesc);
  return {
    dataset,
    kind: "rise",
    direction: "up",
    text: `${plural(v.recent, one, many)} in the last 90 days; at most ${v.max} in any of the ${v.prior} earlier 90-day windows (mean ${v.mean.toFixed(1)})`,
    strength: -Math.log10(Math.max(v.p, 1e-12)),
    date: evidence[0]?.date ?? null,
    rows: evidence,
    history: w.counts,
    rule: `More than every earlier window and at least twice their mean; if all ${v.prior + 1} windows shared one rate, a count this high would land in the latest with ${pLabel(v.p)} (exact conditional test, flag below 0.001). Windows after the first stored record only${s.lagDays >= 30 ? `; the latest ${s.lagDays} days may not all be published yet` : ""}.`,
    figure: { label: `${cap(many)}, last 90 days`, value: v.recent.toLocaleString("en-US"), sub: `Most in an earlier 90 days: ${v.max}`, rows: evidence, num: v.recent, asOf: today },
  };
}

/** The readings a range rule compares: finished periods, single quarters for year-to-date rates. */
function rangeReadings(rule: RangeRule, series: CompanyAltRow[], today: string): { date: string; value: number; from: CompanyAltRow[] }[] {
  const done = settled(series, today);
  return rule.quarterOnly ? quarterOnly(done) : done.map((r) => ({ date: r.date!, value: r.value!, from: [r] }));
}

/** A range rule on the latest finished reading, only when that reading is the newest the source can have published. */
export function rangeFlag(rule: RangeRule, series: CompanyAltRow[], today: string): Flag | undefined {
  const readings = rangeReadings(rule, series, today);
  const last = readings[readings.length - 1];
  if (!last || daysBetween(last.date, today) > rule.currentDays) return undefined;
  const v = rangeVerdict(readings, rule);
  if (v.status !== "above" && v.status !== "below") return undefined;
  const unit = last.from[0].unit;
  const up = v.status === "above";
  const edge = up ? v.hi! : v.lo!;
  const period = rule.dataset === "attention" ? last.date.slice(0, 7) : rule.dataset === "settlement" ? `the half-month ending ${last.date}` : `the quarter ending ${last.date}`;
  const times = Number.isFinite(v.ratio) ? `${v.ratio.toFixed(1)}×` : "far";
  const word = rule.quarterOnly ? "single-quarter rate" : "reading";
  const rows = [...last.from, ...v.prior.flatMap((r) => r.from)].filter((r, i, a) => a.indexOf(r) === i);
  return {
    dataset: rule.dataset,
    kind: "range",
    direction: up ? "up" : "down",
    text: `${rule.what} ${fmtAlt(last.value, unit)} in ${period}: ${times} ${up ? "the highest" : "below the lowest"} ${word} of ${rule.span} (${fmtAlt(edge.value, unit)}, ${edge.date.slice(0, rule.dataset === "attention" ? 7 : 10)})`,
    strength: Number.isFinite(v.ratio) ? v.ratio : 99,
    date: last.date,
    rows,
    rule: `${up ? "Above" : "Below"} its own range: ${up ? `at least ${rule.factor}× the highest` : `at most the lowest ÷ ${rule.factor}`} of the ${v.prior.length} ${word}s in ${rule.span}${rule.minBeyond ? ` and ${rule.minBeyond} points beyond it` : ""}${rule.minLatest ? `, and at least ${fmtAlt(rule.minLatest, unit)}` : ""}${rule.minLevel ? `; only for series whose median is at least ${fmtAlt(rule.minLevel, unit)}` : ""}${rule.quarterOnly ? "; the year-to-date rate is turned into single quarters first" : ""}.`,
    figure: { label: `${rule.title}, ${rule.dataset === "attention" ? last.date.slice(0, 7) : last.date}${rule.quarterOnly ? " quarter" : ""}`, value: fmtAlt(last.value, unit), sub: `${up ? "Highest" : "Lowest"} of ${rule.span}: ${fmtAlt(edge.value, unit)}`, rows, num: last.value, asOf: last.date },
  };
}

const strongest = (flags: (Flag | undefined)[]) => (flags.filter(Boolean) as Flag[]).sort((a, b) => b.strength - a.strength)[0];
const seriesFlags = (dataset: string, rows: CompanyAltRow[], today: string) => strongest(rangeRulesOf(dataset).map((r) => rangeFlag(r, seriesOf(rows, r.title), today)));

/* ---------------- per dataset ---------------- */

type Builder = (rows: CompanyAltRow[], today: string, revenue: RevenuePoint[]) => Omit<DatasetView, "dataset" | "label" | "source" | "theme" | "latest" | "count" | "rows"> | null;

const eventsOnly = (rows: CompanyAltRow[]) => rows.filter((r) => r.kind === "event" && r.date).sort(byDateDesc);

const BUILDERS: Record<string, Builder> = {
  events(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    const red = t.now.filter((r) => RED_FLAG_8K[r.meta?.item]);
    return {
      figures: [
        { label: "8-K items, 12 months", value: t.count.toLocaleString("en-US"), sub: vs(t.change, "prior 12 months"), rows: t.now },
        { label: "Red-flag items, 12 months", value: red.length.toLocaleString("en-US"), sub: red.length ? [...new Set(red.map((r) => RED_FLAG_8K[r.meta.item]))].join(", ") : "No restatement, impairment, auditor, cyber or listing items", tone: red.length ? "negative" : undefined, rows: red },
      ],
      table: ev,
      flag: eventFlag("events", ev, today, "8-K item"),
    };
  },
  ownership(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    const act = t.now.filter((r) => r.meta?.activist);
    const holders = new Set(t.now.map((r) => (r.meta?.filers ?? [])[0]).filter(Boolean));
    return {
      figures: [
        { label: "13D/13G filings, 12 months", value: t.count.toLocaleString("en-US"), sub: holders.size ? `${plural(holders.size, "holder")} filed` : undefined, rows: t.now },
        { label: "Activist 13D filings, 12 months", value: act.length.toLocaleString("en-US"), sub: act.length ? [...new Set(act.map((r) => (r.meta?.filers ?? [])[0]).filter(Boolean))].slice(0, 2).join(", ") : "None", tone: act.length ? "negative" : undefined, rows: act },
      ],
      table: ev,
      flag: eventFlag("ownership", ev, today, "holder filing"),
    };
  },
  capital(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    const offer = t.now.filter((r) => r.meta?.category === "offering" || r.meta?.category === "shelf");
    return {
      figures: [
        { label: "Offering and shelf filings, 12 months", value: offer.length.toLocaleString("en-US"), sub: vs(t.change, "prior 12 months (all filings)"), rows: offer },
        { label: "All capital filings, 12 months", value: t.count.toLocaleString("en-US"), rows: t.now },
      ],
      table: ev,
      flag: eventFlag("capital", ev, today, "capital-markets filing"),
    };
  },
  regulatory(rows, today) {
    const series = seriesOf(rows, "Federal Register documents naming the company");
    const ev = eventsOnly(rows);
    const nonzero = series.some((r) => r.value! > 0);
    // a few mentions over five years and nothing on file to show is not worth a panel
    const recentDocs = series.filter((r) => !isPartial(r, today)).slice(-5).reduce((a, r) => a + r.value!, 0);
    if (!ev.length && recentDocs < 3) return null;
    const y = nonzero ? yearOnYear(series, today) : null;
    const figures: Figure[] = [];
    if (y) figures.push({ label: `Federal Register documents, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, null), sub: [vs(y.change, periodLabel(y.prior ?? y.latest, today)), y.partial ? `${periodLabel(y.partial, today)}: ${fmtAlt(y.partial.value, null)}` : null].filter(Boolean).join(" · ") || undefined, rows: [y.latest, ...(y.prior ? [y.prior] : [])] });
    const t = trailingYear(ev, today);
    if (ev.length && !y) figures.push({ label: "Documents on file, 12 months", value: t.count.toLocaleString("en-US"), sub: vs(t.change, "prior 12 months"), rows: t.now });
    return {
      figures,
      chart: nonzero ? { kind: "bar", unit: null, title: "Documents per year", points: chartOf(series, today, true, 12) } : undefined,
      table: ev,
      flag: eventFlag("regulatory", ev, today, "Federal Register document"),
    };
  },
  contracts(rows, today, revenue) {
    const series = seriesOf(rows, "Federal contract obligations");
    const ev = eventsOnly(rows);
    const y = yearOnYear(series, today);
    const figures: Figure[] = [];
    if (y) {
      figures.push({ label: `Federal obligations, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, "USD"), sub: [vs(y.change, periodLabel(y.prior ?? y.latest, today)), y.partial ? `${periodLabel(y.partial, today)}: ${fmtAlt(y.partial.value, "USD")}` : null].filter(Boolean).join(" · ") || undefined, tone: tone(y.change), rows: [y.latest, ...(y.prior ? [y.prior] : [])] });
      const sc = y.latest.value! > 0 ? scaleFigure("Obligations against revenue", y.latest.value!, y.latest, [y.latest], revenue, "Federal contract obligations in the fiscal year") : null;
      if (sc) figures.push(sc);
    }
    const t = trailingYear(ev, today);
    if (ev.length) figures.push({ label: "Award actions, 12 months", value: fmtAlt(t.sum, "USD"), sub: `${plural(t.count, "action")} on file`, rows: t.now });
    const recentFirst = [...t.now].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return {
      figures,
      chart: series.length ? { kind: "bar", unit: "USD", title: "Obligations by federal fiscal year", points: chartOf(series, today, true, 12) } : undefined,
      table: [...recentFirst, ...ev.filter((r) => !t.now.includes(r))],
      flag: eventFlag("contracts", ev, today, "award action"),
    };
  },
  fda(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    const appr = t.now.filter((r) => r.meta?.kind === "approval");
    const rec = t.now.filter((r) => r.meta?.kind !== "approval");
    const c1 = rec.filter((r) => r.meta?.class === "Class I");
    return {
      figures: [
        { label: "Approvals and new indications, 12 months", value: appr.length.toLocaleString("en-US"), rows: appr },
        { label: "Recalls, 12 months", value: rec.length.toLocaleString("en-US"), sub: c1.length ? `${c1.length} Class I` : rec.length ? "None Class I" : undefined, tone: c1.length ? "negative" : undefined, rows: rec },
      ],
      table: ev,
      flag: eventFlag("fda", ev, today, "FDA record"),
    };
  },
  trials(rows, today) {
    const ev = eventsOnly(rows);
    const active = ev.filter((r) => ACTIVE_TRIAL.has(r.meta?.status));
    const phases = new Map<string, number>();
    for (const r of active) {
      const p = r.meta?.phase ? String(r.meta.phase).replace(/PHASE/g, "Ph ") : "No phase";
      phases.set(p, (phases.get(p) ?? 0) + 1);
    }
    const late = active.filter((r) => /PHASE3|PHASE4/.test(r.meta?.phase ?? ""));
    const ended = trailingYear(ev.filter((r) => /COMPLETED|TERMINATED|WITHDRAWN|SUSPENDED/.test(r.meta?.status ?? "")), today);
    return {
      figures: [
        { label: "Active trials", value: active.length.toLocaleString("en-US"), sub: [...phases.entries()].sort().map(([p, n]) => `${p} ${n}`).join(" · ") || undefined, rows: active },
        { label: "Phase 3 and 4, active", value: late.length.toLocaleString("en-US"), sub: ended.count ? `${plural(ended.count, "trial")} completed or stopped, records updated in 12 months` : undefined, rows: late },
      ],
      table: [...active, ...ev.filter((r) => !ACTIVE_TRIAL.has(r.meta?.status))],
    };
  },
  medicare(rows, today, revenue) {
    const totals = rows.filter((r) => r.kind === "series" && /^Medicare Part [BD] spending$/.test(r.title) && r.value != null && r.date);
    const years = new Map<string, { date: string; value: number; partial: boolean; rows: CompanyAltRow[] }>();
    for (const r of totals) {
      const k = r.meta?.ytd ? `${r.date!.slice(0, 4)}p` : r.date!.slice(0, 4);
      const e = years.get(k) ?? { date: r.date!, value: 0, partial: isPartial(r, today), rows: [] };
      e.value += r.value!;
      e.rows.push(r);
      years.set(k, e);
    }
    const list = [...years.entries()].sort((a, b) => a[1].date.localeCompare(b[1].date));
    const full = list.filter(([, e]) => !e.partial);
    const last = full[full.length - 1];
    const prev = full[full.length - 2];
    const part = list.filter(([, e]) => e.partial).pop();
    const figures: Figure[] = [];
    if (last) {
      const ch = prev && prev[1].value ? last[1].value / prev[1].value - 1 : null;
      figures.push({ label: `Medicare spending, ${last[0]}`, value: fmtAlt(last[1].value, "USD"), sub: [vs(ch, prev?.[0] ?? ""), part ? `${periodLabel(part[1].rows[0], today)}: ${fmtAlt(part[1].value, "USD")}` : null].filter(Boolean).join(" · ") || undefined, tone: tone(ch), rows: last[1].rows, formula: "Part D plus Part B gross spending, before rebates" });
      const sc = scaleFigure("Medicare spending against revenue", last[1].value, last[1].rows[0], last[1].rows, revenue, "Gross Medicare Part D and B spending, before rebates");
      if (sc) figures.push({ ...sc, sub: `${sc.sub}; gross, before rebates` });
    }
    const points: ChartPoint[] = list.slice(-6).map(([k, e]) => ({ label: e.partial ? periodLabel(e.rows[0], today) : k, value: e.value, partial: e.partial, row: e.rows[0] }));
    return {
      figures,
      chart: points.length ? { kind: "bar", unit: "USD", title: "Part D and B spending by year", points } : undefined,
      table: rows.filter((r) => /^Part [BD] · /.test(r.title)),
    };
  },
  medicare_states(rows) {
    const yrs = [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => b - a);
    const y = yrs[0];
    const states = rows.filter((r) => r.meta?.year === y && r.meta?.state).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top = states[0];
    const hi = [...states].filter((r) => (r.value ?? 0) > 0).sort((a, b) => (b.meta?.index ?? 0) - (a.meta?.index ?? 0))[0];
    if (!top) return { figures: [], table: rows };
    return {
      figures: [
        { label: `Largest state, ${y}`, value: top.meta.name ?? top.meta.state, sub: `${fmtAlt(top.value, "USD")}, ${fmtShare(top.meta.share)} of its Part D costs`, rows: [top] },
        ...(hi ? [{ label: `Most over-indexed state, ${y}`, value: hi.meta.name ?? hi.meta.state, sub: `${(hi.meta.index as number).toFixed(2)}× its share of all Part D costs`, rows: [hi] }] : []),
      ],
      table: rows,
    };
  },
  recalls(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    return {
      figures: [
        { label: "Recall campaigns, 12 months", value: t.count.toLocaleString("en-US"), sub: vs(t.change, "prior 12 months"), tone: tone(t.change, false), rows: t.now },
        { label: "Units affected, 12 months", value: fmtAlt(t.sum, null), rows: t.now },
      ],
      table: ev,
      flag: eventFlag("recalls", ev, today, "recall campaign"),
    };
  },
  consumer(rows, today) {
    const ev = eventsOnly(rows);
    const t = trailingYear(ev, today);
    const own = ev.filter((r) => r.meta?.role !== "retailer");
    return {
      figures: [
        { label: "Recalls, 12 months", value: t.count.toLocaleString("en-US"), sub: ev[0] ? `Latest ${ev[0].date}` : undefined, rows: t.now },
        { label: "Recalls on file as maker", value: own.length.toLocaleString("en-US"), sub: `${plural(ev.length - own.length, "more")} as retailer`, rows: own },
      ],
      table: ev,
      flag: eventFlag("consumer", ev, today, "recall"),
    };
  },
  tri(rows, today) {
    const rel = seriesOf(rows, "Toxic releases (TRI)");
    const fac = seriesOf(rows, "TRI facilities");
    const y = yearOnYear(rel, today);
    const f = fac[fac.length - 1];
    const figures: Figure[] = [];
    if (y) figures.push({ label: `Releases, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, "lbs"), sub: vs(y.change, periodLabel(y.prior ?? y.latest, today)), tone: tone(y.change, false), rows: [y.latest, ...(y.prior ? [y.prior] : [])] });
    if (f) figures.push({ label: `Reporting plants, ${f.date!.slice(0, 4)}`, value: fmtAlt(f.value, null), rows: [f] });
    return { figures, table: rows };
  },
  settlement(rows, today) {
    const s = seriesOf(rows, "Fails to deliver (avg daily balance)");
    const last = s[s.length - 1];
    if (!last) return null;
    const year = s.filter((r) => r.date! > addDays(today, -365));
    const peak = [...year].sort((a, b) => b.value! - a.value!)[0];
    const prior = s.slice(-25, -1).map((r) => r.value!).sort((a, b) => a - b);
    const med = prior.length ? (prior.length % 2 ? prior[(prior.length - 1) / 2] : (prior[prior.length / 2 - 1] + prior[prior.length / 2]) / 2) : null;
    return {
      figures: [
        { label: "Fails to deliver, latest half-month", value: fmtAlt(last.value, "USD"), sub: med ? `${(last.value! / med).toFixed(1)}× its median of ${fmtAlt(med, "USD")}` : undefined, asOf: last.date!, rows: [last] },
        ...(peak ? [{ label: "Peak, 12 months", value: fmtAlt(peak.value, "USD"), sub: `Half-month ending ${peak.date}`, rows: [peak] }] : []),
      ],
      chart: { kind: "line", unit: "USD", title: "Average daily value failing, per half-month", points: chartOf(s, today, false, 48) },
      table: [...s].reverse(),
      flag: seriesFlag("settlement", s, today, { log: true, window: 24, minValue: 1e6, upOnly: true, what: "Fails to deliver averaged" }),
    };
  },
  attention(rows, today) {
    const s = seriesOf(rows, "Wikipedia pageviews");
    const ttm = trailingTwelveMonths(s, today);
    const last = s[s.length - 1];
    if (!last) return null;
    return {
      figures: [
        ...(ttm ? [{ label: "Pageviews, 12 months", value: fmtAlt(ttm.sum, null), sub: vs(ttm.change, "prior 12 months"), tone: tone(ttm.change), rows: ttm.rows }] : []),
        { label: `Pageviews, ${last.date!.slice(0, 7)}`, value: fmtAlt(last.value, null), rows: [last] },
      ],
      chart: { kind: "line", unit: null, title: "Monthly pageviews", points: chartOf(s, today, false, 36) },
      table: [...s].reverse(),
      flag: seriesFlag("attention", s, today, { log: true, window: 12, minValue: 10_000, what: "Pageviews of" }),
    };
  },
  bank(rows, today) {
    const dep = yearOnYear(seriesOf(rows, "Total deposits"), today);
    const nco = seriesOf(rows, "Net charge-off rate");
    const ncoY = yearOnYear(nco, today);
    const figures: Figure[] = [];
    if (dep) figures.push({ label: `Bank deposits, ${dep.latest.date}`, value: fmtAlt(dep.latest.value, "USD"), sub: vs(dep.change, "a year earlier"), tone: tone(dep.change), rows: [dep.latest, ...(dep.prior ? [dep.prior] : [])] });
    if (ncoY) {
      const bp = ncoY.prior ? Math.round((ncoY.latest.value! - ncoY.prior.value!) * 100) : null;
      figures.push({ label: `Net charge-off rate, ${ncoY.latest.date}`, value: fmtAlt(ncoY.latest.value, "%"), sub: bp == null ? undefined : `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${Math.abs(bp)} bp vs a year earlier`, tone: bp == null || bp === 0 ? undefined : bp > 0 ? "negative" : "positive", rows: [ncoY.latest, ...(ncoY.prior ? [ncoY.prior] : [])] });
    }
    const flags = BANK_RISK.map((t) => seriesFlag("bank", seriesOf(rows, t), today, { window: 8, floor: 0.02, upOnly: true, what: t })).filter(Boolean) as Flag[];
    const titles = [...new Set(rows.map((r) => r.title))].sort((a, b) => (BANK_ORDER.indexOf(a) + 99) % 99 - (BANK_ORDER.indexOf(b) + 99) % 99);
    return { figures, table: titles.map((t) => seriesOf(rows, t).pop()!).filter(Boolean), flag: flags.sort((a, b) => b.score - a.score)[0] };
  },
  deposits(rows, today) {
    const tot = yearOnYear(seriesOf(rows, "Branch deposits"), today);
    if (!tot) return { figures: [], table: rows };
    const states = rows.filter((r) => r.date === tot.latest.date && r.title !== "Branch deposits").sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top = states[0];
    return {
      figures: [
        { label: `Branch deposits, ${tot.latest.date}`, value: fmtAlt(tot.latest.value, "USD"), sub: vs(tot.change, "a year earlier"), tone: tone(tot.change), rows: [tot.latest, ...(tot.prior ? [tot.prior] : [])] },
        ...(top ? [{ label: "Largest state", value: top.meta?.name ?? top.meta?.state, sub: `${fmtShare(top.meta?.share)} of branch deposits · ${fmtShare(top.meta?.market_share)} of the state`, rows: [top] }] : []),
      ],
      table: rows,
    };
  },
  complaints(rows, today) {
    const s = seriesOf(rows, "CFPB consumer complaints");
    const y = yearOnYear(s, today);
    if (!y) return null;
    const prod = (y.partial ?? y.latest).meta?.products?.[0];
    return {
      figures: [
        { label: `CFPB complaints, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, null), sub: [vs(y.change, periodLabel(y.prior ?? y.latest, today)), y.partial ? `${periodLabel(y.partial, today)}: ${fmtAlt(y.partial.value, null)}` : null].filter(Boolean).join(" · ") || undefined, tone: tone(y.change, false), rows: [y.latest, ...(y.prior ? [y.prior] : [])] },
        ...(prod ? [{ label: "Most complained-about product", value: prod.product, sub: `${prod.n.toLocaleString("en-US")} in ${periodLabel(y.partial ?? y.latest, today)}`, rows: [y.partial ?? y.latest] }] : []),
      ],
      chart: { kind: "bar", unit: null, title: "Complaints per year", points: chartOf(s, today, true, 12) },
      table: [...s].reverse(),
    };
  },
};

/** Build the company's alt-data view. `revenue` comes from the company's own annual income statement. */
export function buildCompanyAlt(rows: CompanyAltRow[], today: string, revenue: RevenuePoint[] = []): CompanyAlt {
  const by = new Map<string, CompanyAltRow[]>();
  for (const r of rows) (by.get(r.dataset) ?? by.set(r.dataset, []).get(r.dataset)!).push(r);
  const views: DatasetView[] = [];
  for (const [dataset, info] of Object.entries(DATASETS)) {
    const rs = by.get(dataset);
    if (!rs?.length) continue;
    const built = BUILDERS[dataset]?.(rs, today, revenue);
    if (!built) continue;
    views.push({ dataset, label: info.label, source: info.source, theme: info.theme, latest: recency(rs, today).latest, count: rs.length, rows: rs, ...built });
  }
  const flags = views.flatMap((v) => (v.flag ? [v.flag] : [])).sort((a, b) => b.score - a.score);
  const since = addDays(today, -90);
  const recent = (r: CompanyAltRow) => !!r.date && r.date > since && r.date <= today;
  const notable = rows
    .filter((r) => r.kind === "event" && recent(r))
    .filter((r) =>
      (r.dataset === "ownership" && r.meta?.activist) ||
      (r.dataset === "events" && RED_FLAG_8K[r.meta?.item]) ||
      (r.dataset === "fda" && r.meta?.kind !== "approval" && r.meta?.class === "Class I") ||
      (r.dataset === "fda" && r.meta?.kind === "approval") ||
      r.dataset === "recalls" || r.dataset === "consumer" ||
      (r.dataset === "contracts" && (r.value ?? 0) >= 100e6))
    .sort(byDateDesc);
  return {
    views,
    themes: THEMES.map((t) => ({ ...t, views: views.filter((v) => v.theme === t.id) })).filter((t) => t.views.length),
    flags,
    notable,
    latest: recency(rows, today).latest,
  };
}

/** The few figures that say most about a company, for the Overview snapshot (at most `max`). */
export function snapshotFigures(alt: CompanyAlt, max = 6): { view: DatasetView; figure: Figure; flag?: Flag }[] {
  const order = ["contracts", "medicare", "bank", "deposits", "complaints", "fda", "trials", "recalls", "tri", "regulatory", "ownership", "events", "settlement", "attention", "capital", "consumer", "medicare_states"];
  const out: { view: DatasetView; figure: Figure; flag?: Flag }[] = [];
  const flagged = new Set(alt.flags.map((f) => f.dataset));
  const views = [...alt.views].sort((a, b) => Number(flagged.has(b.dataset)) - Number(flagged.has(a.dataset)) || order.indexOf(a.dataset) - order.indexOf(b.dataset));
  for (const v of views) {
    const f = v.figures[0];
    if (!f) continue;
    // a count of zero says little in a snapshot unless it is the only thing there is
    if (/^0$/.test(f.value) && !v.flag) continue;
    out.push({ view: v, figure: f, flag: v.flag });
    if (out.length >= max) break;
  }
  return out;
}
