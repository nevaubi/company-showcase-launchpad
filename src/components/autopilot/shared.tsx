// Shared pieces for the paper autopilot pages: rule summaries, stat strip and the equity chart.
import { MultiLine } from "@/components/charts/multi-line";
import { Stat } from "@/components/app/page-header";
import { fmtInt, fmtPct, fmtCompactUsd } from "@/lib/format";
import { botStats, parseRules, type BotRules, type EquityRow } from "@/lib/signals/bots";
import { FAMILY_LABEL, STRATEGY } from "@/lib/signals/strategies";
import { parseVariantKey } from "@/lib/signals/setups";

const SELECT_LABEL: Record<BotRules["select"], string> = {
  proven: "Proven strategies only",
  watch: "Proven strategies and closest candidates",
  family: "Every signal from chosen families",
  variants: "Chosen strategies",
};

export function variantLabel(key: string) {
  const { strategy, side, horizon } = parseVariantKey(key);
  return `${STRATEGY[strategy]?.label ?? strategy} · ${side > 0 ? "long" : "short"} · ${horizon}d`;
}

export function rulesSummary(raw: unknown): string[] {
  const r = parseRules(raw);
  const what =
    r.select === "family" ? `${SELECT_LABEL.family}: ${r.families.map((f) => FAMILY_LABEL[f]).join(", ") || "none chosen"}`
      : r.select === "variants" ? `${SELECT_LABEL.variants}: ${r.variants.map(variantLabel).join("; ") || "none chosen"}`
        : SELECT_LABEL[r.select];
  return [
    what,
    r.side === "both" ? "Longs and shorts" : r.side === "long" ? "Longs only" : "Shorts only",
    `Up to ${r.maxPositions} positions, ${fmtPct(r.positionPct, 0)} of equity each, ${r.maxPerSector} per sector`,
    r.exits === "time" ? "Exits after the tested holding period" : "Exits after the holding period, or at the stop / target",
    ...(r.minStrength ? [`Signal strength at least ${r.minStrength}`] : []),
  ];
}

export function BotStatStrip({ capital, equity, closed, open }: { capital: number; equity: EquityRow[]; closed: { ret: number | null }[]; open: number }) {
  const s = botStats(capital, equity, closed);
  const last = equity.at(-1);
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4 lg:grid-cols-8">
      <Stat className="border-0" label="Equity" value={fmtCompactUsd(last?.equity ?? capital)} sub={`from ${fmtCompactUsd(capital)}`} />
      <Stat className="border-0" label="Return" value={fmtPct(s.totalReturn, 2, true)} tone={toneOf(s.totalReturn)} sub={`${fmtInt(s.days)} trading days`} />
      <Stat className="border-0" label="vs S&P 500" value={fmtPct(s.excess, 2, true)} tone={toneOf(s.excess)} sub={`S&P ${fmtPct(s.spyReturn, 2, true)}`} />
      <Stat className="border-0" label="Closed trades" value={fmtInt(s.trades)} sub={`${open} open or queued`} />
      <Stat className="border-0" label="Win rate" value={fmtPct(s.hit, 0)} />
      <Stat className="border-0" label="Avg trade" value={fmtPct(s.avgTrade, 2, true)} tone={toneOf(s.avgTrade)} sub="after costs" />
      <Stat className="border-0" label="Max drawdown" value={fmtPct(s.maxDrawdown, 1)} tone={s.maxDrawdown && s.maxDrawdown < 0 ? "negative" : "neutral"} />
      <Stat className="border-0" label="Sharpe" value={s.sharpe == null ? "—" : s.sharpe.toFixed(2)} sub={s.sharpe == null ? "after 20 days" : "annualised"} />
    </div>
  );
}

const toneOf = (v: number | null | undefined) => (v == null || v === 0 ? "neutral" : v > 0 ? "positive" : "negative") as "positive" | "negative" | "neutral";

/** Equity vs the S&P 500, both rebased to 100 on the first day. */
export function EquityChart({ capital, equity, height = 220 }: { capital: number; equity: EquityRow[]; height?: number }) {
  if (equity.length < 2)
    return <p className="py-8 text-center text-sm text-muted-foreground">The chart starts after the second trading day.</p>;
  const spy0 = equity.find((e) => e.spy)?.spy ?? null;
  return (
    <MultiLine
      label="Autopilot equity vs the S&P 500, rebased to 100"
      height={height}
      baseline={100}
      format={(v) => v.toFixed(1)}
      series={[
        { key: "bot", label: "Autopilot", color: "var(--chart-1)", points: equity.map((e) => ({ x: e.date, y: (e.equity / capital) * 100 })) },
        ...(spy0 ? [{ key: "spy", label: "S&P 500", color: "var(--muted-foreground)", points: equity.map((e) => ({ x: e.date, y: e.spy ? (e.spy / spy0) * 100 : null })) }] : []),
      ]}
    />
  );
}
