// Pure macro-series helpers shared by the app, the ingest script and the refresh job.
import type { MacroDef } from "@/lib/coverage";

export type Obs = [string, number][];

export const monthsBefore = (d: string, months: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  const day = t.getUTCDate();
  t.setUTCDate(1);
  t.setUTCMonth(t.getUTCMonth() - months + 1, 0);
  t.setUTCDate(Math.min(day, t.getUTCDate()));
  return t.toISOString().slice(0, 10);
};

/** Value at or before `date` (binary search on sorted observations). */
function observationAt(obs: Obs, date: string): Obs[number] | null {
  let lo = 0;
  let hi = obs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid][0] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? obs[ans] : null;
}

export function valueAt(obs: Obs, date: string): number | null {
  return observationAt(obs, date)?.[1] ?? null;
}

const monthNumber = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));

/** Restrict calendar comparisons to the target period; daily and weekly series allow a holiday. */
function periodValue(obs: Obs, target: string, frequency: MacroDef["frequency"]) {
  const marketCalendar = frequency === "Daily" || frequency === "Weekly";
  // Monthly and quarterly publishers can label periods by their first or
  // last day. September 30 must be allowed to compare to August 31.
  const cutoff = marketCalendar ? target : target.slice(0, 7) + "-31";
  const found = observationAt(obs, cutoff);
  if (!found) return null;
  const valid = marketCalendar
    ? Date.parse(target) - Date.parse(found[0]) <= 7 * 86400000
    : monthNumber(target) === monthNumber(found[0]);
  return valid ? found[1] : null;
}

/** All tenor observations in a curve must come from the same market session. */
export function sharedCurveDates(series: Obs[]): string[] {
  if (!series.length || series.some((obs) => !obs.length)) return [];
  const dates = series.map((obs) => new Set(obs.filter(([, v]) => Number.isFinite(v)).map(([d]) => d)));
  return [...dates[0]].filter((d) => dates.every((available) => available.has(d))).sort();
}

/** Apply the series' display transform (year-over-year %, period change or trailing 12-month sum). */
export function transformed(def: Pick<MacroDef, "transform" | "frequency">, obs: Obs): Obs {
  if (def.transform === "yoy") {
    const out: Obs = [];
    for (const [d, v] of obs) {
      const prior = periodValue(obs, monthsBefore(d, 12), def.frequency);
      if (prior != null && prior !== 0) out.push([d, (v / prior - 1) * 100]);
    }
    return out;
  }
  if (def.transform === "diff") {
    return obs.slice(1).flatMap(([d, v], i): Obs =>
      monthNumber(d) - monthNumber(obs[i][0]) === 1 ? [[d, v - obs[i][1]]] : [],
    );
  }
  if (def.transform === "sum12") {
    const out: Obs = [];
    for (let i = 11; i < obs.length; i++) {
      const window = obs.slice(i - 11, i + 1);
      if (window.every(([day], j) => monthNumber(day) === monthNumber(window[0][0]) + j)) {
        out.push([obs[i][0], window.reduce((sum, [, v]) => sum + v, 0)]);
      }
    }
    return out;
  }
  return obs;
}

export function displayUnits(def: Pick<MacroDef, "transform" | "units" | "fmt">) {
  if (def.transform === "yoy") return "% y/y";
  if (def.transform === "diff") return `Δ ${def.units.toLowerCase()}`;
  if (def.transform === "sum12") return `${def.units}, trailing 12 months`;
  return def.units;
}

export function fmtMacro(def: Pick<MacroDef, "transform" | "units" | "id" | "fmt">, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (def.transform === "yoy") return `${v.toFixed(1)}%`.replace("-", "−");
  if (def.transform === "diff") return `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString()}k`;
  if (def.fmt) {
    const x = v / (def.fmt.div ?? 1);
    const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: def.fmt.digits ?? 1, maximumFractionDigits: def.fmt.digits ?? 1 });
    return `${x < 0 ? "−" : ""}${def.fmt.prefix ?? ""}${s}${def.fmt.suffix ?? ""}`;
  }
  if (def.units === "%" || def.units === "pp") return `${v.toFixed(2)}${def.units === "%" ? "%" : " pp"}`.replace("-", "−");
  if (Math.abs(v) >= 1e5) return Math.round(v).toLocaleString();
  return v.toFixed(v < 10 ? 2 : 1);
}

export interface Reading {
  latest: number | null;
  date: string | null;
  prior: number | null;
  priorLabel: string;
  yearAgo: number | null;
}

export function readingOf(def: Pick<MacroDef, "frequency">, obs: Obs): Reading {
  const last = obs.at(-1);
  if (!last) return { latest: null, date: null, prior: null, priorLabel: "", yearAgo: null };
  const priorDate = def.frequency === "Weekly"
    ? new Date(Date.parse(last[0]) - 7 * 86400000).toISOString().slice(0, 10)
    : monthsBefore(last[0], def.frequency === "Quarterly" ? 3 : def.frequency === "Annual" ? 12 : 1);
  const prev = def.frequency === "Weekly"
    ? (obs.at(-2)?.[0] === priorDate ? obs.at(-2)![1] : null)
    : periodValue(obs, priorDate, def.frequency);
  return {
    latest: last[1],
    date: last[0],
    prior: prev,
    priorLabel:
      def.frequency === "Daily" ? "1M ago" : def.frequency === "Weekly" ? "prior week" : def.frequency === "Quarterly" ? "prior qtr" : def.frequency === "Annual" ? "prior year" : "prior month",
    yearAgo: periodValue(obs, monthsBefore(last[0], 12), def.frequency),
  };
}

export function reading(def: MacroDef, raw: Obs): Reading {
  return readingOf(def, transformed(def, raw));
}

const isRateLike = (def: Pick<MacroDef, "units" | "transform" | "fmt">) =>
  def.units === "%" || def.units === "pp" || def.transform === "yoy" || def.fmt?.suffix === "%";

export function changeText(def: MacroDef, r: Pick<Reading, "latest" | "prior" | "priorLabel">) {
  if (r.latest == null || r.prior == null) return "";
  const d = r.latest - r.prior;
  const s = isRateLike(def) ? `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(0)} bp` : `${d >= 0 ? "+" : "−"}${fmtMacro(def, Math.abs(d)).replace(/^[+−-]/, "")}`;
  return `${s} vs ${r.priorLabel}`;
}

/** Compact per-series state for dashboards (written by ingest and the refresh job). */
export interface MacroSummary {
  calculationVersion?: number;
  id: string;
  date: string | null;
  latest: number | null;
  prior: number | null;
  priorLabel: string;
  yearAgo: number | null;
  /** Percentile of the latest reading within the last ten years (0–1) */
  pct10y: number | null;
  /** Standard deviations from the five-year mean */
  z5y: number | null;
  min10y: number | null;
  max10y: number | null;
  /** Last five years, transformed and thinned to ≤ 72 points */
  spark: Obs;
  updatedAt: string;
}

export function summarize(def: MacroDef, raw: Obs, now = new Date().toISOString()): MacroSummary {
  const obs = transformed(def, raw);
  const r = readingOf(def, obs);
  const last = obs.at(-1)?.[0];
  const win = (years: number) => (last ? obs.filter((o) => o[0] >= monthsBefore(last, years * 12)).map((o) => o[1]) : []);
  const ten = win(10);
  const five = win(5);
  let pct10y: number | null = null;
  if (r.latest != null && ten.length > 8) pct10y = ten.filter((v) => v <= r.latest!).length / ten.length;
  let z5y: number | null = null;
  if (r.latest != null && five.length > 8) {
    const mean = five.reduce((s, v) => s + v, 0) / five.length;
    const sd = Math.sqrt(five.reduce((s, v) => s + (v - mean) ** 2, 0) / five.length);
    z5y = sd > 0 ? (r.latest - mean) / sd : 0;
  }
  const recent = last ? obs.filter((o) => o[0] >= monthsBefore(last, 60)) : [];
  const step = Math.max(1, Math.ceil(recent.length / 72));
  const spark = recent.filter((_, i) => i % step === 0 || i === recent.length - 1).map(([d, v]) => [d, Math.round(v * 1e4) / 1e4] as [string, number]);
  return {
    id: def.id,
    calculationVersion: 2,
    ...r,
    pct10y,
    z5y,
    min10y: ten.length ? Math.min(...ten) : null,
    max10y: ten.length ? Math.max(...ten) : null,
    spark,
    updatedAt: now,
  };
}

/** Older workers used observation counts across missing calendar months. */
export function preferCloudSummary(cloud: MacroSummary, bundled?: MacroSummary, frequency?: string) {
  if (!cloud.date || (bundled?.date && cloud.date < bundled.date)) return false;
  if (!bundled || (cloud.calculationVersion ?? 0) >= 2) return true;
  return frequency === "Daily" && !!bundled.date && cloud.date > bundled.date;
}

/** NBER recession bands from the USREC 0/1 series. */
export function recessionBands(obs: Obs) {
  const bands: { start: Date; end: Date }[] = [];
  let start: string | null = null;
  for (const [d, v] of obs) {
    if (v === 1 && !start) start = d;
    if (v === 0 && start) {
      bands.push({ start: new Date(start), end: new Date(d) });
      start = null;
    }
  }
  if (start) bands.push({ start: new Date(start), end: new Date() });
  return bands;
}
