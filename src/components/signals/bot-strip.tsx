// The summary strip of one paper autopilot: the same tiles as the market strip on the setups page
// (hairlines between opaque tiles), with the sign of a result carried by the figure itself.
import type { ReactNode } from "react";
import { Stat } from "@/components/app/page-header";
import { fmtCompactUsd } from "@/lib/format";
import { botStats, type EquityRow } from "@/lib/signals/bots";
import { count, num, pct } from "@/lib/signals/format";
import { cn } from "@/lib/utils";

const TILE = "border-0 bg-card";

/** A signed figure in the positive or negative colour; zero and missing stay neutral. */
function Signed({ v, children }: { v: number | null | undefined; children: ReactNode }) {
  return <span className={cn(v == null || v === 0 ? "" : v > 0 ? "text-positive" : "text-negative")}>{children}</span>;
}

export function BotStrip({ capital, equity, closed, open }: { capital: number; equity: EquityRow[]; closed: { ret: number | null }[]; open: number }) {
  const s = botStats(capital, equity, closed);
  const last = equity.at(-1);
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4 lg:grid-cols-8" data-section="Autopilot summary">
      <Stat className={TILE} label="Equity" value={fmtCompactUsd(last?.equity ?? capital)} sub={`from ${fmtCompactUsd(capital)}`} />
      <Stat className={TILE} label="Return" value={<Signed v={s.totalReturn}>{pct(s.totalReturn)}</Signed>} sub={`${count(s.days)} trading day${s.days === 1 ? "" : "s"}`} />
      <Stat className={TILE} label="Against the S&P 500" value={<Signed v={s.excess}>{pct(s.excess)}</Signed>} sub={`S&P 500 ${pct(s.spyReturn)}`} />
      <Stat className={TILE} label="Closed trades" value={count(s.trades)} sub={`${open} open or queued`} />
      <Stat className={TILE} label="Win rate" value={pct(s.hit, 0, false)} sub={s.trades ? "of closed trades" : "no closed trades"} />
      <Stat className={TILE} label="Average trade" value={<Signed v={s.avgTrade}>{pct(s.avgTrade)}</Signed>} sub="after costs" />
      <Stat className={TILE} label="Worst fall from a peak" value={<Signed v={s.maxDrawdown}>{pct(s.maxDrawdown, 1, false)}</Signed>} sub="on daily closes" />
      <Stat className={TILE} label="Sharpe" value={num(s.sharpe, 2)} sub={s.sharpe == null ? "after 20 days" : "annualised"} />
    </div>
  );
}
