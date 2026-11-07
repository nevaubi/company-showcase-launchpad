import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { moversQuery, sectorStrip, type Mover } from "@/lib/markets/movers";
import { overviewQuery } from "@/lib/sectors/groups";
import { fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SECTOR_WINDOWS = ["1W", "1M", "3M", "YTD"] as const;

/** Biggest moves across coverage and the sector ETF strip, for the dashboard. */
export function MarketMoves() {
  const mv = useQuery(moversQuery);
  const ov = useQuery(overviewQuery);
  const [span, setSpan] = useState<"day" | "month">("day");
  const [win, setWin] = useState<(typeof SECTOR_WINDOWS)[number]>("1M");
  const strip = sectorStrip(ov.data?.groups ?? [], win);
  const max = Math.max(0.0001, ...strip.map((s) => Math.abs(s.ret)));
  const spy = ov.data?.spy_returns?.[win];
  if (!mv.data && !strip.length) return null;
  const list = (rows: Mover[]) => (
    <ul className="divide-y">
      {rows.slice(0, 6).map((r) => {
        const v = span === "day" ? r.chg_1d : r.ret_1m;
        return (
          <li key={r.ticker}>
            <Link
              to="/app/companies/$ticker"
              params={{ ticker: r.ticker }}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/60"
            >
              <CompanyLogo ticker={r.ticker} src={r.logo ?? undefined} size="xs" />
              <span className="num w-12 text-xs font-semibold">{r.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                {r.name}
              </span>
              <span
                className={cn(
                  "num text-xs font-medium",
                  (v ?? 0) >= 0 ? "text-positive" : "text-negative",
                )}
              >
                {fmtPct(v, 1, true)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {mv.data && (
        <Panel
          title="Biggest moves"
          subtitle={`Covered companies above $${(mv.data.min_market_cap / 1e9).toFixed(0)}B market cap · close of ${mv.data.as_of ? fmtDate(mv.data.as_of) : "–"}`}
          actions={
            <Segmented
              label="Window"
              size="xs"
              value={span}
              onChange={setSpan}
              options={[
                { v: "day", l: "1 day" },
                { v: "month", l: "1 month" },
              ]}
            />
          }
          collapse={false}
          bodyClassName="grid grid-cols-1 p-0 sm:grid-cols-2 sm:divide-x"
        >
          <div>
            <p className="border-b px-3 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Up
            </p>
            {list(mv.data[span].up)}
          </div>
          <div>
            <p className="border-b px-3 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Down
            </p>
            {list(mv.data[span].down)}
          </div>
        </Panel>
      )}
      {strip.length > 0 && (
        <Panel
          title="Sector ETFs"
          subtitle={`Total return${spy != null ? ` · S&P 500 ${fmtPct(spy, 1, true)}` : ""}`}
          actions={
            <Segmented
              label="Sector window"
              size="xs"
              value={win}
              onChange={setWin}
              options={SECTOR_WINDOWS.map((w) => ({ v: w, l: w }))}
            />
          }
          collapse={false}
          bodyClassName="px-3 py-2"
        >
          <ul className="grid gap-1">
            {strip.map((s) => (
              <li key={s.etf}>
                <Link
                  to="/app/sectors/g/$slug"
                  params={{ slug: s.slug }}
                  className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 rounded px-1 py-0.5 text-[11.5px] hover:bg-secondary/60"
                  title={s.name}
                >
                  <span className="truncate">
                    <span className="num font-medium">{s.etf}</span>{" "}
                    <span className="text-muted-foreground">{s.name}</span>
                  </span>
                  <span className="relative h-3">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                    <span
                      className={cn(
                        "absolute inset-y-0.5 rounded-sm",
                        s.ret >= 0 ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70",
                      )}
                      style={{ width: `${(Math.abs(s.ret) / max) * 50}%` }}
                    />
                  </span>
                  <span
                    className={cn("num text-right", s.ret >= 0 ? "text-positive" : "text-negative")}
                  >
                    {fmtPct(s.ret, 1, true)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
