import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { annualFilings, linkChanges, spillover, type Closes, type GraphNode, type RiskLink, type SupplyLink } from "@/lib/supply/core";
import { supplyHistoryQuery } from "@/lib/supply/query";
import { pricesQuery, useCompany } from "@/lib/data";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;

export function ChangesTab({ ticker, name, onOpen }: { ticker: string; name: string; onOpen: (l: SupplyLink, label: string) => void }) {
  const { data, isLoading } = useQuery(supplyHistoryQuery(ticker));
  const filings = useMemo(() => annualFilings(ticker, data ?? []), [ticker, data]);
  const [pair, setPair] = useState(0);
  const newer = filings[pair], older = filings[pair + 1];
  const changes = useMemo(() => (newer && older ? linkChanges(ticker, data ?? [], newer.accn, older.accn) : []), [ticker, data, newer, older]);
  const latestQ = (data ?? []).filter((l) => l.form === "10-Q").sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading filing history…</p>;
  if (filings.length < 2)
    return <p className="text-sm text-muted-foreground">Only one annual report has been read for {name} so far — changes appear once a prior 10-K is processed.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {filings.slice(0, -1).map((f, i) => (
          <button key={f.accn} type="button" onClick={() => setPair(i)} className={cn("rounded border px-2 py-1 text-xs", pair === i ? "bg-ink text-ink-foreground" : "text-muted-foreground")}>
            {filings[i + 1].filed.slice(0, 4)} → {f.filed.slice(0, 4)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Named counterparties in the 10-K filed {fmtDate(newer.filed)} vs {fmtDate(older.filed)}.
        {latestQ && pair === 0 && <> The map also includes the 10-Q filed {fmtDate(latestQ.filed)}.</>}
      </p>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No named counterparties added or dropped.</p>
      ) : (
        <ul className="max-h-[440px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {changes.map((c) => (
            <li key={c.kind + c.key} className="rounded-lg border p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: RELATION_COLOR[c.relation] }} />
                <span className="truncate font-medium">{c.name}</span>
                <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium", c.kind === "added" ? "bg-positive-soft text-positive" : c.kind === "dropped" ? "bg-negative-soft text-negative" : "bg-highlight-soft text-highlight-foreground")}>
                  {c.kind === "share" ? `${c.from}% → ${c.to}%` : c.kind}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.relation} · {c.link.detail}</p>
              <button type="button" onClick={() => onOpen(c.link, `${c.name} · ${c.kind}`)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <FileText className="size-3" /> {c.kind === "dropped" ? `Last named in ${c.link.filed.slice(0, 4)} 10-K` : "Source"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const closes = (bars?: { bars: number[][] | unknown[] }): Closes =>
  ((bars?.bars ?? []) as [string, number, number, number, number, number][]).map((b) => [b[0], b[5] || b[4]]);

export function ReactionsTab({ ticker, name, graph, covered, onSelect }: { ticker: string; name: string; graph: GraphNode[]; covered: Set<string>; onSelect: (key: string) => void }) {
  const { data: co } = useCompany(ticker);
  const dates = useMemo(
    () => [...new Set((co?.filings ?? []).filter((f) => f.form.startsWith("8-K") && f.items?.includes("2.02")).map((f) => f.filed))].sort(),
    [co],
  );
  const peers = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of graph) if (n.ticker && n.ticker !== ticker && covered.has(n.ticker) && !m.has(n.ticker)) m.set(n.ticker, n);
    return [...m.values()].slice(0, 16);
  }, [graph, ticker, covered]);
  const qs = useQueries({ queries: [ticker, ...peers.map((p) => p.ticker!)].map((s) => pricesQuery(s, "5y")) });
  const focus = closes(qs[0]?.data as never);
  const rows = peers
    .map((p, i) => ({ p, s: focus.length ? spillover(focus, closes(qs[i + 1]?.data as never), dates) : null }))
    .filter((r) => r.s)
    .sort((a, b) => b.s!.meanAbs - a.s!.meanAbs);
  const loading = qs.some((q) => q.isLoading) || !co;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        How linked stocks moved over the two trading days around each of {name}'s last {Math.min(dates.length, 20)} earnings releases (8-K item 2.02), last 5 years.
        Beta = move per 1% move in {ticker}; "same way" = share of releases where both moved in the same direction.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading price history…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dates.length < 3 ? "Not enough earnings dates." : "No covered, listed counterparties to compare."}</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1 font-medium">Company</th><th className="text-right font-medium">Avg |move|</th><th className="text-right font-medium">Same way</th><th className="text-right font-medium">Beta</th></tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.key} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => onSelect(p.key)}>
                <td className="py-1.5">
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: RELATION_COLOR[p.relation as keyof typeof RELATION_COLOR] }} />
                  <span className="font-medium">{p.ticker}</span> <span className="text-muted-foreground">{p.relation}</span>
                </td>
                <td className="num text-right">{(s!.meanAbs * 100).toFixed(1)}%</td>
                <td className={cn("num text-right", s!.sameDir >= 0.65 && "font-semibold text-positive")}>{Math.round(s!.sameDir * 100)}%</td>
                <td className={cn("num text-right", s!.beta != null && Math.abs(s!.beta) >= 0.5 && "font-semibold")}>{s!.beta == null ? "—" : s!.beta.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows[0] && (
        <p className="text-xs">
          Biggest sympathy mover: <b>{rows[0].p.ticker}</b>, averaging {(rows[0].s!.meanAbs * 100).toFixed(1)}% around {ticker} earnings (mean {pct(rows[0].s!.meanMove)}, {rows[0].s!.events} releases).
        </p>
      )}
      <p className="text-[10.5px] text-muted-foreground">Historical co-movement, not causation; includes market-wide moves on those days.</p>
    </div>
  );
}
