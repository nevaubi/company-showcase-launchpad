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
 * The last day through which a stream's records are all on file. A source that publishes within a
 * week (SEC filings, CPSC) is complete through today; one that publishes weeks later (NHTSA, FDA
 * recalls) only through today less its delay, so the latest window compared is a whole one.
 */
export const completeThrough = (s: Pick<CountSupport<CompanyAltRow>, "lagDays">, today: string) => (s.lagDays >= 14 ? addDays(today, -s.lagDays) : today);

/**
 * The rise rule on one dataset's watched streams (`riseVerdict` over `wholeWindows`). Flags a rise
 * only; returns nothing when fewer than a year of whole windows precede the latest one.
 */
export function riseFlag(dataset: string, rows: CompanyAltRow[], today: string): Flag | undefined {
  const s = countSupport(dataset, rows, { watched: true });
  if (s.none) return undefined;
  // every window compared ends where the source has published everything: today less its delay
  const end = completeThrough(s, today);
  const w = wholeWindows(s, end);
  if (w.counts.length < 2) return undefined;
  const v = riseVerdict(w.counts);
  if (v.status !== "rise") return undefined;
  const [one, many] = s.noun;
  const evidence = rowsOf(w.latest).sort(byDateDesc);
  const span = end === today ? "the last 90 days" : `the 90 days to ${dayLabel(end)}`;
  return {
    dataset,
    kind: "rise",
    direction: "up",
    text: `${plural(v.recent, one, many)} in ${span}; at most ${v.max} in any of the ${v.prior} earlier 90-day windows (mean ${v.mean.toFixed(1)})`,
    strength: -Math.log10(Math.max(v.p, 1e-12)),
    date: evidence[0]?.date ?? null,
    rows: evidence,
    history: w.counts,
    rule: `More than every earlier window and at least twice their mean; if all ${v.prior + 1} windows shared one rate, a count this high would land in the latest with ${pLabel(v.p)} (exact conditional test, flag below 0.001). Windows after the first stored record only${end === today ? "" : `, ending ${s.lagDays} days back because the source publishes that late`}.`,
    figure: { label: `${cap(many)}, ${end === today ? "last 90 days" : `90 days to ${dayLabel(end)}`}`, value: v.recent.toLocaleString("en-US"), sub: `Most in an earlier 90 days: ${v.max}`, rows: evidence, num: v.recent, asOf: today },
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
  const times = Number.isFinite(v.ratio) ? `${v.ratio.toFixed(1)}×` : "far above";
  const word = rule.quarterOnly ? "single-quarter rate" : "reading";
  const rows = [...last.from, ...v.prior.flatMap((r) => r.from)].filter((r, i, a) => a.indexOf(r) === i);
  return {
    dataset: rule.dataset,
    kind: "range",
    direction: up ? "up" : "down",
    text: `${rule.what} ${fmtAlt(last.value, unit)} in ${period}: ${up ? `${times} the highest` : `${Number.isFinite(v.ratio) ? Math.round(100 / v.ratio) : 0}% of the lowest`} ${word} of ${rule.span} (${fmtAlt(edge.value, unit)}, ${edge.date.slice(0, rule.dataset === "attention" ? 7 : 10)})`,
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
const firstFiler = (r: CompanyAltRow) => (r.meta?.filers ?? [])[0] as string | undefined;

/** "Phase 3: 3 · Phase 2: 1 · no phase: 2" */
export function phaseLine(active: CompanyAltRow[]): string | undefined {
  const m = new Map<string, number>();
  for (const r of active) {
    const raw = r.meta?.phase && r.meta.phase !== "NA" ? String(r.meta.phase) : "";
    const p = raw ? raw.replace(/EARLY_PHASE1/g, "Early phase 1").replace(/PHASE(\d)/g, "Phase $1").replace(/\s*[|,]\s*/g, "/").replace(/\/Phase /g, "/") : "no phase";
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  const rank = (p: string) => (p === "no phase" ? -1 : Number((p.match(/\d/g) ?? ["0"]).pop()));
  return [...m.entries()].sort((a, b) => rank(b[0]) - rank(a[0]) || a[0].localeCompare(b[0])).map(([p, n]) => `${p}: ${n}`).join(" · ") || undefined;
}

/**
 * Change against the year before over the drugs reported in both years, so a drug that left (or
 * joined) the file does not show up as a change in spending. Null when no drug is in both.
 */
export function sameDrugChange(lines: CompanyAltRow[], year: string, prior: string): { change: number; drugs: number; now: number; before: number } | null {
  const of = (y: string) => new Map(lines.filter((r) => String(r.meta?.year ?? r.date?.slice(0, 4)) === y && !r.meta?.ytd).map((r) => [r.title, r.value ?? 0]));
  const a = of(year);
  const b = of(prior);
  let now = 0, before = 0, drugs = 0;
  for (const [t, v] of a) if (b.has(t)) { now += v; before += b.get(t)!; drugs++; }
  return drugs && before > 0 ? { change: now / before - 1, drugs, now, before } : null;
}

const BUILDERS: Record<string, Builder> = {
  events(rows, today) {
    const ev = eventsOnly(rows);
    const s = countSupport("events", ev);
    const t = trailingCount(s, today);
    const items = rowsOf(t.units);
    const red = items.filter((r) => RED_FLAG_8K[r.meta?.item]);
    return {
      figures: [
        countFigure(t, "8-K filings", t.units.length, { sub: plural(items.length, "item") }),
        { label: `Red-flag items, ${t.span}`, value: red.length.toLocaleString("en-US"), sub: red.length ? [...new Set(red.map((r) => RED_FLAG_8K[r.meta.item]))].join(", ") : t.whole ? "No restatement, impairment, auditor, cyber or listing items" : undefined, tone: red.length ? "negative" : undefined, rows: red, num: red.length },
      ],
      coverage: coverageOf(s, t),
      table: ev,
      flag: riseFlag("events", ev, today),
    };
  },
  ownership(rows, today) {
    const ev = eventsOnly(rows);
    const s = countSupport("ownership", ev);
    const t = trailingCount(s, today);
    const now = rowsOf(t.units);
    const act = now.filter((r) => r.meta?.activist);
    const holders = new Set(now.map(firstFiler).filter(Boolean));
    return {
      figures: [
        countFigure(t, "13D/13G filings", t.units.length, { sub: holders.size ? `${plural(holders.size, "holder")} filed` : undefined }),
        { label: `Activist 13D filings, ${t.span}`, value: act.length.toLocaleString("en-US"), sub: act.length ? [...new Set(act.map(firstFiler).filter(Boolean))].slice(0, 2).join(", ") : t.whole ? "None" : undefined, tone: act.length ? "negative" : undefined, rows: act, num: act.length },
      ],
      coverage: coverageOf(s, t),
      table: ev,
      flag: riseFlag("ownership", ev, today),
    };
  },
  capital(rows, today) {
    const ev = eventsOnly(rows);
    const s = countSupport("capital", ev, { streams: ["filings"] });
    const t = trailingCount(s, today);
    const isOffer = (u: { rows: CompanyAltRow[] }) => u.rows.some((r) => r.meta?.category === "offering" || r.meta?.category === "shelf");
    const offer = t.units.filter(isOffer);
    const offerBefore = t.before?.filter(isOffer) ?? null;
    const notes = ev.filter((r) => /^424B[23]$/.test(String(r.meta?.form ?? "")) && !rowsOf(t.units).includes(r));
    return {
      figures: [
        { ...countFigure(t, "Offerings and shelf registrations", offer.length, { rows: rowsOf(offer), change: false }), sub: vs(offerBefore?.length ? offer.length / offerBefore.length - 1 : null, "prior 12 months") },
        countFigure(t, "Capital-markets actions", t.units.length, { sub: subOf(plural(rowsOf(t.units).length, "filing"), notes.length && s.aside.length ? `${plural(notes.length, "424B2/424B3 supplement")} counted apart` : null), change: false }),
      ],
      coverage: coverageOf(s, t),
      table: ev,
      flag: riseFlag("capital", ev, today),
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
    // the yearly count is the source's own total; stored documents are only the newest 40 per type
    if (y) figures.push({ label: `Federal Register documents, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, null), sub: subOf(vs(y.change, periodLabel(y.prior ?? y.latest, today)), ...y.partials.map((p) => `${periodLabel(p, today)}: ${fmtAlt(p.value, null)}`)), rows: [y.latest, ...(y.prior ? [y.prior] : [])], num: y.latest.value ?? 0 });
    if (ev.length) figures.push({ label: "Newest documents on file", value: ev.length.toLocaleString("en-US"), sub: `Since ${dayLabel(ev[ev.length - 1].date!)}; the newest 40 per document type`, rows: ev.slice(0, 1), num: ev.length });
    return {
      figures,
      chart: nonzero ? { kind: "bar", unit: null, title: "Documents per year (source's count)", points: chartOf(series, today, true, 12) } : undefined,
      coverage: "Documents that mention the company's name, not actions about it. Only the newest 40 of each document type are kept, so they are listed, not counted.",
      table: ev,
    };
  },
  contracts(rows, today) {
    const series = seriesOf(rows, "Federal contract obligations");
    const ev = eventsOnly(rows);
    const y = yearOnYear(series, today);
    const figures: Figure[] = [];
    if (y) {
      const names: string[] = Array.isArray(y.latest.meta?.recipients) ? y.latest.meta.recipients : [];
      figures.push({
        label: `Federal obligations, ${periodLabel(y.latest, today)}`,
        value: fmtAlt(y.latest.value, "USD"),
        sub: subOf(vs(y.change, periodLabel(y.prior ?? y.latest, today)), ...y.partials.map((p) => `${periodLabel(p, today)}: ${fmtAlt(p.value, "USD")}`), names.length ? plural(names.length, "recipient name") : null),
        tone: tone(y.change),
        rows: [y.latest, ...(y.prior ? [y.prior] : []), ...y.partials],
        formula: names.length ? `Obligations USAspending reports for ${names.join("; ")}` : undefined,
        num: y.latest.value ?? 0,
      });
    }
    // stored actions are the newest 300 per recipient, $1M and up: a list, never a total
    const year = ev.filter((r) => r.date! > addDays(today, -365));
    const largest = [...year].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    if (largest) figures.push({ label: "Largest award action, 12 months", value: fmtAlt(largest.value, "USD"), sub: subOf(largest.date, largest.meta?.agency ? String(largest.meta.agency) : null), rows: [largest], num: largest.value ?? 0, asOf: largest.date! });
    return {
      figures,
      chart: series.length ? { kind: "bar", unit: "USD", title: "Obligations by federal fiscal year", points: chartOf(series, today, true, 12) } : undefined,
      coverage: ev.length ? "Award actions of $1M or more among the newest 300 per recipient in 18 months; the Department of Defense publishes 90 days late, so the list is not a total." : undefined,
      table: [...[...year].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)), ...ev.filter((r) => !year.includes(r))],
    };
  },
  fda(rows, today) {
    const ev = eventsOnly(rows);
    const rs = countSupport("fda", ev, { streams: ["recalls"] });
    const as = countSupport("fda", ev, { streams: ["approvals"] });
    const rt = trailingCount(rs, today);
    const at = trailingCount(as, today);
    const rec = rowsOf(rt.units);
    const c1 = rt.units.filter((u) => u.rows.some((r) => r.meta?.class === "Class I"));
    return {
      figures: [
        countFigure(at, "Approvals and new indications", at.units.length, { change: false }),
        countFigure(rt, "Recalls begun", rt.units.length, { sub: subOf(rt.units.length ? (c1.length ? `${c1.length} Class I` : "None Class I") : null, rec.length > rt.units.length ? plural(rec.length, "product record") : null), tone: c1.length ? "negative" : undefined, change: false }),
      ],
      coverage: rs.units.length ? "Recalls are dated by the day they began and published after classification, about 90 days later, so the latest months are incomplete." : undefined,
      table: ev,
      flag: riseFlag("fda", ev, today),
    };
  },
  trials(rows, today) {
    const ev = eventsOnly(rows);
    const active = ev.filter((r) => ACTIVE_TRIAL.has(r.meta?.status));
    const late = active.filter((r) => /PHASE3|PHASE4/.test(r.meta?.phase ?? ""));
    const ended = ev.filter((r) => /COMPLETED|TERMINATED|WITHDRAWN|SUSPENDED/.test(r.meta?.status ?? "") && r.date! > addDays(today, -365));
    return {
      figures: [
        { label: "Active trials", value: active.length.toLocaleString("en-US"), sub: phaseLine(active), rows: active, num: active.length },
        { label: "Phase 3 and 4, active", value: late.length.toLocaleString("en-US"), sub: ended.length ? `${plural(ended.length, "trial")} completed or stopped, records updated in 12 months` : undefined, rows: late, num: late.length },
      ],
      table: [...active, ...ev.filter((r) => !ACTIVE_TRIAL.has(r.meta?.status))],
    };
  },
  medicare(rows, today, revenue) {
    const totals = rows.filter((r) => r.kind === "series" && /^Medicare Part [BD] spending$/.test(r.title) && r.value != null && r.date);
    const lines = rows.filter((r) => /^Part [BD] · /.test(r.title) && r.value != null);
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
      const same = prev ? sameDrugChange(lines, last[0], prev[0]) : null;
      const end = typeof last[1].rows[0].meta?.period_end === "string" ? last[1].rows[0].meta.period_end : last[1].date;
      const rev = revenueNear(revenue, end);
      figures.push({
        label: `Medicare spending, ${last[0]}`,
        value: fmtAlt(last[1].value, "USD"),
        sub: subOf(same ? `${fmtChange(same.change)} vs ${prev![0]} on the ${plural(same.drugs, "drug")} in both years` : null, rev ? `${fmtShare(last[1].value / rev.value)} of FY${rev.end.slice(0, 4)} revenue` : null, part ? `${periodLabel(part[1].rows[0], today)}: ${fmtAlt(part[1].value, "USD")}` : null),
        tone: tone(same?.change),
        rows: last[1].rows,
        revenue: rev ?? undefined,
        formula: rev ? `Part D plus Part B gross spending on the company's own brands, before rebates, ÷ annual revenue for the fiscal year ending ${rev.end}` : "Part D plus Part B gross spending on the company's own brands, before rebates",
        num: last[1].value,
      });
    }
    const points: ChartPoint[] = list.slice(-6).map(([k, e]) => ({ label: e.partial ? periodLabel(e.rows[0], today) : k, value: e.value, partial: e.partial, row: e.rows[0] }));
    return {
      figures,
      chart: points.length ? { kind: "bar", unit: "USD", title: "Part D and B spending by year", points } : undefined,
      table: lines,
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
        { label: `Largest state, ${y}`, value: top.meta.name ?? top.meta.state, sub: `${fmtAlt(top.value, "USD")}, ${fmtShare(top.meta.share)} of its Part D costs`, rows: [top], num: top.value ?? 0 },
        ...(hi ? [{ label: `Most over-indexed state, ${y}`, value: hi.meta.name ?? hi.meta.state, sub: `${(hi.meta.index as number).toFixed(2)}× its share of all Part D costs`, rows: [hi], num: hi.value ?? 0 }] : []),
      ],
      table: rows,
    };
  },
  recalls(rows, today) {
    const ev = eventsOnly(rows);
    const s = countSupport("recalls", ev);
    const t = trailingCount(s, today);
    const now = rowsOf(t.units);
    const change = t.before?.length ? t.units.length / t.before.length - 1 : null;
    return {
      figures: [
        countFigure(t, "Recall campaigns", t.units.length, { tone: tone(change, false) }),
        { label: `Units affected, ${t.span}`, value: fmtAlt(now.reduce((a, r) => a + (r.value ?? 0), 0), null), rows: now, num: now.reduce((a, r) => a + (r.value ?? 0), 0) },
      ],
      table: ev,
      flag: riseFlag("recalls", ev, today),
    };
  },
  consumer(rows, today) {
    const ev = eventsOnly(rows);
    const s = countSupport("consumer", ev);
    const t = trailingCount(s, today);
    const own = ev.filter((r) => r.meta?.role !== "retailer");
    return {
      figures: [
        countFigure(t, "Recalls", t.units.length, { sub: ev[0] ? `Latest ${ev[0].date}` : undefined }),
        { label: "Recalls on file as maker", value: own.length.toLocaleString("en-US"), sub: `${plural(ev.length - own.length, "more")} as retailer`, rows: own, num: own.length },
      ],
      table: ev,
      flag: riseFlag("consumer", ev, today),
    };
  },
  tri(rows, today) {
    const rel = seriesOf(rows, "Toxic releases (TRI)");
    const fac = seriesOf(rows, "TRI facilities");
    const y = yearOnYear(rel, today);
    const f = fac[fac.length - 1];
    const figures: Figure[] = [];
    if (y) figures.push({ label: `Releases, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, "lbs"), sub: vs(y.change, periodLabel(y.prior ?? y.latest, today)), tone: tone(y.change, false), rows: [y.latest, ...(y.prior ? [y.prior] : [])], num: y.latest.value ?? 0 });
    if (f) figures.push({ label: `Reporting plants, ${f.date!.slice(0, 4)}`, value: fmtAlt(f.value, null), rows: [f], num: f.value ?? 0 });
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
        { label: `Fails to deliver, half-month ending ${last.date}`, value: fmtAlt(last.value, "USD"), sub: med ? `${last.value! / med < 0.1 ? "<0.1" : (last.value! / med).toFixed(1)}× its median of ${fmtAlt(med, "USD")}` : undefined, asOf: last.date!, rows: [last], num: last.value ?? 0 },
        ...(peak ? [{ label: "Peak, 12 months", value: fmtAlt(peak.value, "USD"), sub: `Half-month ending ${peak.date}`, rows: [peak], num: peak.value ?? 0 }] : []),
      ],
      chart: { kind: "line", unit: "USD", title: "Average daily value failing, per half-month", points: chartOf(s, today, false, 48) },
      table: [...s].reverse(),
      flag: seriesFlags("settlement", rows, today),
    };
  },
  attention(rows, today) {
    // a month still running is never shown as a month
    const s = settled(seriesOf(rows, "Wikipedia pageviews"), today);
    const ttm = trailingTwelveMonths(s, today);
    const last = s[s.length - 1];
    if (!last) return null;
    return {
      figures: [
        ...(ttm ? [{ label: "Pageviews, 12 months", value: fmtAlt(ttm.sum, null), sub: vs(ttm.change, "prior 12 months"), tone: tone(ttm.change), rows: ttm.rows, num: ttm.sum }] : []),
        { label: `Pageviews, ${last.date!.slice(0, 7)}`, value: fmtAlt(last.value, null), rows: [last], num: last.value ?? 0 },
      ],
      chart: { kind: "line", unit: null, title: "Monthly pageviews", points: chartOf(s, today, false, 36) },
      table: [...s].reverse(),
      flag: seriesFlags("attention", rows, today),
    };
  },
  bank(rows, today) {
    const dep = yearOnYear(seriesOf(rows, "Total deposits"), today);
    const nco = seriesOf(rows, "Net charge-off rate");
    const ncoY = yearOnYear(nco, today);
    const figures: Figure[] = [];
    if (dep) figures.push({ label: `Bank deposits, ${dep.latest.date}`, value: fmtAlt(dep.latest.value, "USD"), sub: vs(dep.change, "a year earlier"), tone: tone(dep.change), rows: [dep.latest, ...(dep.prior ? [dep.prior] : [])], num: dep.latest.value ?? 0 });
    if (ncoY) figures.push({ label: `Net charge-off rate, ${ncoY.latest.date}`, value: fmtAlt(ncoY.latest.value, "%"), sub: ncoY.prior ? `${bpChange(ncoY.latest.value! - ncoY.prior.value!)} vs a year earlier` : undefined, tone: ncoY.prior ? tone(-(ncoY.latest.value! - ncoY.prior.value!)) : undefined, rows: [ncoY.latest, ...(ncoY.prior ? [ncoY.prior] : [])], num: ncoY.latest.value ?? 0 });
    const titles = [...new Set(rows.map((r) => r.title))].sort((a, b) => (BANK_ORDER.indexOf(a) + 99) % 99 - (BANK_ORDER.indexOf(b) + 99) % 99);
    return { figures, table: titles.map((t) => seriesOf(rows, t).pop()!).filter(Boolean), flag: seriesFlags("bank", rows, today) };
  },
  deposits(rows, today) {
    const tot = yearOnYear(seriesOf(rows, "Branch deposits"), today);
    if (!tot) return { figures: [], table: rows };
    const states = rows.filter((r) => r.date === tot.latest.date && r.title !== "Branch deposits").sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top = states[0];
    return {
      figures: [
        { label: `Branch deposits, ${tot.latest.date}`, value: fmtAlt(tot.latest.value, "USD"), sub: vs(tot.change, "a year earlier"), tone: tone(tot.change), rows: [tot.latest, ...(tot.prior ? [tot.prior] : [])], num: tot.latest.value ?? 0 },
        ...(top ? [{ label: "Largest state", value: top.meta?.name ?? top.meta?.state, sub: `${fmtShare(top.meta?.share)} of branch deposits · ${fmtShare(top.meta?.market_share)} of the state`, rows: [top], num: top.value ?? 0 }] : []),
      ],
      table: rows,
    };
  },
  complaints(rows, today) {
    const s = seriesOf(rows, "CFPB consumer complaints");
    const y = yearOnYear(s, today);
    if (!y) return null;
    const part = y.partials[y.partials.length - 1];
    const prod = (part ?? y.latest).meta?.products?.[0];
    return {
      figures: [
        { label: `CFPB complaints, ${periodLabel(y.latest, today)}`, value: fmtAlt(y.latest.value, null), sub: subOf(vs(y.change, periodLabel(y.prior ?? y.latest, today)), part ? `${periodLabel(part, today)}: ${fmtAlt(part.value, null)}` : null), tone: tone(y.change, false), rows: [y.latest, ...(y.prior ? [y.prior] : [])], num: y.latest.value ?? 0 },
        ...(prod ? [{ label: "Most complained-about product", value: prod.product, sub: `${prod.n.toLocaleString("en-US")} in ${periodLabel(part ?? y.latest, today)}`, rows: [part ?? y.latest], num: prod.n }] : []),
      ],
      chart: { kind: "bar", unit: null, title: "Complaints per year", points: chartOf(s, today, true, 12) },
      table: [...s].reverse(),
    };
  },
};

/** A change in a rate in basis points: "+12 bp", "−7 bp", "0 bp". */
export function bpChange(d: number): string {
  const bp = Math.round(d * 100);
  return `${bp > 0 ? "+" : bp < 0 ? "\u2212" : ""}${Math.abs(bp)} bp`;
}

/**
 * What makes a dataset worth a full panel and a snapshot tile: something recent or of size. A view
 * below it is shown as one quiet line on the tab and left out of the snapshot.
 */
export function quietReason(v: Pick<DatasetView, "dataset" | "figures" | "flag" | "latest" | "table"> & { rows?: CompanyAltRow[] }, today: string): string | undefined {
  if (v.flag) return undefined;
  const age = v.latest ? daysBetween(v.latest, today) : Infinity;
  const n = (i: number) => v.figures[i]?.num ?? 0;
  switch (v.dataset) {
    case "contracts":
      return n(0) < 10e6 && !(v.figures.find((f) => f.label.startsWith("Largest award"))?.num) ? `Under $10M in the latest fiscal year and no award action of $1M or more in 12 months` : undefined;
    case "medicare":
      return n(0) < 10e6 ? "Under $10M of Medicare spending in the latest year" : undefined;
    case "regulatory": {
      // the yearly series is dated 31 Dec, so its age says nothing; count documents of the last 12 months
      const yearAgo = addDays(today, -365);
      const docs = (v.rows ?? []).filter((r) => r.kind === "event" && !!r.date && r.date > yearAgo && r.date <= today).length;
      return n(0) < 3 && docs < 3 ? "Fewer than three documents in the latest year or the last 12 months" : undefined;
    }
    case "fda":
    case "recalls":
    case "consumer":
      return v.figures.every((f) => !f.num) && age > 365 ? `Nothing in 12 months; newest record ${v.latest ?? "none"}` : undefined;
    case "tri":
      return n(0) < 10_000 ? "Under 10,000 lb of releases in the latest year" : undefined;
    default:
      return undefined;
  }
}

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
    const v: DatasetView = { dataset, label: info.label, source: info.source, theme: info.theme, latest: recency(rs, today).latest, count: rs.length, rows: rs, ...built };
    v.quiet = quietReason(v, today);
    views.push(v);
  }
  // within a kind by strength; rises (counts) before range readings
  const flags = views.flatMap((v) => (v.flag ? [v.flag] : [])).sort((a, b) => (a.kind === b.kind ? b.strength - a.strength : a.kind === "rise" ? -1 : 1));
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

/**
 * The few figures that say most about a company, for the Overview snapshot (at most `max`). A
 * flagged dataset comes first and its tile is the flagged reading itself; quiet datasets and
 * zero counts are left out; the rest follow in an order that puts money and safety first.
 */
export function snapshotFigures(alt: CompanyAlt, max = 6): { view: DatasetView; figure: Figure; flag?: Flag }[] {
  const order = ["contracts", "medicare", "bank", "deposits", "complaints", "fda", "trials", "recalls", "consumer", "tri", "ownership", "events", "settlement", "attention", "capital", "regulatory", "medicare_states"];
  const out: { view: DatasetView; figure: Figure; flag?: Flag }[] = [];
  const views = [...alt.views].sort((a, b) => Number(!!b.flag) - Number(!!a.flag) || order.indexOf(a.dataset) - order.indexOf(b.dataset));
  for (const v of views) {
    if (v.flag) {
      out.push({ view: v, figure: v.flag.figure, flag: v.flag });
    } else {
      const f = v.figures[0];
      if (!f || v.quiet || f.num === 0) continue;
      out.push({ view: v, figure: f });
    }
    if (out.length >= max) break;
  }
  return out;
}
