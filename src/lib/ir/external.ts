// Converts the partner corpus's IR rows (kpi_definitions, kpi_values, ir_documents) into the IR
// page payload. Pure: no network, shared by the server function and tests.
import type { IrPayload, PayloadCell, PayloadCheck, PayloadDoc, PayloadGroup, PayloadPart, PayloadSeries } from "@/lib/ir/payload";

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
  anchor: { quote?: string | null; page?: number | null } | null;
  derived: { formula?: string; inputs?: { kind: string; period_end: string }[] } | null;
}
export interface ExtDoc {
  id: string;
  url: string;
  title: string | null;
  doc_type: string | null;
  published: string | null;
}

/** Ids of documents served from the partner corpus carry this prefix. */
export const EXT_PREFIX = "x:";

export function mapUnit(u: string | null): string {
  switch (u) {
    case "USD":
      return "usd";
    case "USD_per_unit":
    case "USD_per_share":
      return "usdPerShare";
    case "%":
      return "pct";
    case "pp":
      return "bps";
    default:
      return "count";
  }
}

const monthsOf = (kind: string) => (kind === "A" ? 12 : 3);
const secParts = (url: string) => {
  const m = url.match(/\/Archives\/edgar\/data\/\d+\/(\d{10})(\d{2})(\d{6})\/([^/?#]+)/);
  return m ? { accn: `${m[1]}-${m[2]}-${m[3]}`, doc: m[4] } : { accn: null, doc: null };
};

export function buildExternalPayload(ticker: string, defs: ExtDef[], values: ExtValue[], docs: ExtDoc[]): IrPayload {
  const docIdx = new Map<string, number>();
  const outDocs: PayloadDoc[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const di = (id: string): number | undefined => {
    const hit = docIdx.get(id);
    if (hit != null) return hit;
    const d = docById.get(id);
    if (!d) return undefined;
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
        return [{ label, v: Number(src.value), sign: (i === 0 ? 1 : -1) as 1 | -1, d: di(src.source_id), x: src.anchor?.quote ?? undefined, e: src.period_end, m: inp.kind === "A" ? 12 : inp.kind === "Q" ? 3 : 0 }];
      });
      if (parts.length) return { ...base, f: { formula: v.derived.formula ?? "derived", parts } };
    }
    return { ...base, d: di(v.source_id), x: v.anchor?.quote ?? undefined };
  };

  const byKpi = new Map<string, { q: Record<string, PayloadCell>; y: Record<string, PayloadCell> }>();
  const quarters = new Set<string>();
  const years = new Set<string>();
  for (const v of values) {
    if (v.period_kind !== "Q" && v.period_kind !== "A") continue;
    if (!Number.isFinite(Number(v.value))) continue;
    const slot = byKpi.get(v.kpi_id) ?? { q: {}, y: {} };
    byKpi.set(v.kpi_id, slot);
    if (v.period_kind === "Q") (slot.q[v.period_end] = cellOf(v)), quarters.add(v.period_end);
    else (slot.y[v.period_end] = cellOf(v)), years.add(v.period_end);
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
      unit: mapUnit(d.unit),
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
    if (!parent || parts.length < 2) continue;
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
