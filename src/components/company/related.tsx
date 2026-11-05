import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { useQuotes } from "@/lib/data";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Named peers first, then other covered companies in the same industry and sector. */
export function RelatedCompanies({ ticker }: { ticker: string }) {
  const co = coverageOf(ticker);
  const peers = (co?.peers ?? []).filter((t) => coverageOf(t));
  const sameInd = COVERAGE.filter((c) => c.ticker !== ticker && c.industry === co?.industry && !peers.includes(c.ticker)).map((c) => c.ticker);
  const sameSec = COVERAGE.filter((c) => c.ticker !== ticker && c.sector === co?.sector && !peers.includes(c.ticker) && !sameInd.includes(c.ticker)).map((c) => c.ticker);
  const list = [...peers.map((t) => [t, "Peer"]), ...sameInd.map((t) => [t, "Same industry"]), ...sameSec.map((t) => [t, "Same sector"])].slice(0, 9) as [string, string][];
  const quotes = useQuotes(list.map(([t]) => t)).data?.quotes ?? [];
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Network className="size-3.5" /> Related companies
        </span>
      }
      subtitle={co?.sector}
      bodyClassName="p-0"
    >
      <ul className="divide-y">
        {list.map(([t, why]) => {
          const q = quotes.find((x) => x.symbol === t);
          const c = coverageOf(t);
          return (
            <li key={t}>
              <Link to="/app/companies/$ticker" params={{ ticker: t }} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-secondary">
                <CompanyLogo ticker={t} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{c?.shortName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{t} · {why}</span>
                </span>
                <span className="num text-right text-[12px]">
                  {q ? fmtPrice(q.price) : "—"}
                  <span className={cn("block text-[11px]", q && q.changePct >= 0 ? "text-positive" : "text-negative")}>{q ? fmtPct(q.changePct, 2, true) : ""}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
