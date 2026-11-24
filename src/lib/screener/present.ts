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
 * percent ("15" means 15%), dollars accept K/M/B/T suffixes, a leading minus or true minus is negative.
 * Returns null for anything that is not a number.
 */
export function parseInput(f: FieldDef, text: string): number | null {
  let t = text.trim().replace(/−/g, "-").replace(/[,\s$%×]/g, "");
  if (f.u === "x") t = t.replace(/x$/i, "");
  const m = /^(-?\d*\.?\d+)([kmbt])?$/i.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const suf = m[2]?.toLowerCase();
  if (suf) {
    if (f.u !== "usd" && f.u !== "num") return null;
    v *= { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[suf as "k" | "m" | "b" | "t"];
  }
  if (f.u === "pct" || f.u === "pctl") v /= 100;
  return v;
}

/** A stored value written the way parseInput reads it back. */
export function formatInput(f: FieldDef, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (f.u === "pct" || f.u === "pctl") return String(+(v * 100).toFixed(4));
  if (f.u === "usd") {
    const a = Math.abs(v);
    const s = v < 0 ? "-" : "";
    if (a >= 1e12) return `${s}${+(a / 1e12).toFixed(3)}T`;
    if (a >= 1e9) return `${s}${+(a / 1e9).toFixed(3)}B`;
    if (a >= 1e6) return `${s}${+(a / 1e6).toFixed(3)}M`;
    return String(+v.toFixed(2));
  }
  return String(+v.toFixed(4));
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
export function filterImpact(all: Row[], spec: Spec, F: Map<string, FieldDef>): FilterImpact[] {
  const base = { ...spec, similar_to: null, limit: null, sort: null };
  const uni = run(all, { ...base, filters: [] }, F).uni;
  return spec.filters.map((f, i) => {
    const alone =
      f.op === "top" || f.op === "bottom"
        ? run(all, { ...base, filters: [f] }, F).rows.length
        : uni.reduce((n, r) => n + (testFilter(f, r[f.field]) ? 1 : 0), 0);
    const without = run(all, { ...base, filters: spec.filters.filter((_, k) => k !== i) }, F).rows.length;
    return { i, text: filterText(f, F), alone, without };
  });
}

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
