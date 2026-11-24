// What the screener page needs on top of the engine: fields grouped by theme for the filter builder and
// column chooser, reading typed values back into filters, the effect of each filter on the result count,
// the CSV of exactly what the table shows, and a compact screen code for shareable links. Pure.
import { emptySpec, filterText, run, testFilter, type FieldDef, type Filter, type Op, type Row, type Spec } from "./engine";

export interface FieldGroup {
  id: string;
  n: string;
  fields: FieldDef[];
}

/** Catalogue fields grouped by the file's themes, in the file's order; identity fields and empty groups left out. */
export function fieldGroups(fields: FieldDef[], groups: { id: string; n: string }[]): FieldGroup[] {
  const out = groups
    .filter((g) => g.id !== "id")
    .map((g) => ({ id: g.id, n: g.n, fields: fields.filter((f) => f.g === g.id) }));
  const known = new Set(groups.map((g) => g.id));
  const rest = fields.filter((f) => !known.has(f.g) && f.g !== "id");
  if (rest.length) out.push({ id: "other", n: "Other", fields: rest });
  return out.filter((g) => g.fields.length);
}

/** Case-insensitive match on a field's name, id or definition. */
export function matchField(f: FieldDef, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return f.n.toLowerCase().includes(s) || f.id.toLowerCase().includes(s) || f.d.toLowerCase().includes(s);
}

/** The comparisons a person can pick for a field, with their labels. */
export function opsFor(f: FieldDef): { op: Op; l: string }[] {
  if (f.u === "bool")
    return [
      { op: "true", l: "is yes" },
      { op: "false", l: "is no" },
    ];
  return [
    { op: ">", l: "above" },
    { op: "<", l: "below" },
    { op: "between", l: "between" },
    { op: "top", l: "top %" },
    { op: "bottom", l: "bottom %" },
    { op: "exists", l: "is reported" },
  ];
}

/** Unit hint shown next to a value box. */
export function inputUnit(f: FieldDef): string {
  if (f.u === "pct" || f.u === "pctl") return "%";
  if (f.u === "usd") return "$";
  if (f.u === "x") return "×";
  if (f.u === "days") return "days";
  return "";
}

/**
 * A typed value in the field's display unit read back as the stored value: percentages are typed as
 * percent ("15" means 15%), dollars and counts accept K/M/B/T suffixes (also "bn", "mn", "mm", "tn"), a
 * percentile may carry its ordinal ("20th"), days may carry "d" or "days", multiples "x". A leading plus,
 * a minus or a true minus, a trailing point ("15.") and a leading one (".5") are read as a person means
 * them. Returns null for anything that is not a number.
 */
export function parseInput(f: FieldDef, text: string): number | null {
  let t = text.trim().replace(/−/g, "-").replace(/[,\s$%×]/g, "").toLowerCase();
  if (f.u === "x") t = t.replace(/x$/, "");
  else if (f.u === "pctl") t = t.replace(/(st|nd|rd|th)$/, "");
  else if (f.u === "days") t = t.replace(/(days?|d)$/, "");
  const m = /^([-+]?)(\d+\.?\d*|\.\d+)(k|m|mm|mn|b|bn|t|tn)?$/.exec(t);
  if (!m) return null;
  let v = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  if (!Number.isFinite(v)) return null;
  const suf = m[3];
  if (suf) {
    if (f.u !== "usd" && f.u !== "num") return null;
    v *= { k: 1e3, m: 1e6, mm: 1e6, mn: 1e6, b: 1e9, bn: 1e9, t: 1e12, tn: 1e12 }[suf as "k"];
  }
  if (f.u === "pct" || f.u === "pctl") v /= 100;
  return v;
}

/** Shortest decimal that reads back as exactly `v` (no float noise such as 0.30000000000000004). */
const exact = (v: number) => {
  for (let p = 1; p <= 17; p++) {
    const s = String(Number(v.toPrecision(p)));
    if (Number(s) === v) return s;
  }
  return String(v);
};

/**
 * A stored value written the way parseInput reads it back, without changing it: dollars take a T/B/M
 * suffix only when the scaled figure has at most three decimals, else the whole number with thousands
 * separators; percentages are written in percent to as many digits as they hold.
 */
export function formatInput(f: FieldDef, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (f.u === "pct" || f.u === "pctl") {
    const p = exact(v * 100);
    return parseInput(f, p) === v ? p : String(v * 100);
  }
  if (f.u === "usd") {
    const a = Math.abs(v);
    const s = v < 0 ? "-" : "";
    for (const [div, suf] of [[1e12, "T"], [1e9, "B"], [1e6, "M"]] as const) {
      if (a < div) continue;
      const scaled = exact(a / div);
      const dec = scaled.split(".")[1]?.length ?? 0;
      if (dec <= 3 && parseInput(f, `${s}${scaled}${suf}`) === v) return `${s}${scaled}${suf}`;
    }
    const whole = exact(v);
    return Number.isInteger(v) && Math.abs(v) < 1e21 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : whole;
  }
  return exact(v);
}

/** A filter from the builder's inputs, or the reason it cannot be made. */
export function buildFilter(
  f: FieldDef,
  op: Op,
  a: string,
  b = "",
  scope: Filter["scope"] = "all",
): { filter: Filter } | { error: string } {
  if (op === "true" || op === "false" || op === "exists") return { filter: { field: f.id, op } };
  if (op === "top" || op === "bottom") {
    const p = Number(a.replace(/[%\s]/g, ""));
    if (!Number.isFinite(p) || p <= 0 || p > 100) return { error: "Enter a share between 0 and 100" };
    return { filter: { field: f.id, op, pct: p, scope } };
  }
  if (op === "between") {
    const lo = a.trim() ? parseInput(f, a) : null;
    const hi = b.trim() ? parseInput(f, b) : null;
    if ((a.trim() && lo == null) || (b.trim() && hi == null) || (lo == null && hi == null))
      return { error: "Enter a low value, a high value, or both" };
    return { filter: { field: f.id, op, value: lo != null && hi != null && lo > hi ? [hi, lo] : [lo, hi] } };
  }
  const v = parseInput(f, a);
  if (v == null) return { error: "Enter a number" };
  return { filter: { field: f.id, op, value: v } };
}

export interface FilterImpact {
  /** index of the filter in the spec */
  i: number;
  text: string;
  /** companies in the universe passing this filter on its own */
  alone: number;
  /** companies the screen would return without this filter */
  without: number;
}

/** For each filter: how many pass it alone and how many the screen returns without it (what to change when nothing passes). */
export function filterImpact(all: Row[], spec: Spec, F: Map<string, FieldDef>, q = ""): FilterImpact[] {
  // Counts include the find text, so "brings back" never promises rows the search still hides (review M11).
  const base = { ...spec, similar_to: null, limit: null, sort: null };
  const uni = run(all, { ...base, filters: [] }, F, q).rows;
  return spec.filters.map((f, i) => {
    const alone =
      f.op === "top" || f.op === "bottom"
        ? run(all, { ...base, filters: [f] }, F, q).rows.length
        : uni.reduce((n, r) => n + (testFilter(f, r[f.field]) ? 1 : 0), 0);
    const without = run(all, { ...base, filters: spec.filters.filter((_, k) => k !== i) }, F, q).rows.length;
    return { i, text: filterText(f, F), alone, without };
  });
}

/** How many companies the find text matches with no filters (0 means the search alone empties the list). */
export const searchAlone = (all: Row[], spec: Spec, F: Map<string, FieldDef>, q: string) =>
  run(all, { ...spec, filters: [], similar_to: null, limit: null, sort: null }, F, q).rows.length;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Column header for the CSV: the field name with its unit, so the numbers read without the screen. */
export function csvHeader(f: FieldDef): string {
  const unit = f.u === "pct" ? "%" : f.u === "pctl" ? "percentile, 0 to 100" : f.u === "usd" ? "USD" : f.u === "x" ? "×" : f.u === "days" ? "days" : "";
  return unit ? `${f.n} (${unit})` : f.n;
}

/** A value for the CSV in the header's unit, full precision (percent as 15.2, not 0.152). */
export function csvValue(f: FieldDef | undefined, v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const x = f && (f.u === "pct" || f.u === "pctl") ? v * 100 : v;
  return String(+x.toPrecision(12));
}

/**
 * The CSV of exactly what the table shows: the same rows in the same order (and group, when grouped),
 * the company column as ticker and name, then the visible columns in order.
 */
export function toCsv(
  rows: Row[],
  cols: string[],
  F: Map<string, FieldDef>,
  opts: { sim?: Map<string, number> | null; groupOf?: (r: Row) => string; groupLabel?: string } = {},
): string {
  const head = [
    ...(opts.groupOf ? [opts.groupLabel ?? "Group"] : []),
    "Ticker",
    "Company",
    ...(opts.sim ? ["Distance"] : []),
    ...cols.map((id) => (F.has(id) ? csvHeader(F.get(id)!) : id)),
  ];
  const lines = rows.map((r) =>
    [
      ...(opts.groupOf ? [opts.groupOf(r)] : []),
      r.ticker,
      r.name,
      ...(opts.sim ? [opts.sim.get(r.ticker)?.toFixed(4) ?? ""] : []),
      ...cols.map((id) => csvValue(F.get(id), r[id])),
    ]
      .map((x) => csvCell(String(x)))
      .join(","),
  );
  return [head.map(csvCell).join(","), ...lines].join("\n");
}

/* ---------- shareable screen code ---------- */
const KEEP: (keyof Spec)[] = ["filters", "sectors", "exclude_sectors", "industries", "exclude_industries", "index", "tickers", "exclude_tickers", "similar_to", "sort", "columns", "group_by", "limit"];

/** A screen as a URL-safe code (base64url of compact JSON; explanation text is left out). */
export function encodeSpec(spec: Spec): string {
  const empty = emptySpec();
  const o: Record<string, unknown> = {};
  for (const k of KEEP) if (JSON.stringify(spec[k]) !== JSON.stringify(empty[k])) o[k] = spec[k];
  const json = JSON.stringify(o);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Longest screen code a shared link carries; longer codes are refused when copying and ignored when opening. */
export const SHARE_MAX = 8000;

/**
 * Route search for the screener. Never throws: the router parses `?screen=123` as a number and
 * `?screen={"a":1}` as an object, so every value is turned back into text and judged inside the page.
 */
export function screenSearch(s: Record<string, unknown>): { screen?: string } {
  const v = s.screen;
  if (v === undefined || v === null || v === "") return {};
  if (typeof v === "string") return { screen: v };
  if (typeof v === "number" || typeof v === "boolean") return { screen: String(v) };
  try {
    return { screen: JSON.stringify(v) ?? "" };
  } catch {
    return { screen: "" };
  }
}

/** What opening a shared code should do: adopt the decoded object, or reset with a one-line reason. */
export function readShared(code: string): { ok: true; raw: Record<string, unknown> } | { ok: false; notice: string } {
  if (code.length > SHARE_MAX)
    return { ok: false, notice: `This shared link is too long to open (${code.length.toLocaleString()} characters); showing the default screen.` };
  const raw = decodeSpec(code);
  if (!raw) return { ok: false, notice: "This shared link could not be read; showing the default screen." };
  return { ok: true, raw: raw as Record<string, unknown> };
}

/** The raw object inside a screen code, or null when it is not one (validate it before use). */
export function decodeSpec(code: string): unknown {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const o = JSON.parse(json);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Whether a screen narrows the universe at all (used to show the clear button and the impact panel). */
export const isActive = (s: Spec) =>
  s.filters.length > 0 || s.sectors.length > 0 || s.exclude_sectors.length > 0 || s.industries.length > 0 || s.exclude_industries.length > 0 || s.tickers.length > 0 || s.exclude_tickers.length > 0 || !!s.similar_to || s.index !== "all";

/**
 * The part of a screen that can run now: filters (and the sort) on fields the catalogue does not hold at the
 * moment (a liquidity field while its series is late or failed, a field the file dropped) are set aside, so
 * they show as "unavailable, not applied" instead of failing every row (review M8). `missing` lists their indexes.
 */
export function applicable(spec: Spec, F: Map<string, FieldDef>): { spec: Spec; missing: number[] } {
  const missing = spec.filters.flatMap((f, i) => (F.has(f.field) ? [] : [i]));
  const sortOk = !spec.sort || F.has(spec.sort.field);
  if (!missing.length && sortOk) return { spec, missing };
  return { spec: { ...spec, filters: spec.filters.filter((f) => F.has(f.field)), sort: sortOk ? spec.sort : null }, missing };
}
