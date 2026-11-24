// Levels and chart signals under the price chart: the nearest clustered support and resistance and the rules that
// fired in the last ten sessions, each with its record on this stock. Computed from the loaded daily bars
// (src/lib/company/setup.ts), so the date is the date of the last bar, for every covered company.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { chartSetup, RECENT_SESSIONS, type Level } from "@/lib/company/setup";
import { usePrices } from "@/lib/data";
import type { Bar } from "@/lib/financials/types";
import { fmtDate, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatGrid } from "./stat-grid";

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(1)}%`;

function LevelBlock({ label, level, price }: { label: string; level: Level | null; price: number }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className={IR.caption}>{label}</p>
      <p className={cn("mt-0.5", IR.stat)}>{level ? fmtPrice(level.price) : DASH}</p>
      <p className={cn("mt-0.5", IR.caption)}>{level ? `${pct(level.price / price - 1)} from the last close · ${level.touches} turns cluster here` : "no clustered turning points on this side in the last year"}</p>
    </div>
  );
}

export function LevelsAndSignals({ ticker }: { ticker: string }) {
  const long = usePrices(ticker, "5y");
  const setup = useMemo(() => chartSetup((long.data?.bars ?? []) as Bar[]), [long.data]);
  // fewer than 60 sessions on file: nothing to place levels on or test rules with
  if (!setup) return null;
  return (
    <IrPanel
      section="Levels and signals"
      title="Levels and signals"
      subtitle={`Daily bars through ${fmtDate(setup.asOf)} · adjusted close ${fmtPrice(setup.price)} · fixed rules over ${setup.sessions.toLocaleString("en-US")} sessions, no forecast`}
      bodyClassName="p-0"
      actions={
        // the full indicator board (trend, momentum, volatility, volume, gaps and the event log) lives in Markets;
        // the Overview keeps only the read above and these levels, so it is not repeated here
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/markets" search={{ symbol: ticker, view: "indicators" }}>
            Indicator board
          </Link>
        </Button>
      }
    >
      <StatGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <LevelBlock label="Nearest support" level={setup.support} price={setup.price} />
        <LevelBlock label="Nearest resistance" level={setup.resistance} price={setup.price} />
        <div className="min-w-0 px-4 py-3 sm:col-span-2 lg:col-span-1">
          <p className={IR.caption}>Rules that fired in the last {RECENT_SESSIONS} sessions</p>
          {setup.active.length === 0 ? (
            <p className="mt-1 text-[13px] leading-5">None.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border/60">
              {setup.active.slice(0, 5).map((a) => (
                <li key={`${a.kind}-${a.date}`} className="py-1 text-[13px] leading-5">
                  <span className="font-medium">{a.label}</span>
                  <span className={cn("ml-1.5", IR.caption)}>
                    {a.bias === "neutral" ? "no direction" : a.bias} · {fmtDate(a.date)} at {fmtPrice(a.price)}
                  </span>
                  <span className={cn("block", IR.caption)}>
                    {a.rule}.{" "}
                    {a.past
                      ? a.past.hitRate != null
                        ? `Before this, it went the rule's way over 20 sessions in ${Math.round(a.past.hitRate * a.past.n)} of ${a.past.n} cases${a.past.avgFwd20 != null ? ` (average ${pct(a.past.avgFwd20)})` : ""}.`
                        : `Fired ${a.past.n === 1 ? "once" : `${a.past.n} times`} before${a.past.avgFwd20 != null ? `; the next 20 sessions averaged ${pct(a.past.avgFwd20)}` : ""}.`
                      : "No earlier case with 20 sessions of follow-up on this stock."}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StatGrid>
    </IrPanel>
  );
}
