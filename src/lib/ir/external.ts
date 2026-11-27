// Converts the partner corpus's IR rows (kpi_definitions, kpi_values, ir_documents) into the IR
// page payload. Pure: no network, shared by the server function and tests.
import type { IrPayload, PayloadCell, PayloadCheck, PayloadDoc, PayloadGroup, PayloadPart, PayloadSeries } from "@/lib/ir/payload";
import { guardedSourceOf, hasGuardedSources } from "@/lib/ir/source-guard";

export interface ExtDef {
  kpi_id: string;
  name: string;
  category: string | null;
  unit: string | null;
  parent_id: string | null;
  sums_to_parent: boolean;
  sort: number | null;
}
export interface ExtValue {
  kpi_id: string;
  period_kind: "Q" | "A" | "I" | "Y" | "T";
  period_end: string;
  fiscal_label: string | null;
  value: number | string;
  source_id: string;
  source_kind?: string;
  anchor: { cell?: string | null; name?: string | null; id?: string | null; quote?: string | null; page?: number | null; sheet?: string | null } | null;
  derived: { formula?: string; inputs?: { kind: string; period_end: string }[] } | null;
}
export interface ExtDoc {
  id: string;
  url: string;
  title: string | null;
  doc_type: string | null;
  published: string | null;
  /** Stored copy in the pipeline's document store: file extension, original and extracted text object paths */
  ext?: string | null;
  storage_path?: string | null;
  text_path?: string | null;
  pages?: number | null;
}

/** Ids of documents served from the partner corpus carry this prefix. */
export const EXT_PREFIX = "x:";

export function mapUnit(u: string | null, label = ""): string {
  switch (u?.trim()) {
    case "USD":
      return "usd";
    case "USD_per_unit":
      return /per (?:common |diluted |ordinary )?share/i.test(label) ? "usdPerShare" : "usdPerUnit";
    case "USD_per_share":
      return "usdPerShare";
    case "%":
      return "pct";
    case "bp":
    case "bps":
      return "bps";
    case "x":
      return "ratio";
    default:
      return u?.trim() || "other";
  }
}

const monthsOf = (kind: string) => (kind === "A" ? 12 : kind === "I" ? 0 : 3);
/** Where the quoted line is printed in the stored document: page (PDFs, decks) or worksheet. */
const placeOf = (v: ExtValue) => ({
  ...(v.anchor?.quote ? { x: v.anchor.quote } : {}),
  ...(typeof v.anchor?.page === "number" && v.anchor.page > 0 ? { p: v.anchor.page } : {}),
  ...(v.anchor?.sheet ? { sh: v.anchor.sheet } : {}),
  ...(v.anchor?.sheet && v.anchor.cell && /^[A-Z]{1,3}[1-9]\d{0,6}$/i.test(v.anchor.cell) ? { sheetCell: v.anchor.cell.toUpperCase() } : {}),
  ...(v.source_kind === "xbrl" && v.anchor?.name ? { ixConcept: v.anchor.name, ixId: v.anchor.id ?? undefined } : {}),
});
const secParts = (url: string) => {
  const m = url.match(/\/Archives\/edgar\/data\/\d+\/(\d{10})(\d{2})(\d{6})\/([^/?#]+)/);
  return m ? { accn: `${m[1]}-${m[2]}-${m[3]}`, doc: m[4] } : { accn: null, doc: null };
};

export function buildExternalPayload(ticker: string, defs: ExtDef[], allValues: ExtValue[], allDocs: ExtDoc[]): IrPayload {
  // Figures read from files the reviewed list shows to be another company's never reach the page.
  const refused = hasGuardedSources(ticker) ? new Set(allDocs.filter((d) => guardedSourceOf(ticker, d.url)).map((d) => d.id)) : new Set<string>();
  const docs = refused.size ? allDocs.filter((d) => !refused.has(d.id)) : allDocs;
  const allowed = refused.size ? allValues.filter((v) => !refused.has(v.source_id)) : allValues;
  // A balance at a date and a flow over a period are different observations even when their
  // vendor KPI id and end date match. Keep the original id for the flow and separate its stock.
  const instants = new Set(allowed.filter((v) => v.period_kind === "I").map((v) => v.kpi_id));
  const flows = new Set(allowed.filter((v) => v.period_kind === "Q" || v.period_kind === "A").map((v) => v.kpi_id));
  const reserved = new Set(defs.map((d) => d.kpi_id));
  const instantKey = new Map<string, string>();
  for (const id of instants) {
    let key = id;
    if (flows.has(id)) {
      do key += ":as-of"; while (reserved.has(key));
      reserved.add(key);
    }
    instantKey.set(id, key);
  }
  defs = defs.flatMap((d) => {
    const key = instantKey.get(d.kpi_id);
    if (!key) return [d];
    const parent = d.parent_id ? instantKey.get(d.parent_id) ?? null : null;
    const stock = { ...d, kpi_id: key, parent_id: parent,
      name: key === d.kpi_id ? d.name : `${d.name} (period end)` };
    return key === d.kpi_id ? [stock] : [d, stock];
  });
  const values = allowed.map((v) => v.period_kind === "I" && instantKey.get(v.kpi_id) !== v.kpi_id
    ? { ...v, kpi_id: instantKey.get(v.kpi_id)! } : v);
  const stockKeys = new Set(instantKey.values());
  const docIdx = new Map<string, number>();
  const outDocs: PayloadDoc[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const di = (id: string, kind?: string): number | undefined => {
    const hit = docIdx.get(id);
    if (hit != null) return hit;
    const d = docById.get(id);
    if (!d && !(kind === "xbrl" && /^\d{10}-\d{2}-\d{6}$/.test(id))) return undefined;
    if (!d) {
      outDocs.push({ id: `sec:${id}`, accn: id, doc: null, kind: "filing", filed: null });
      docIdx.set(id, outDocs.length - 1);
      return outDocs.length - 1;
    }
    const sec = secParts(d.url);
    outDocs.push({ id: `${EXT_PREFIX}${id}`, accn: sec.accn, doc: sec.doc, kind: d.doc_type, filed: d.published });
    docIdx.set(id, outDocs.length - 1);
    return outDocs.length - 1;
  };

  // Every printed/derived value by kpi|kind|end, so derived quarters can list their inputs.
  const all = new Map<string, ExtValue>();
  for (const v of values) all.set(`${v.kpi_id}|${v.period_kind}|${v.period_end}`, v);
  const defById = new Map(defs.map((d) => [d.kpi_id, d]));

  const cellOf = (v: ExtValue): PayloadCell => {
    const base: PayloadCell = { v: Number(v.value), e: v.period_end, m: monthsOf(v.period_kind) };
    if (v.derived?.inputs?.length) {
      const parts: PayloadPart[] = v.derived.inputs.flatMap((inp, i) => {
        const src = all.get(`${v.kpi_id}|${inp.kind}|${inp.period_end}`);
        if (!src) return [];
        const label = `${defById.get(v.kpi_id)?.name ?? v.kpi_id} (${src.fiscal_label ?? inp.period_end})`;
        return [{ label, v: Number(src.value), sign: (i === 0 ? 1 : -1) as 1 | -1, d: di(src.source_id, src.source_kind), ...placeOf(src), e: src.period_end, m: inp.kind === "A" ? 12 : inp.kind === "Q" ? 3 : 0 }];
      });
      if (parts.length) return { ...base, f: { formula: v.derived.formula ?? "derived", parts } };
    }
    return { ...base, d: di(v.source_id, v.source_kind), ...placeOf(v) };
  };

  const byKpi = new Map<string, { q: Record<string, PayloadCell>; y: Record<string, PayloadCell> }>();
  const quarters = new Set<string>();
  const years = new Set<string>();
  for (const v of values) {
    if (v.period_kind !== "Q" && v.period_kind !== "A" && v.period_kind !== "I") continue;
    if (!Number.isFinite(Number(v.value))) continue;
    const slot = byKpi.get(v.kpi_id) ?? { q: {}, y: {} };
    byKpi.set(v.kpi_id, slot);
    if (v.period_kind !== "A") (slot.q[v.period_end] = cellOf(v)), quarters.add(v.period_end);
    else (slot.y[v.period_end] = cellOf(v)), years.add(v.period_end);
  }

  // Include a year-end balance in the annual view only when the company prints a fiscal year
  // ending on exactly that date. It remains an instant (m=0), never a four-quarter sum.
  for (const k of stockKeys) {
    const slot = byKpi.get(k);
    if (slot) for (const end of years) if (slot.q[end]) slot.y[end] = slot.q[end];
  }
  const kids = new Map<string, string[]>();
  for (const d of defs) if (d.parent_id && defById.has(d.parent_id)) kids.set(d.parent_id, [...(kids.get(d.parent_id) ?? []), d.kpi_id]);
  const isRevenue = (d: ExtDef) => /revenue|net sales|sales/i.test(`${d.name} ${d.category ?? ""}`);

  // Group = root kpi with its subtree; lines without a hierarchy are grouped by their category.
  const groupOf = new Map<string, string>();
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const p = defById.get(cur)?.parent_id;
      if (!p || !defById.has(p)) return cur;
      cur = p;
    }
    return cur;
  };
  for (const d of defs) {
    const r = rootOf(d.kpi_id);
    groupOf.set(d.kpi_id, kids.has(r) ? `t:${r}` : `c:${d.category ?? "Other"}`);
  }

  const series: PayloadSeries[] = [];
  const titleOf = (gid: string) => (gid.startsWith("t:") ? (defById.get(gid.slice(2))?.name ?? gid.slice(2)) : gid.slice(2));
  for (const d of defs) {
    const cells = byKpi.get(d.kpi_id);
    if (!cells || (!Object.keys(cells.q).length && !Object.keys(cells.y).length)) continue;
    const gid = groupOf.get(d.kpi_id)!;
    series.push({
      k: d.kpi_id,
      cat: "kpi",
      met: isRevenue(d) ? "revenue" : "other",
      label: d.name,
      parent: d.parent_id && defById.has(d.parent_id) ? d.parent_id : null,
      total: kids.has(d.kpi_id),
      unit: mapUnit(d.unit, d.name),
      ...(stockKeys.has(d.kpi_id) ? { pit: true } : {}),
      bd: d.category,
      sc: titleOf(gid),
      q: cells.q,
      y: cells.y,
    });
  }
  const kept = new Set(series.map((s) => s.k));
  const sortKey = (id: string) => defById.get(id)?.sort ?? 1e9;

  const groups: PayloadGroup[] = [];
  const gids = [...new Set(series.map((s) => groupOf.get(s.k)!))];
  for (const gid of gids) {
    const rows: { k: string; depth: number }[] = [];
    if (gid.startsWith("t:")) {
      const walk = (id: string, depth: number) => {
        for (const k of [...(kids.get(id) ?? [])].sort((a, b) => sortKey(a) - sortKey(b))) walk(k, depth + 1);
        if (kept.has(id)) rows.push({ k: id, depth });
      };
      walk(gid.slice(2), 0);
    } else {
      for (const s of series.filter((x) => groupOf.get(x.k) === gid).sort((a, b) => sortKey(a.k) - sortKey(b.k))) rows.push({ k: s.k, depth: 0 });
    }
    if (!rows.length) continue;
    const first = series.find((s) => s.k === rows[rows.length - 1].k)!;
    groups.push({ id: gid, cat: "kpi", met: first.met, unit: first.unit, label: titleOf(gid), bd: titleOf(gid), root: gid.startsWith("t:") ? gid.slice(2) : rows[0].k, rows });
  }

  // Tie-outs: parents whose children are declared to sum to them.
  const checks: PayloadCheck[] = [];
  const cellsBy = new Map(series.map((s) => [s.k, s]));
  for (const [pid, ks] of kids) {
    const parent = cellsBy.get(pid);
    const parts = ks.filter((k) => defById.get(k)?.sums_to_parent).map((k) => cellsBy.get(k)).filter(Boolean) as PayloadSeries[];
    if (!parent || parts.length < 2 || parts.some((p) => p.unit !== parent.unit || !!p.pit !== !!parent.pit)) continue;
    for (const kind of ["q", "fy"] as const) {
      const pc = kind === "q" ? parent.q : parent.y;
      for (const [e, c] of Object.entries(pc)) {
        const vals = parts.map((p) => (kind === "q" ? p.q : p.y)[e]?.v);
        if (vals.some((x) => x == null)) continue;
        const sum = (vals as number[]).reduce((a, b) => a + b, 0);
        const ok = Math.abs(sum - c.v) <= Math.max(1, Math.abs(c.v) * 0.005);
        checks.push({ k: pid, e, kind, total: c.v, sum, ok, n: parts.length });
      }
    }
  }

  const periods = series.flatMap((s) => [...Object.keys(s.q), ...Object.keys(s.y)]).sort();
  const qc = checks.filter((c) => c.kind === "q");
  const fc = checks.filter((c) => c.kind === "fy");
  return {
    v: 2,
    ticker,
    builtAt: new Date().toISOString(),
    quarters: [...quarters].sort(),
    years: [...years].sort(),
    docs: outDocs,
    series,
    groups,
    checks,
    stats: {
      series: series.length,
      groups: groups.length,
      documents: outDocs.length,
      facts: values.length,
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods.at(-1) ?? null,
      checksQ: { ok: qc.filter((c) => c.ok).length, total: qc.length },
      checksFY: { ok: fc.filter((c) => c.ok).length, total: fc.length },
    },
  };
}
