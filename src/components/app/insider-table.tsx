import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import type { InsiderTrade } from "@/lib/financials/types";
import { fmtCompactUsd, fmtDate, fmtInt, fmtPrice, INSIDER_CODES } from "@/lib/format";
import { cn } from "@/lib/utils";

export type InsiderRow = InsiderTrade & { ticker: string };

const SHORT_CODES: Record<string, string> = { P: "Buy", S: "Sale", A: "Award", M: "Exercise", X: "Exercise", F: "Tax withheld", G: "Gift", C: "Conversion", D: "To issuer", J: "Other" };

const CODE_FILTERS = [
  { id: "market", label: "Open market (P/S)", codes: ["P", "S"] },
  { id: "all", label: "All transactions", codes: null },
  { id: "grants", label: "Grants & exercises", codes: ["A", "M", "X", "F"] },
] as const;

export function InsiderTable({ rows, showTicker = false }: { rows: InsiderRow[]; showTicker?: boolean }) {
  const { open } = useSource();
  const [filter, setFilter] = useState<(typeof CODE_FILTERS)[number]["id"]>("market");
  const list = useMemo(() => {
    const f = CODE_FILTERS.find((x) => x.id === filter)!;
    return rows.filter((r) => !f.codes || (f.codes as readonly string[]).includes(r.code)).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows, filter]);

  const byOwner = useMemo(() => {
    const m = new Map<string, { owner: string; role: string; ticker: string; sold: number; bought: number; n: number }>();
    for (const r of rows.filter((x) => x.code === "S" || x.code === "P")) {
      const k = `${r.ticker}|${r.owner}`;
      const e = m.get(k) ?? { owner: r.owner, role: r.role, ticker: r.ticker, sold: 0, bought: 0, n: 0 };
      const v = r.shares * (r.price ?? 0);
      if (r.code === "S") e.sold += v;
      else e.bought += v;
      e.n++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.sold + b.bought - (a.sold + a.bought)).slice(0, 8);
  }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Panel
        title="Form 4 transactions"
        subtitle="Parsed from the XML of each Form 4 · click a row to read the filing"
        actions={
          <div className="flex gap-1">
            {CODE_FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={cn("rounded px-2 py-1 text-xs", filter === f.id ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary")}>
                {f.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Date</th>
                {showTicker && <th className="px-2 py-2 font-medium">Ticker</th>}
                <th className="px-2 py-2 font-medium">Insider</th>
                <th className="px-2 py-2 font-medium">Transaction</th>
                <th className="px-2 py-2 text-right font-medium">Shares</th>
                <th className="px-2 py-2 text-right font-medium">Price</th>
                <th className="px-2 py-2 text-right font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">Held after</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr
                  key={`${r.accn}-${i}`}
                  className="cursor-pointer border-b last:border-0 hover:bg-secondary/60"
                  onClick={() => open({ ticker: r.ticker, label: `Form 4 · ${r.owner}`, periodLabel: fmtDate(r.date), unit: "usd", value: 0, doc: { accn: r.accn, doc: r.doc, title: `${r.owner} — ${r.role}` } })}
                >
                  <td className="num whitespace-nowrap px-4 py-2 text-xs">{fmtDate(r.date)}</td>
                  {showTicker && <td className="num px-2 py-2 font-medium">{r.ticker}</td>}
                  <td className="max-w-[16rem] px-2 py-2">
                    <span className="block truncate font-medium">{r.owner}</span>
                    <span className="block max-w-[14rem] truncate text-[11px] text-muted-foreground" title={r.role}>
                      {r.role}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-1.5">
                      <Badge variant={r.code === "S" ? "negative" : r.code === "P" ? "positive" : "outline"} title={INSIDER_CODES[r.code] ?? r.code}>
                        {r.code}
                      </Badge>
                      <span className="whitespace-nowrap text-[11.5px]">{SHORT_CODES[r.code] ?? INSIDER_CODES[r.code] ?? r.code}</span>
                      {r.plan10b5 && <span className="whitespace-nowrap rounded bg-secondary px-1 text-[10px] text-muted-foreground">10b5-1</span>}
                    </span>
                  </td>
                  <td className={cn("num px-2 py-2 text-right", r.acquired ? "text-positive" : "text-negative")}>
                    {r.acquired ? "+" : "−"}
                    {fmtInt(r.shares)}
                  </td>
                  <td className="num px-2 py-2 text-right">{r.price ? fmtPrice(r.price) : "—"}</td>
                  <td className="num px-2 py-2 text-right">{r.price ? fmtCompactUsd(r.shares * r.price) : "—"}</td>
                  <td className="num px-4 py-2 text-right text-muted-foreground">{fmtInt(r.ownedAfter)}</td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No transactions of this type in the filings we parsed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Most active insiders" subtitle="Open-market value, buys vs. sells" bodyClassName="p-0">
        <ul className="divide-y">
          {byOwner.map((o) => {
            const total = o.sold + o.bought || 1;
            return (
              <li key={`${o.ticker}-${o.owner}`} className="px-4 py-3">
                <div className="flex items-baseline gap-2">
                  {showTicker && <span className="num text-xs font-semibold">{o.ticker}</span>}
                  <span className="truncate text-[13px] font-medium">{o.owner}</span>
                  <span className="num ml-auto text-xs text-muted-foreground">{o.n} trades</span>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">{o.role}</p>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-secondary">
                  <span className="bg-positive" style={{ width: `${(o.bought / total) * 100}%` }} />
                  <span className="bg-negative" style={{ width: `${(o.sold / total) * 100}%` }} />
                </div>
                <p className="num mt-1 flex justify-between text-[11px]">
                  <span className="text-positive">{fmtCompactUsd(o.bought)} bought</span>
                  <span className="text-negative">{fmtCompactUsd(o.sold)} sold</span>
                </p>
              </li>
            );
          })}
          {!byOwner.length && (
            <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <FileText className="size-4" /> No open-market trades in this sample.
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}
