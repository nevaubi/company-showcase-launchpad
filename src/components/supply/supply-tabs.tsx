// Two of the lists beside the supply-chain map: what changed between two annual reports, and how linked stocks moved
// around the company's earnings releases. Both follow what is isolated on the map.
import { useMemo, useState } from "react";
import { logoKey } from "@/lib/supply/logo-key";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { annualFilings, linkChanges, spillover, type Closes, type GraphNode, type Relation, type SupplyLink } from "@/lib/supply/core";
import { isolatedHas, type Isolated } from "@/lib/supply/isolate";
import { supplyHistoryQuery } from "@/lib/supply/query";
import { pricesQuery, useCompany } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RELATION_ONE } from "./supply-map-meta";
import { RelationMark } from "./supply-marks";

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;

export function ChangesTab({ ticker, name, isolated, onOpen }: { ticker: string; name: string; isolated?: Isolated | null; onOpen: (l: SupplyLink, label: string) => void }) {
  const { data, isLoading } = useQuery(supplyHistoryQuery(ticker));
  const filings = useMemo(() => annualFilings(ticker, data ?? []), [ticker, data]);
  const [pair, setPair] = useState(0);
  const at = Math.min(pair, Math.max(0, filings.length - 2));
  const newer = filings[at], older = filings[at + 1];
  const changes = useMemo(() => (newer && older ? linkChanges(ticker, data ?? [], newer.accn, older.accn) : []), [ticker, data, newer, older]);
  const shown = changes.filter((c) => isolatedHas(isolated, c));
  const latestQ = (data ?? []).filter((l) => l.form === "10-Q").sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading filing history…</p>;
  if (filings.length < 2)
    return <p className="text-sm text-muted-foreground">Only one annual report has been read for {name} so far. Changes appear once a prior 10-K is processed.</p>;
  const pairs = filings.slice(0, -1).map((f, i) => ({ v: String(i), l: `${filings[i + 1].filed.slice(0, 4)} → ${f.filed.slice(0, 4)}` }));
  return (
    <div className="space-y-3">
      {pairs.length > 1 && <Segmented label="Annual reports compared" size="xs" value={String(at)} options={pairs} onChange={(v) => setPair(Number(v))} />}
      <p className="text-xs text-muted-foreground">
        Named counterparties in the 10-K filed {fmtDate(newer.filed)} against the one filed {fmtDate(older.filed)}.
        {latestQ && at === 0 && <> The map also includes the 10-Q filed {fmtDate(latestQ.filed)}.</>}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{changes.length ? `Nothing changed inside what is isolated (${isolated?.label}).` : "No named counterparties added or dropped."}</p>
      ) : (
        <ul className="divide-y border-y">
          {shown.map((c) => (
            <li key={c.kind + c.key} className="flex items-start gap-2 py-1.5">
              <RelationMark relation={c.relation} size={8} className="mt-1.5" />
              <CompanyLogo ticker={logoKey(c)} size="xs" decorative className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-[13px] font-medium">{c.name}</span>
                  <span className={cn("num ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", c.kind === "added" ? "bg-positive-soft text-positive" : c.kind === "dropped" ? "bg-negative-soft text-negative" : "bg-highlight-soft text-foreground")}>
                    {c.kind === "share" ? `${c.from}% → ${c.to}%` : c.kind}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">{RELATION_ONE[c.relation as Relation].toLowerCase()} · {c.link.detail}</span>
              </span>
              <button type="button" onClick={() => onOpen(c.link, `${c.name} · ${c.kind}`)} aria-label={`Source for ${c.name}`}
                className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                <FileText className="size-3" aria-hidden="true" />{c.kind === "dropped" ? `${c.link.filed.slice(0, 4)} 10-K` : "Source"}
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
        Beta is the move per 1% move in {ticker}; same way is the share of releases where both moved in the same direction.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading price history…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dates.length < 3 ? "Not enough earnings dates." : "No covered, listed counterparties to compare."}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr><th scope="col" className="py-1 font-medium">Company</th><th scope="col" className="text-right font-medium">Avg move</th><th scope="col" className="text-right font-medium">Same way</th><th scope="col" className="text-right font-medium">Beta</th></tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.key} className="border-t">
                <td className="py-1">
                  <button type="button" onClick={() => onSelect(p.key)} title={`${p.name}: open its filing evidence`} className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <RelationMark relation={p.relation as Relation} size={8} />
                    <CompanyLogo ticker={p.ticker as string} size="xs" decorative />
                    <span className="num font-medium">{p.ticker}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{RELATION_ONE[p.relation as Relation].toLowerCase()}</span>
                  </button>
                </td>
                <td className="num text-right">{(s!.meanAbs * 100).toFixed(1)}%</td>
                <td className={cn("num text-right", s!.sameDir >= 0.65 && "font-semibold text-positive")}>{Math.round(s!.sameDir * 100)}%</td>
                <td className={cn("num text-right", s!.beta != null && Math.abs(s!.beta) >= 0.5 && "font-semibold")}>{s!.beta == null ? "–" : s!.beta.toFixed(2).replace("-", "−")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows[0] && (
        <p className="text-xs">
          Biggest sympathy mover: <span className="num font-semibold">{rows[0].p.ticker}</span>, averaging {(rows[0].s!.meanAbs * 100).toFixed(1)}% around {ticker} earnings (mean {pct(rows[0].s!.meanMove)}, {rows[0].s!.events} releases).
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Historical co-movement, not causation; includes market-wide moves on those days.</p>
    </div>
  );
}
