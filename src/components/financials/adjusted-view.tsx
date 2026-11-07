import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtDate } from "@/lib/format";
import {
  ADJ_FAMILIES,
  filedIndexQuery,
  fmtKpiValue,
  fmtMillions,
  kpiFileQuery,
  kpiItems,
  nearKey,
  pickMeasures,
  startOf,
  stdFileQuery,
  stdMapQuery,
  stdSeries,
  type KpiItem,
} from "@/lib/statements/filed";
import { FiledGrid, type GridRow } from "./filed-grid";

const QMARK: Record<string, string> = { ">": ">", "<": "<", "~": "~" };

/** The company's own non-GAAP measures from its releases, next to the GAAP line from its filings. */
export function AdjustedView({ ticker }: { ticker: string }) {
  const kpi = useQuery(kpiFileQuery(ticker));
  const index = useQuery(filedIndexQuery(ticker));
  const std = useQuery(stdFileQuery(ticker));
  const map = useQuery(stdMapQuery);
  const [K, setK] = useState<"Q" | "A">("Q");
  const { open } = useSource();
  const series = useMemo(() => (std.data ? stdSeries(std.data) : {}), [std.data]);

  if (kpi.isError) return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{ticker} has no published KPI file yet, so there are no company reconciliations to show.</p>;
  if (!kpi.data || (index.isLoading && !index.isError)) return <Skeleton className="h-[420px]" />;
  const items = kpiItems(kpi.data);
  const tpl = index.data?.filings[0]?.template;
  const tplLines = tpl && map.data ? map.data.templates[tpl] : [];

  const blocks: { key: string; title: string; rows: GridRow[]; ends: string[] }[] = [];
  for (const fam of ADJ_FAMILIES) {
    for (const m of pickMeasures(items, fam.rx, K)) {
      const kids = items.filter((x) => x.parent === m.id && Object.keys(x.values?.[K] ?? {}).length > 0);
      const all = [...kids, m];
      const ends = [...new Set(all.flatMap((it) => Object.keys(it.values?.[K] ?? {})))].sort().slice(-(K === "A" ? 6 : 8));
      const perShare = fam.id === "eps";
      const rows: GridRow[] = [];
      const gl = tplLines.find((l) => l.id === fam.gaap);
      const gaap: (number | null)[] = ends.map(() => null);
      if (gl && !kids.some((k) => /\bgaap\b/i.test(k.name) && !/non-gaap/i.test(k.name))) {
        const byK = series[fam.gaap] ?? {};
        rows.push({
          key: `${m.id}-gaap`,
          label: `GAAP: ${gl.label} (filed statements)`,
          title: `GAAP ${gl.label} from the filed statements (template line ${gl.id})`,
          cells: ends.map((e, i) => {
            const k = nearKey(byK, e, gl.stmt === "BS" ? 0 : K === "A" ? 4 : 1);
            const list = k ? byK[k] : null;
            if (!list?.length) return null;
            const p = list[list.length - 1];
            gaap[i] = p.v;
            return {
              text: fmtMillions(p.v, perShare),
              negative: p.v < 0,
              title: `Filed as "${p.plabel}" (${p.tag}) · ${p.form} filed ${fmtDate(p.filed)}`,
              onClick: () =>
                open({ ticker, label: gl.label, periodLabel: fmtDate(e), unit: perShare ? "usdPerShare" : "usd", value: p.v, src: { accn: p.a, concept: p.tag.includes(":") ? p.tag : `us-gaap:${p.tag}`, start: startOf(p.d, p.q), end: p.d, value: p.v } }),
            };
          }),
        });
      }
      for (const it of all) rows.push(kpiRow(it, ends, K, perShare, it === m, (v, e) => openKpi(it, v, e)));
      if (gaap.some((x) => x != null) && fam.id !== "ebitda") {
        rows.push({
          key: `${m.id}-diff`,
          label: "Difference: adjusted minus GAAP",
          kind: "sub",
          cells: ends.map((e, i) => {
            const v = m.values?.[K]?.[e];
            const g = gaap[i];
            if (!v || g == null) return null;
            // Per-share figures from before a stock split aren't comparable with split-adjusted ones.
            if (perShare && g !== 0 && (Math.abs(v.v / g) > 3 || Math.abs(v.v / g) < 1 / 3)) return null;
            const d = v.v - g;
            return { text: fmtMillions(d, perShare), negative: d < 0, italic: true };
          }),
        });
      }
      blocks.push({ key: m.id, title: `${fam.name} · ${m.category ?? ""}`, rows, ends });
    }
  }

  function openKpi(it: KpiItem, v: NonNullable<NonNullable<KpiItem["values"]>["Q"]>[string], e: string) {
    open({
      ticker,
      label: it.name,
      periodLabel: v.label ?? fmtDate(e),
      unit: /usd/i.test(it.unit ?? "USD") ? "usd" : it.unit ?? "usd",
      value: v.v,
      external: v.url ? { url: v.url, quote: v.quote, date: v.doc_title } : undefined,
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Company non-GAAP measures from earnings releases and presentations, beside GAAP from the filed statements.</p>
        <Segmented className="lg:ml-auto" label="Frequency" value={K} onChange={setK} options={[{ v: "Q", l: "Quarterly" }, { v: "A", l: "Annual" }]} />
      </div>
      {blocks.length === 0 && (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          The KPI file for {ticker} has no adjusted operating income, adjusted EPS, adjusted EBITDA or free cash flow series for {K === "A" ? "annual" : "quarterly"} periods.
        </p>
      )}
      {blocks.map((b) => (
        <div key={b.key} className="grid gap-1.5">
          <p className="eyebrow">{b.title}</p>
          <FiledGrid head="Line" columns={b.ends.map((e) => ({ key: e, top: K === "A" ? "Year" : "Quarter", bottom: fmtDate(e) }))} rows={b.rows} maxHeight="none" />
        </div>
      ))}
      {blocks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Adjusted lines are the company's own reconciliation rows (click one to open the document at the printed figure). The GAAP line comes from the SEC Financial Statement Data Sets. USD millions except per share.
        </p>
      )}
    </div>
  );
}

function kpiRow(it: KpiItem, ends: string[], K: "Q" | "A", perShare: boolean, headline: boolean, onOpen: (v: NonNullable<NonNullable<KpiItem["values"]>["Q"]>[string], e: string) => void): GridRow {
  const vals = it.values?.[K] ?? {};
  return {
    key: it.id,
    label: it.name,
    title: it.description ? `${it.name}\n${it.description}` : it.name,
    kind: headline ? "total" : "sub",
    cells: ends.map((e) => {
      const v = vals[e];
      if (!v) return null;
      return {
        text: (QMARK[v.q ?? ""] ?? "") + fmtKpiValue(v.v, it.unit, perShare),
        negative: v.v < 0,
        title: `${v.doc_title ?? "Source document"}${v.quote ? `\n${v.quote}` : ""}`,
        onClick: () => onOpen(v, e),
      };
    }),
  };
}
