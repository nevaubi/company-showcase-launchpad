import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Printer } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany, usePrices, useQuotes } from "@/lib/data";
import { buildMemo, margin } from "@/lib/memo/core";
import { fmtCell, fmtCompactUsd, fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import type { CompanyDataset, Unit } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/memo")({
  head: ({ params }) => ({ meta: [
    { title: `${params.ticker.toUpperCase()} IC memo — Filed Under` },
    { name: "description", content: `Printable one-page tear-sheet for ${params.ticker.toUpperCase()} with every number footnoted to its SEC filing.` },
    { property: "og:title", content: `${params.ticker.toUpperCase()} IC memo — Filed Under` },
    { property: "og:description", content: "Printable, fully footnoted company tear-sheet built from SEC filings." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: MemoPage,
});

function MemoPage() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const company = useCompany(ticker);
  if (!company.data) return <Skeleton className="h-[600px]" />;
  return <Memo ticker={ticker} data={company.data} />;
}

const secUrl = (cik: string, accn: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/`;

function Memo({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const memo = useMemo(() => buildMemo(data, 5), [data]);
  const quote = useQuotes([ticker]).data?.quotes[0];
  const { open } = useSource();
  const p = data.profile;
  const bars = usePrices(ticker, "1y").data?.bars;
  const price = quote?.price ?? bars?.at(-1)?.[4] ?? null;
  const mcap = price && p.sharesOutstanding ? price * p.sharesOutstanding : null;
  const last = memo.periods.length - 1;
  const val = (k: string) => memo.lines.find((l) => l.key === k)?.cells[last]?.v ?? null;
  const rev = val("revenue"), ni = val("netIncome"), fcf = val("fcf"), debt = val("totalDebt"), cash = val("cash");
  const ev = mcap != null ? mcap + (debt ?? 0) - (cash ?? 0) : null;
  const ratios = [
    { label: "Gross margin", v: margin(memo, "grossProfit") },
    { label: "Operating margin", v: margin(memo, "operatingIncome") },
    { label: "Net margin", v: margin(memo, "netIncome") },
    { label: "FCF margin", v: margin(memo, "fcf") },
  ];
  const openCell = (key: string, i: number) => {
    const st = (["income", "balance", "cashflow"] as const).map((s) => data.statements.annual[s]).find((s) => s.rows.some((r) => r.key === key));
    const pi = st?.periods.findIndex((x) => x.key === memo.periods[i].key) ?? -1;
    const row = st?.rows.find((r) => r.key === key);
    const cell = row?.cells[pi];
    if (!st || !row || !cell) return;
    open({ ticker, label: row.label, periodLabel: memo.periods[i].label, unit: row.unit, value: cell.v, src: cell.src, derived: cell.derived, alts: cell.alts });
  };

  return (
    <div className="memo-print grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <div className="text-xs uppercase text-muted-foreground">Investment committee tear-sheet · {fmtDate(new Date().toISOString())}</div>
          <h2 className="text-lg font-semibold">{p.name} ({ticker})</h2>
          <div className="text-xs text-muted-foreground">{p.sicDescription} · {p.exchange} · CIK {p.cik}</div>
        </div>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer className="size-3.5" /> Print / save PDF</Button>
      </div>

      <div className="grid grid-cols-2 gap-px border bg-border md:grid-cols-5">
        {[
          ["Price", price != null ? fmtPrice(price) : "—", quote?.price ? "Live quote" : "Last close"],
          ["Market cap", fmtCompactUsd(mcap), "Price × cover-page shares"],
          ["EV", fmtCompactUsd(ev), "Mkt cap + debt − cash"],
          ["EV / sales", ev && rev ? `${(ev / rev).toFixed(1)}×` : "—", memo.periods[last]?.label ?? ""],
          ["P / FCF", mcap && fcf && fcf > 0 ? `${(mcap / fcf).toFixed(1)}×` : "—", ni && mcap ? `P/E ${(mcap / ni).toFixed(1)}×` : ""],
        ].map(([l, v, s]) => (
          <div key={l} className="bg-card px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div className="font-mono text-base tabular-nums">{v}</div>
            <div className="truncate text-[11px] text-muted-foreground">{s}</div>
          </div>
        ))}
      </div>

      <Panel collapse={false} title="Five-year financial summary" subtitle="Click any number to open its filing. Superscripts refer to the source list below.">
        <div className="overflow-x-auto">
          <table className="research-table w-full min-w-[640px] text-sm">
            <thead><tr><th className="text-left">USD</th>{memo.periods.map((x) => <th key={x.key} className="text-right">{x.label}</th>)}</tr></thead>
            <tbody>
              {memo.lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  {l.cells.map((c, i) => (
                    <td key={i} className="text-right font-mono tabular-nums">
                      {c ? (
                        <button className="hover:underline" onClick={() => openCell(l.key, i)}>
                          {fmtCell(c.v, l.unit as Unit, "M")}
                          <sup className="ml-0.5 text-[9px] text-muted-foreground">{c.notes.slice(0, 3).join(",")}{c.notes.length > 3 ? "…" : ""}</sup>
                          {l.growth[i] != null && <span className={cn("block text-[10px]", l.growth[i]! >= 0 ? "text-positive" : "text-negative")}>{fmtPct(l.growth[i], 1, true)}</span>}
                        </button>
                      ) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {ratios.map((r) => (
                <tr key={r.label} className="text-muted-foreground">
                  <td className="italic">{r.label}</td>
                  {r.v.map((x, i) => <td key={i} className="text-right font-mono tabular-nums">{fmtPct(x)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Values in $M except per-share. Margins are derived from the footnoted lines above. Market data is a live quote and is not from SEC filings.</p>
      </Panel>

      <Panel title={`Sources (${memo.notes.length})`} subtitle="Every figure above maps to one or more SEC XBRL facts.">
        <ol className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-[11px] md:grid-cols-2">
          {memo.notes.map((n) => (
            <li key={n.n} className="flex min-w-0 gap-1.5">
              <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">{n.n}</span>
              <a className="truncate hover:underline" href={secUrl(p.cik, n.accn)} target="_blank" rel="noreferrer">
                {n.accn} · {n.concept} · {n.start ? `${n.start} → ` : ""}{n.end}
              </a>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
