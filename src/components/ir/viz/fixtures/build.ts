// Builds a small IR payload (the shape the page receives) from the real fixture rows in jpm.ts, cfg.ts and aapl.ts,
// so the adapters in from-payload.ts and the preview run on stored figures. Pure.
import type { IrPayload, PayloadCell, PayloadCheck, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";

export interface FixtureLine {
  id: string;
  label: string;
  cat: string;
  met: string;
  unit: "usd" | "pct";
  parent?: string;
  total?: boolean;
  /** a balance or ratio at the period end (no duration) */
  pit?: boolean;
  /** "end|value|printed|t.r.c|doc;..." */
  rows: string;
}
export interface FixtureCompany {
  ticker: string;
  docs: { id: string; accn: string; doc: string | null; kind: string; filed: string }[];
  /** what one printed unit is worth, by unit: the tables state "in millions" for dollars */
  mult: { usd: number; pct: number };
  /** the rows' values are in this many dollars (Apple's rows are in millions); default 1 */
  valuesIn?: number;
  lines: FixtureLine[];
  groups: { id: string; label: string; root: string }[];
}

export interface FixtureRow {
  end: string;
  value: number;
  printed: string;
  loc: [number, number, number];
  doc: number;
}

export function parseRows(line: FixtureLine, valuesIn = 1): FixtureRow[] {
  return line.rows.split(";").map((r) => {
    const [end, v, printed, loc, doc] = r.split("|");
    const [t, rr, c] = loc.split(".").map(Number);
    return { end, value: Number(v) * (line.unit === "usd" ? valuesIn : 1), printed, loc: [t, rr, c], doc: Number(doc) };
  });
}

export function fixturePayload(fx: FixtureCompany): IrPayload {
  const series: PayloadSeries[] = fx.lines.map((l) => {
    const q: Record<string, PayloadCell> = {};
    for (const r of parseRows(l, fx.valuesIn)) q[r.end] = { v: r.value, d: r.doc, l: r.loc, x: r.printed, e: r.end, m: l.pit ? 0 : 3 };
    return { k: l.id, cat: l.cat, met: l.met, label: l.label, parent: l.parent ?? null, total: !!l.total, unit: l.unit, ...(l.pit ? { pit: true } : {}), q, y: {} };
  });
  const byKey = new Map(series.map((s) => [s.k, s]));
  const groups: PayloadGroup[] = fx.groups.map((g) => {
    const root = byKey.get(g.root)!;
    const kids = series.filter((s) => s.parent === g.root);
    return { id: g.id, cat: root.cat, met: root.met, unit: root.unit, label: g.label, t: g.label, root: g.root, rows: [...kids.map((s) => ({ k: s.k, depth: 1 })), { k: g.root, depth: 0 }] };
  });
  const checks: PayloadCheck[] = [];
  for (const g of groups) {
    const root = byKey.get(g.root!)!;
    const kids = series.filter((s) => s.parent === g.root);
    for (const [e, c] of Object.entries(root.q)) {
      const have = kids.filter((s) => s.q[e]);
      if (!have.length) continue;
      const sum = have.reduce((a, s) => a + s.q[e].v, 0);
      checks.push({ k: root.k, e, kind: "q", total: c.v, sum, ok: Math.abs(sum - c.v) <= have.length * 0.5 * fx.mult.usd, n: have.length, ...(have.length < kids.length ? { partial: true } : {}) });
    }
  }
  const quarters = [...new Set(series.flatMap((s) => Object.keys(s.q)))].sort();
  return {
    v: 2,
    ticker: fx.ticker,
    builtAt: "2026-11-26T00:00:00.000Z",
    quarters,
    years: [],
    docs: fx.docs.map((d) => ({ id: d.id, accn: d.accn, doc: d.doc, kind: d.kind, filed: d.filed })),
    series,
    groups,
    checks,
    stats: {
      series: series.length,
      groups: groups.length,
      documents: fx.docs.length,
      facts: series.reduce((a, s) => a + Object.keys(s.q).length, 0),
      firstPeriod: quarters[0] ?? null,
      lastPeriod: quarters.at(-1) ?? null,
      checksQ: { ok: checks.filter((c) => c.ok).length, total: checks.length },
      checksFY: { ok: 0, total: 0 },
    },
  };
}
