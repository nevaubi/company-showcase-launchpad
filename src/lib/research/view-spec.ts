// View specs the assistant renders into its canvas: schema (zod), semantic validation, one automatic
// repair pass for common model mistakes, a post-render self-check, and the data table behind each view.
import { z } from "zod";

const num = z.number().finite();
const cell = z.union([z.string().max(400), num, z.null()]);
const label = z.string().min(1).max(80);
const txt = (n: number) => z.string().max(n).optional();

export const UNITS = ["$", "%", "x", "bp", ""] as const;
const unit = z.enum(UNITS).optional();

/** Reference lines, labelled points and shaded ranges, for any chart with axes. */
const Annotations = z
  .object({
    lines: z.array(z.object({ axis: z.enum(["x", "y"]).default("y"), value: z.union([num, z.string().max(40)]), label: txt(60) })).max(8).optional(),
    points: z.array(z.object({ x: z.union([num, z.string().max(40)]), y: num, label: z.string().min(1).max(60) })).max(12).optional(),
    ranges: z.array(z.object({ axis: z.enum(["x", "y"]).default("x"), from: z.union([num, z.string().max(40)]), to: z.union([num, z.string().max(40)]), label: txt(60) })).max(6).optional(),
  })
  .optional();

/** Common to every view: Datawrapper-style title block and source line, grid span. */
const Base = {
  title: txt(120),
  subtitle: txt(240),
  source: txt(240),
  span: z.number().int().min(1).max(4).optional(),
};

const Kpi = z.object({ label: z.string().min(1).max(60), value: z.union([z.string().max(40), num]), unit, delta: num.nullable().optional(), note: txt(120) });

const Leaf = [
  z.object({ type: z.literal("kpis"), ...Base, items: z.array(Kpi).min(1).max(12) }),
  z.object({
    type: z.literal("chart"),
    ...Base,
    chart: z.enum(["line", "bar", "area", "combo", "stacked", "stacked100"]),
    unit,
    x: z.string().min(1).max(40),
    series: z.array(z.string().min(1).max(40)).min(1).max(8),
    /** combo: series drawn as lines on the right axis (the rest are bars on the left). */
    lineSeries: z.array(z.string().min(1).max(40)).max(4).optional(),
    rightUnit: unit,
    data: z.array(z.record(z.string(), cell)).min(1).max(500),
    annotations: Annotations,
  }),
  z.object({
    type: z.literal("hbar"),
    ...Base,
    unit,
    items: z.array(z.object({ label, value: num, note: txt(60) })).min(1).max(40),
    sort: z.enum(["desc", "asc", "none"]).optional(),
    highlight: z.array(z.string().max(80)).max(6).optional(),
    annotations: Annotations,
  }),
  z.object({
    type: z.literal("scatter"),
    ...Base,
    xLabel: z.string().min(1).max(60),
    yLabel: z.string().min(1).max(60),
    xUnit: unit,
    yUnit: unit,
    points: z.array(z.object({ x: num, y: num, label: txt(40), size: num.positive().optional(), group: txt(40) })).min(2).max(600),
    regression: z.boolean().optional(),
    annotations: Annotations,
  }),
  z.object({ type: z.literal("histogram"), ...Base, unit, values: z.array(num).min(3).max(20000), bins: z.number().int().min(3).max(80).optional(), annotations: Annotations }),
  z.object({
    type: z.literal("heatmap"),
    ...Base,
    unit,
    rows: z.array(z.string().min(1).max(40)).min(1).max(40),
    cols: z.array(z.string().min(1).max(40)).min(1).max(40),
    values: z.array(z.array(num.nullable())).min(1).max(40),
    diverging: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("waterfall"),
    ...Base,
    unit,
    steps: z.array(z.object({ label, value: num, total: z.boolean().optional() })).min(2).max(30),
  }),
  z.object({
    type: z.literal("sparktable"),
    ...Base,
    columns: z
      .array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(60), kind: z.enum(["text", "num", "$", "%", "x", "spark", "delta"]).default("num") }))
      .min(1)
      .max(12),
    rows: z.array(z.record(z.string(), z.union([cell, z.array(num.nullable()).max(400)]))).min(1).max(200),
  }),
  z.object({
    type: z.literal("candles"),
    ...Base,
    unit,
    bars: z
      .array(z.object({ t: z.string().min(4).max(30), o: num, h: num, l: num, c: num, v: num.nonnegative().nullable().optional() }))
      .min(2)
      .max(800),
    overlays: z.array(z.object({ name: z.string().min(1).max(40), values: z.array(num.nullable()) })).max(4).optional(),
    bands: z.array(z.object({ from: num, to: num, label: txt(60) })).max(8).optional(),
    events: z.array(z.object({ t: z.string().min(4).max(30), label: z.string().min(1).max(40) })).max(20).optional(),
  }),
  z.object({ type: z.literal("treemap"), ...Base, unit, items: z.array(z.object({ label, value: num.positive(), group: txt(40), change: num.nullable().optional() })).min(2).max(120) }),
  z.object({ type: z.literal("donut"), ...Base, unit, parts: z.array(z.object({ label, value: num.nonnegative() })).min(2).max(6) }),
  z.object({
    type: z.literal("multiples"),
    ...Base,
    chart: z.enum(["line", "bar", "area"]),
    unit,
    sharedY: z.boolean().optional(),
    items: z.array(z.object({ title: z.string().min(1).max(60), data: z.array(z.object({ x: z.union([z.string().max(30), num]), y: num.nullable() })).min(1).max(300) })).min(2).max(16),
  }),
  z.object({
    type: z.literal("timeline"),
    ...Base,
    events: z.array(z.object({ date: z.string().min(4).max(30), label: z.string().min(1).max(100), detail: txt(240), tone: z.enum(["positive", "negative", "neutral"]).optional() })).min(1).max(60),
  }),
  z.object({
    type: z.literal("cards"),
    ...Base,
    items: z.array(z.object({ title: z.string().min(1).max(60), subtitle: txt(80), metrics: z.array(Kpi).min(1).max(8) })).min(2).max(4),
  }),
  z.object({ type: z.literal("mermaid"), ...Base, code: z.string().min(8).max(8000) }),
  z.object({
    type: z.literal("graph"),
    ...Base,
    nodes: z.array(z.object({ id: z.string().min(1).max(40), label: txt(60), group: txt(40) })).min(2).max(80),
    edges: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: txt(40), weight: num.positive().optional() })).min(1).max(200),
    directed: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("table"),
    ...Base,
    columns: z.array(z.string().min(1).max(60)).min(1).max(16),
    rows: z.array(z.array(cell)).min(1).max(300),
  }),
  z.object({ type: z.literal("note"), ...Base, markdown: z.string().min(1).max(12000) }),
  z.object({ type: z.literal("code"), ...Base, code: z.string().max(12000), stdout: txt(20000), result: txt(20000), error: txt(4000) }),
  z.object({ type: z.literal("image"), ...Base, src: z.string().url().max(4000), caption: txt(300) }),
  z.object({ type: z.literal("file"), ...Base, fileId: z.string().min(1).max(80) }),
] as const;

export const LeafSchema = z.discriminatedUnion("type", [...Leaf]);
export type LeafSpec = z.infer<typeof LeafSchema>;

const Section = z.object({
  heading: txt(120),
  columns: z.number().int().min(1).max(4).default(2),
  items: z.array(LeafSchema).min(1).max(16),
});
export type DashSection = z.infer<typeof Section>;

const Dashboard = z.object({
  type: z.literal("dashboard"),
  ...Base,
  sections: z.array(Section).max(8).optional(),
  tabs: z.array(z.object({ label: z.string().min(1).max(40), sections: z.array(Section).min(1).max(8) })).min(2).max(6).optional(),
});

export const ViewSpecSchema = z.discriminatedUnion("type", [...Leaf, Dashboard]);
export type ViewSpec = z.infer<typeof ViewSpecSchema>;
export type ViewType = ViewSpec["type"];

export const VIEW_TYPES: ViewType[] = [
  "kpis", "chart", "hbar", "scatter", "histogram", "heatmap", "waterfall", "sparktable", "candles", "treemap", "donut", "multiples",
  "timeline", "cards", "mermaid", "graph", "table", "note", "code", "image", "file", "dashboard",
];

type Result = { ok: true; spec: ViewSpec } | { ok: false; error: string; hint?: string };

const HINTS: Partial<Record<ViewType, string>> = {
  chart: 'chart needs x (a key in every data row) and series (numeric keys), e.g. {"type":"chart","chart":"line","x":"period","series":["NVDA"],"data":[{"period":"FY24","NVDA":60.9e9}]}',
  hbar: 'hbar needs items [{"label":"NVDA","value":0.25}]',
  scatter: 'scatter needs xLabel, yLabel and points [{"x":1,"y":2,"label":"NVDA"}]',
  heatmap: "heatmap needs rows, cols and values as rows.length arrays of cols.length numbers (null for blanks)",
  waterfall: 'waterfall needs steps [{"label":"Start","value":100,"total":true},{"label":"Price","value":12}]',
  sparktable: 'sparktable needs columns [{"key":"t","label":"Ticker","kind":"text"},{"key":"px","label":"1Y","kind":"spark"}] and rows keyed by those keys',
  candles: 'candles needs bars [{"t":"2026-11-02","o":1,"h":2,"l":0.5,"c":1.5,"v":1000}]',
  donut: "donut takes 2-6 parts; use hbar or treemap for more",
  table: "table rows must each have columns.length cells",
  dashboard: "dashboard takes sections [{heading, columns 1-4, items:[view specs with optional span]}] or tabs [{label, sections}]",
};

function semantic(s: ViewSpec): string | null {
  const sections = (sp: ViewSpec): DashSection[] => (sp.type === "dashboard" ? [...(sp.sections ?? []), ...(sp.tabs ?? []).flatMap((t) => t.sections)] : []);
  switch (s.type) {
    case "chart": {
      const keys = new Set(s.data.flatMap((d) => Object.keys(d)));
      const missing = [s.x, ...s.series, ...(s.lineSeries ?? [])].filter((k) => !keys.has(k));
      if (missing.length) return `chart data has no field(s): ${missing.join(", ")}`;
      const bad = (s.lineSeries ?? []).filter((k) => !s.series.includes(k));
      if (bad.length) return `lineSeries must also be listed in series: ${bad.join(", ")}`;
      if (s.chart === "combo" && !(s.lineSeries ?? []).length) return "combo charts need lineSeries (the series drawn as lines on the right axis)";
      const numeric = s.series.filter((k) => s.data.some((d) => typeof d[k] === "number"));
      if (!numeric.length) return "no numeric values in any series";
      return null;
    }
    case "table":
      return s.rows.some((r) => r.length !== s.columns.length) ? `every table row must have ${s.columns.length} cells` : null;
    case "heatmap":
      if (s.values.length !== s.rows.length) return `heatmap values has ${s.values.length} rows; rows has ${s.rows.length}`;
      return s.values.some((r) => r.length !== s.cols.length) ? `every heatmap values row must have ${s.cols.length} numbers` : null;
    case "candles": {
      const bad = s.bars.findIndex((b) => b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c));
      if (bad >= 0) return `bar ${bad + 1} has high/low outside open/close`;
      const o = (s.overlays ?? []).find((x) => x.values.length !== s.bars.length);
      return o ? `overlay ${o.name} has ${o.values.length} values; bars has ${s.bars.length}` : null;
    }
    case "sparktable": {
      const keys = s.columns.map((c) => c.key);
      const missing = keys.filter((k) => !s.rows.some((r) => k in r));
      return missing.length ? `no row has column key(s): ${missing.join(", ")}` : null;
    }
    case "graph": {
      const ids = new Set(s.nodes.map((n) => n.id));
      const e = s.edges.find((x) => !ids.has(x.from) || !ids.has(x.to));
      return e ? `edge ${e.from}→${e.to} points at an unknown node` : null;
    }
    case "donut":
      return s.parts.every((p) => p.value === 0) ? "donut parts are all zero" : null;
    case "dashboard": {
      if (!s.sections?.length && !s.tabs?.length) return "dashboard needs sections or tabs";
      for (const sec of sections(s)) {
        const wide = sec.items.find((it) => (it.span ?? 1) > sec.columns);
        if (wide) return `an item spans ${wide.span} columns in a ${sec.columns}-column section`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Validate a render_view spec. Returns a short error and a fix hint for the model on failure. */
export function parseViewSpec(input: unknown): Result {
  const r = ViewSpecSchema.safeParse(input);
  const t = (input as { type?: unknown } | null)?.type as ViewType | undefined;
  if (r.success) {
    const err = semantic(r.data);
    return err ? { ok: false, error: err, hint: HINTS[r.data.type] } : { ok: true, spec: r.data };
  }
  const issue = r.error.issues[0];
  if (issue?.code === "invalid_union_discriminator") return { ok: false, error: `unknown view type ${JSON.stringify(t)}; use one of ${VIEW_TYPES.join(", ")}` };
  return { ok: false, error: `${issue?.path.join(".") || "spec"}: ${issue?.message ?? "invalid"}`, hint: t ? HINTS[t] : undefined };
}

// ── One automatic repair pass for common model mistakes ──

/** "$1.2B", "12.5%", "1,234", "3.4x" → number (percent → fraction only when unit is %). */
export function coerceNumber(v: unknown): number | null | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return v as null | undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/,/g, "");
  const m = s.match(/^\(?(-)?\$?\s*(-?\d+(?:\.\d+)?)\s*([kmbt%x]|bn|mm)?\)?$/i);
  if (!m) return undefined;
  let n = Number(m[2]) * (m[1] || /^\(.*\)$/.test(s) ? -1 : 1);
  const suf = (m[3] ?? "").toLowerCase();
  n *= suf === "k" ? 1e3 : suf === "m" || suf === "mm" ? 1e6 : suf === "b" || suf === "bn" ? 1e9 : suf === "t" ? 1e12 : 1;
  if (suf === "%") n /= 100;
  return n;
}

const ALIAS: Record<string, string> = { column: "bar", columns: "bar", pie: "donut", bars: "bar", lines: "line", stacked_bar: "stacked", "stacked-bar": "stacked", bubble: "scatter", ohlc: "candles", candlestick: "candles", calendar: "heatmap", bridge: "waterfall", flowchart: "mermaid", diagram: "mermaid", network: "graph" };

/** Best-effort fix of a rejected spec. Returns the fixed spec and what was changed, or null. */
export function repairViewSpec(input: unknown): { spec: unknown; changes: string[] } | null {
  if (!input || typeof input !== "object") return null;
  const s = structuredClone(input) as Record<string, unknown>;
  const changes: string[] = [];
  const type = String(s.type ?? "");
  if (ALIAS[type]) {
    if (["bar", "line", "area", "stacked"].includes(ALIAS[type])) {
      s.chart = ALIAS[type];
      s.type = "chart";
    } else s.type = ALIAS[type];
    changes.push(`type ${type} → ${s.type}`);
  }
  if (s.type === "chart" && typeof s.chart === "string" && ALIAS[s.chart] && ["bar", "line", "area", "stacked"].includes(ALIAS[s.chart])) {
    changes.push(`chart ${s.chart} → ${ALIAS[s.chart]}`);
    s.chart = ALIAS[s.chart];
  }
  if (s.type === "chart") {
    if (!s.chart) {
      s.chart = "line";
      changes.push("chart defaulted to line");
    }
    const data = Array.isArray(s.data) ? (s.data as Record<string, unknown>[]) : [];
    if (data.length) {
      const keys = Object.keys(data[0] ?? {});
      if (typeof s.x !== "string" || !keys.includes(s.x)) {
        const x = keys.find((k) => typeof data[0][k] === "string") ?? keys[0];
        if (x) {
          s.x = x;
          changes.push(`x set to ${x}`);
        }
      }
      for (const row of data)
        for (const k of Object.keys(row)) {
          if (k === s.x) continue;
          const n = coerceNumber(row[k]);
          if (typeof row[k] === "string" && n !== undefined) {
            row[k] = n;
            if (!changes.includes("numeric strings converted")) changes.push("numeric strings converted");
          }
        }
      const series = Array.isArray(s.series) ? (s.series as string[]).filter((k) => keys.includes(k)) : [];
      if (!series.length) {
        s.series = keys.filter((k) => k !== s.x && data.some((d) => typeof d[k] === "number")).slice(0, 8);
        changes.push(`series inferred: ${(s.series as string[]).join(", ")}`);
      } else if (series.length !== (s.series as string[]).length) {
        s.series = series;
        changes.push("unknown series dropped");
      }
      if (s.chart === "combo" && !(Array.isArray(s.lineSeries) && s.lineSeries.length) && (s.series as string[]).length > 1) {
        s.lineSeries = [(s.series as string[])[(s.series as string[]).length - 1]];
        changes.push(`lineSeries set to ${(s.lineSeries as string[])[0]}`);
      }
    }
  }
  if (s.type === "donut" && Array.isArray(s.parts) && s.parts.length > 6) {
    s.type = "hbar";
    s.items = s.parts;
    delete s.parts;
    changes.push("donut with more than 6 parts → hbar");
  }
  for (const key of ["items", "parts", "steps"]) {
    const arr = s[key];
    if (Array.isArray(arr))
      for (const it of arr as Record<string, unknown>[]) {
        if (it && typeof it === "object" && typeof it.value === "string") {
          const n = coerceNumber(it.value);
          if (n != null && !(s.type === "kpis" || s.type === "cards")) {
            it.value = n;
            if (!changes.includes(`${key} values converted to numbers`)) changes.push(`${key} values converted to numbers`);
          }
        }
        if (it && typeof it === "object" && it.label == null && typeof it.name === "string") {
          it.label = it.name;
          delete it.name;
          if (!changes.includes("name → label")) changes.push("name → label");
        }
      }
  }
  if (s.type === "table" && Array.isArray(s.rows) && Array.isArray(s.columns)) {
    const n = (s.columns as unknown[]).length;
    const rows = s.rows as unknown[];
    if (rows.length && rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      s.rows = rows.map((r) => (s.columns as string[]).map((c) => ((r as Record<string, unknown>)[c] ?? null) as unknown));
      changes.push("row objects converted to arrays");
    } else
      s.rows = rows.map((r) => {
        if (!Array.isArray(r)) return r;
        if (r.length === n) return r;
        if (!changes.includes("ragged rows padded")) changes.push("ragged rows padded");
        return [...r, ...Array(Math.max(0, n - r.length)).fill(null)].slice(0, n);
      });
  }
  return changes.length ? { spec: s, changes } : null;
}

/** Validate; if rejected, try one repair and validate again. */
export function parseOrRepair(input: unknown): Result & { repaired?: string[] } {
  const first = parseViewSpec(input);
  if (first.ok) return first;
  const fix = repairViewSpec(input);
  if (!fix) return first;
  const second = parseViewSpec(fix.spec);
  return second.ok ? { ...second, repaired: fix.changes } : first;
}

// ── Self-check after render ──

const finiteNums = (xs: unknown[]) => xs.filter((v) => typeof v === "number" && Number.isFinite(v)).length;

/** Problems a reader would notice: empty series, NaN, labels too long to show, too many points. */
export function checkView(s: ViewSpec): string[] {
  const out: string[] = [];
  const longLabels = (xs: string[], max: number, what: string) => {
    const n = xs.filter((x) => x.length > max).length;
    if (n) out.push(`${n} ${what} longer than ${max} characters will be truncated; shorten them`);
  };
  switch (s.type) {
    case "chart":
      for (const k of s.series) if (!finiteNums(s.data.map((d) => d[k]))) out.push(`series ${k} has no numeric values`);
      if (s.data.some((d) => s.series.some((k) => typeof d[k] === "string"))) out.push("some series values are strings, not numbers");
      longLabels(s.data.map((d) => String(d[s.x] ?? "")), 18, "x labels");
      if (s.chart === "stacked100" && s.data.some((d) => s.series.some((k) => typeof d[k] === "number" && (d[k] as number) < 0))) out.push("100% stacked bars can't show negative values");
      break;
    case "hbar":
      longLabels(s.items.map((i) => i.label), 32, "bar labels");
      break;
    case "scatter":
      if (new Set(s.points.map((p) => `${p.x},${p.y}`)).size < 2) out.push("all points sit on one spot");
      break;
    case "heatmap":
      if (!finiteNums(s.values.flat())) out.push("heatmap has no numeric cells");
      break;
    case "multiples":
      for (const it of s.items) if (!finiteNums(it.data.map((d) => d.y))) out.push(`small multiple ${it.title} has no values`);
      break;
    case "sparktable":
      for (const c of s.columns.filter((c) => c.kind === "spark"))
        if (s.rows.every((r) => !Array.isArray(r[c.key]) || finiteNums(r[c.key] as unknown[]) < 2)) out.push(`sparkline column ${c.label} has fewer than 2 points per row`);
      break;
    case "donut":
      longLabels(s.parts.map((p) => p.label), 28, "slice labels");
      break;
    case "dashboard":
      for (const sec of [...(s.sections ?? []), ...(s.tabs ?? []).flatMap((t) => t.sections)]) for (const it of sec.items) out.push(...checkView(it).map((p) => `${it.title ?? it.type}: ${p}`));
      break;
    default:
      break;
  }
  if (s.title && s.title.length > 90) out.push("title is long; keep it under 90 characters");
  return out;
}

// ── The data behind a view, for the accessible data-table toggle ──

export function tableOf(s: LeafSpec): { columns: string[]; rows: (string | number | null)[][] } | null {
  switch (s.type) {
    case "chart":
      return { columns: [s.x, ...s.series], rows: s.data.map((d) => [d[s.x] ?? null, ...s.series.map((k) => (d[k] as number | null) ?? null)]) };
    case "hbar":
      return { columns: ["Label", "Value"], rows: s.items.map((i) => [i.label, i.value]) };
    case "scatter":
      return { columns: ["Label", s.xLabel, s.yLabel, ...(s.points.some((p) => p.size != null) ? ["Size"] : [])], rows: s.points.map((p) => [p.label ?? null, p.x, p.y, ...(s.points.some((q) => q.size != null) ? [p.size ?? null] : [])]) };
    case "histogram":
      return { columns: ["Value"], rows: s.values.slice(0, 500).map((v) => [v]) };
    case "heatmap":
      return { columns: ["", ...s.cols], rows: s.rows.map((r, i) => [r, ...(s.values[i] ?? [])]) };
    case "waterfall":
      return { columns: ["Step", "Value", "Total"], rows: s.steps.map((x) => [x.label, x.value, x.total ? "yes" : null]) };
    case "candles":
      return { columns: ["Date", "Open", "High", "Low", "Close", "Volume"], rows: s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v ?? null]) };
    case "treemap":
      return { columns: ["Label", "Group", "Value", "Change"], rows: s.items.map((i) => [i.label, i.group ?? null, i.value, i.change ?? null]) };
    case "donut":
      return { columns: ["Part", "Value"], rows: s.parts.map((p) => [p.label, p.value]) };
    case "multiples":
      return { columns: ["Item", "x", "y"], rows: s.items.flatMap((it) => it.data.map((d) => [it.title, d.x, d.y])) };
    case "timeline":
      return { columns: ["Date", "Event", "Detail"], rows: s.events.map((e) => [e.date, e.label, e.detail ?? null]) };
    case "graph":
      return { columns: ["From", "To", "Label", "Weight"], rows: s.edges.map((e) => [e.from, e.to, e.label ?? null, e.weight ?? null]) };
    case "sparktable":
      return { columns: s.columns.map((c) => c.label), rows: s.rows.map((r) => s.columns.map((c) => (Array.isArray(r[c.key]) ? (r[c.key] as (number | null)[]).filter((v) => v != null).slice(-1)[0] ?? null : ((r[c.key] as string | number | null) ?? null)))) };
    default:
      return null;
  }
}

/** Short description of a spec for the tool timeline: icon key + title. */
export function viewLabel(raw: unknown): { type: string; title: string } {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { type: "view", title: "" };
    }
  }
  const o = (v ?? {}) as { type?: string; chart?: string; title?: string };
  const type = o.type === "chart" && o.chart ? o.chart : (o.type ?? "view");
  return { type, title: o.title ?? "" };
}
