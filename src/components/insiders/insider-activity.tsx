// Insider activity, person by person: the share price with trades marked on it, a window you drag to
// pick a period, and one lane per insider underneath that follows the window. Built from Arc
// components (brush chart, segmented control, switch, avatar, animated counter) on Arc tokens.
import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import "@/components/fu-landing/components/arc/foundation.css";
import { AnimatedCounter } from "@/components/fu-landing/components/arc/animated-counter/animated-counter";
import { Avatar } from "@/components/fu-landing/components/arc/avatar/avatar";
import { BrushChart } from "@/components/fu-landing/components/arc/brush-chart/brush-chart";
import SegmentedControl from "@/components/fu-landing/components/arc/segmented-control/segmented-control";
import { Switch } from "@/components/fu-landing/components/arc/switch/switch";
import { CompanyLogo } from "@/components/app/company-logo";
import type { Bar, InsiderTrade } from "@/lib/financials/types";
import { buyClusters, filterTrades, fmtUsdShort, inRange, lanes, marketTrades, summarize, toMs, tradeMarks, type MarketTrade, type Side } from "@/lib/insiders/activity";
import { cn } from "@/lib/utils";
import styles from "./insider-activity.module.css";

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDay = (ms: number) => dayFmt.format(new Date(ms));
const SIDES = [
  { value: "all", label: "All trades" },
  { value: "buy", label: "Buys" },
  { value: "sell", label: "Sells" },
];
const LANES_SHOWN = 8;

/** A dollar figure that rolls to its new value: $1.4M, $249K. */
function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const abs = Math.abs(value);
  const [n, suffix, decimals] = abs >= 1e9 ? [abs / 1e9, "B", 1] : abs >= 1e6 ? [abs / 1e6, "M", 1] : abs >= 1e3 ? [abs / 1e3, "K", 0] : [abs, "", 0];
  return <AnimatedCounter value={Number(n.toFixed(decimals as number))} prefix={value < 0 ? "−$" : signed && value > 0 ? "+$" : "$"} suffix={suffix as string} decimals={decimals as number} />;
}

export function InsiderActivity({
  ticker,
  insiders,
  bars,
  onOpen,
}: {
  ticker: string;
  insiders: InsiderTrade[];
  /** Daily bars, oldest first. */
  bars: Bar[];
  /** Open the Form 4 behind a trade. */
  onOpen?: (trade: MarketTrade) => void;
}) {
  const [side, setSide] = useState<Side>("all");
  const [hidePlanned, setHidePlanned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; trade: MarketTrade } | null>(null);

  const series = useMemo(() => bars.filter((b) => Number.isFinite(b[4])).map((b) => ({ date: toMs(b[0]), close: b[4] })), [bars]);
  const first = series[0]?.date ?? 0;
  const last = series[series.length - 1]?.date ?? 0;
  const [range, setRange] = useState<[number, number] | null>(null);
  const [from, to] = range ?? [first, last];

  const all = useMemo(() => marketTrades(insiders).filter((t) => t.at >= first && t.at <= last), [insiders, first, last]);
  const shown = useMemo(() => filterTrades(all, side, hidePlanned), [all, side, hidePlanned]);
  const totals = useMemo(() => summarize(shown, from, to), [shown, from, to]);
  const rows = useMemo(() => lanes(shown, from, to), [shown, from, to]);
  const cluster = useMemo(() => buyClusters(all).filter((c) => c.to >= from && c.from <= to).at(-1), [all, from, to]);

  // The Arc chart draws from zero, which flattens a share price. Plot the distance above a round floor
  // and add the floor back in every label, so the axis reads in real prices.
  const floor = useMemo(() => {
    const low = Math.min(...series.map((p) => p.close));
    const step = low >= 200 ? 50 : low >= 40 ? 10 : low >= 10 ? 5 : 1;
    return Number.isFinite(low) ? Math.max(0, Math.floor((low * 0.94) / step) * step) : 0;
  }, [series]);
  const data = useMemo(() => series.map((p) => ({ date: p.date, value: p.close - floor })), [series, floor]);
  const annotations = useMemo(() => tradeMarks(shown).map((m) => ({ date: m.at, label: m.label, description: m.description })), [shown]);
  const closeAt = (ms: number) => {
    let hit = series[0];
    for (const p of series) {
      if (p.date > ms) break;
      hit = p;
    }
    return hit?.close ?? null;
  };
  const startPx = closeAt(from);
  const endPx = closeAt(to);
  const latest = series[series.length - 1]?.close ?? null;
  const move = startPx && endPx ? endPx / startPx - 1 : null;
  const biggest = Math.max(1, ...shown.map((t) => t.value));
  const visible = expanded ? rows : rows.slice(0, LANES_SHOWN);

  if (series.length < 2) return null;

  return (
    <section className="fu-landing" data-accent="blue" aria-label={`${ticker} insider activity`}>
      <div className={styles.root}>
        <header className={styles.head}>
          <div>
            <div className={styles.title}>
              <CompanyLogo ticker={ticker} size="md" />
              <h2>{ticker} insider trades against the share price</h2>
            </div>
            <p>Drag the window under the chart to pick a period. The totals and the lanes below follow it.</p>
          </div>
          <div className={styles.controls}>
            <SegmentedControl label="Trades shown" options={SIDES} value={side} onValueChange={(v) => setSide(v as Side)} />
            <Switch checked={hidePlanned} onCheckedChange={setHidePlanned} label="Hide pre-scheduled trades" />
          </div>
        </header>

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Bought</dt>
            <dd><Money value={totals.bought} /></dd>
            <small>{totals.buys} {totals.buys === 1 ? "trade" : "trades"} by {totals.buyers} {totals.buyers === 1 ? "insider" : "insiders"}</small>
          </div>
          <div className={styles.stat}>
            <dt>Sold</dt>
            <dd><Money value={totals.sold} /></dd>
            <small>{fmtUsdShort(totals.soldByDecision)} by choice, the rest pre-scheduled</small>
          </div>
          <div className={styles.stat}>
            <dt>Net</dt>
            <dd><Money value={totals.net} signed /></dd>
            <small>{totals.net > 0 ? "Net buying" : totals.net < 0 ? "Net selling" : "No net change"}</small>
          </div>
          <div className={styles.stat}>
            <dt>Share price over period</dt>
            <dd>{move == null ? "n/a" : `${move >= 0 ? "+" : "−"}${Math.abs(move * 100).toFixed(1)}%`}</dd>
            <small>{startPx && endPx ? `$${startPx.toFixed(2)} to $${endPx.toFixed(2)}` : ""}</small>
          </div>
        </dl>

        {cluster && (
          <p className={styles.note}>
            <Users size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>
              <b style={{ fontWeight: 500, color: "var(--foreground)" }}>{cluster.people.length} insiders bought {fmtUsdShort(cluster.value)} by choice</b> between {fmtDay(cluster.from)} and {fmtDay(cluster.to)}: {cluster.people.slice(0, 4).join(", ")}
              {cluster.people.length > 4 ? ` and ${cluster.people.length - 4} more` : ""}.
            </span>
          </p>
        )}

        <BrushChart
          data={data}
          label={`${ticker} share price with insider trades`}
          formatValue={(v) => `$${(v + floor).toFixed(2)}`}
          formatTick={(v) => `$${Math.round(v + floor)}`}
          formatDate={(d) => dayFmt.format(d)}
          annotations={annotations}
          range={range ?? undefined}
          defaultRange={[first, last]}
          onRangeChange={setRange}
          minSpan={14 * 86_400_000}
          height={260}
        />

        <div>
          <ul className={styles.legend} aria-label="Legend">
            <li><span className={cn(styles.key, styles.buy)} /> Buy</li>
            <li><span className={cn(styles.key, styles.sell)} /> Sell</li>
            <li><span className={cn(styles.key, styles.sell)} data-plan="true" /> Pre-scheduled plan (10b5-1)</li>
            <li>Dot size is dollar value</li>
          </ul>
          <div className={styles.lanes} style={{ marginTop: "var(--space-3)" }}>
            {visible.length === 0 && <p className={styles.empty}>No {side === "buy" ? "purchases" : side === "sell" ? "sales" : "open-market trades"} in this period. Widen the window or change the filter.</p>}
            {visible.map((lane) => (
              <div key={lane.owner} className={styles.lane}>
                <div className={styles.who}>
                  <Avatar name={lane.owner} size="md" />
                  <div>
                    <strong>{lane.owner}</strong>
                    <span>{lane.role}</span>
                  </div>
                </div>
                <div className={styles.net}>
                  {lane.net >= 0 ? "+" : "−"}{fmtUsdShort(Math.abs(lane.net))}
                  <small>{lane.trades.length} {lane.trades.length === 1 ? "trade" : "trades"}</small>
                </div>
                <div className={styles.track}>
                  {lane.trades.filter((t) => inRange(t, from, to)).map((t, i) => (
                    <button
                      key={`${t.accn}-${i}`}
                      type="button"
                      className={cn(styles.dot, t.buy ? styles.buy : styles.sell)}
                      data-plan={t.plan}
                      style={{ left: `${to > from ? ((t.at - from) / (to - from)) * 100 : 50}%`, ["--size" as string]: `${Math.round(10 + Math.sqrt(t.value / biggest) * 16)}px` }}
                      aria-label={`${lane.owner} ${t.buy ? "bought" : "sold"} ${fmtUsdShort(t.value)} on ${fmtDay(t.at)}${t.plan ? ", pre-scheduled" : ""}. Open the Form 4.`}
                      onClick={() => onOpen?.(t)}
                      onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, trade: t })}
                      onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, trade: t })}
                      onPointerLeave={() => setTip(null)}
                      onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.right, y: r.top, trade: t }); }}
                      onBlur={() => setTip(null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {rows.length > LANES_SHOWN && (
            <button type="button" className={styles.more} onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show fewer" : `Show all ${rows.length} insiders`}
            </button>
          )}
        </div>
      </div>
      {tip && (
        <div className={styles.tip} role="tooltip" style={{ left: Math.min(tip.x + 14, (typeof window === "undefined" ? 1200 : window.innerWidth) - 276), top: tip.y + 16 }}>
          <strong>{tip.trade.owner}</strong>
          {tip.trade.buy ? "Bought" : "Sold"} {fmtUsdShort(tip.trade.value)} at ${tip.trade.price.toFixed(2)}
          <br />
          {fmtDay(tip.trade.at)} · {tip.trade.plan ? "pre-scheduled plan" : "open-market decision"}
          {latest ? (
            <>
              <br />
              Share price since: {latest / tip.trade.price - 1 >= 0 ? "+" : "−"}{Math.abs((latest / tip.trade.price - 1) * 100).toFixed(0)}%
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
