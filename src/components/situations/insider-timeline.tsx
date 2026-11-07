import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import LoadingState from "@/components/ui/loading-state";
import { usePrices } from "@/lib/data";
import type { InsiderTrade } from "@/lib/financials/types";
import { fmtCompactUsd, fmtDate, fmtPrice } from "@/lib/format";
import { timelinePoints, totals, type TimelinePoint } from "@/lib/situations/insiders";
import { cn } from "@/lib/utils";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 720));
    ro.observe(el);
    setW(el.clientWidth || 720);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const RANGES = { "1y": 365, "2y": 730, "5y": 1826 } as const;
type RangeKey = keyof typeof RANGES;

const STYLE: Record<string, { fill: string; stroke: string; label: string }> = {
  buy: { fill: "var(--positive)", stroke: "var(--positive)", label: "Discretionary buy" },
  sell: { fill: "var(--negative)", stroke: "var(--negative)", label: "Discretionary sale" },
  plan: { fill: "transparent", stroke: "var(--negative)", label: "10b5-1 plan sale" },
};

/** Form 4 trades over the price line: size on a log scale, discretionary vs plan, funds and 10% owners on their own layer. */
export function InsiderTimeline({ ticker, insiders }: { ticker: string; insiders: InsiderTrade[] }) {
  const [range, setRange] = useState<RangeKey>("2y");
  const [layer, setLayer] = useState<"insiders" | "holders" | "both">("insiders");
  const [hover, setHover] = useState<TimelinePoint | null>(null);
  const prices = usePrices(ticker, range === "1y" ? "1y" : range === "2y" ? "2y" : "5y");
  const { open } = useSource();
  const [ref, width] = useWidth<HTMLDivElement>();
  const all = useMemo(() => timelinePoints(insiders), [insiders]);
  const since = useMemo(() => new Date(Date.now() - RANGES[range] * 86400_000).toISOString().slice(0, 10), [range]);
  const pts = all.filter(
    (p) => p.date >= since && (layer === "both" || (layer === "holders" ? p.holder : !p.holder)),
  );
  const t90 = totals(all, new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10));
  const hasHolders = all.some((p) => p.holder);

  const H = 260, padL = 52, padR = 52, padT = 12, padB = 26;
  const W = Math.max(320, width);
  const bars = (prices.data?.bars ?? []).filter((b) => b[0].slice(0, 10) >= since);
  const x0 = new Date(since).getTime(), x1 = Date.now();
  const X = (d: string) => padL + ((new Date(d).getTime() - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
  const closes = bars.map((b) => b[4]).filter((c) => c > 0);
  const pMin = closes.length ? Math.min(...closes) : 0, pMax = closes.length ? Math.max(...closes) : 1;
  const P = (c: number) => padT + (1 - (c - pMin) / Math.max(1e-9, pMax - pMin)) * (H - padT - padB);
  const vals = pts.map((p) => p.value);
  const vMin = vals.length ? Math.max(1e3, Math.min(...vals)) : 1e4, vMax = vals.length ? Math.max(...vals) : 1e6;
  const lv0 = Math.floor(Math.log10(vMin)), lv1 = Math.ceil(Math.log10(Math.max(vMax, vMin * 10)));
  const V = (v: number) => padT + (1 - (Math.log10(Math.max(v, 1)) - lv0) / Math.max(1, lv1 - lv0)) * (H - padT - padB);
  const priceLine = bars.map((b, i) => `${i ? "L" : "M"}${X(b[0]).toFixed(1)},${P(b[4]).toFixed(1)}`).join("");
  const ticks = Array.from({ length: lv1 - lv0 + 1 }, (_, i) => lv0 + i);
  const months: string[] = [];
  for (let d = new Date(since); d.getTime() <= x1; d.setMonth(d.getMonth() + (range === "5y" ? 12 : range === "2y" ? 6 : 3)))
    months.push(d.toISOString().slice(0, 10));

  const openPoint = (p: TimelinePoint) =>
    open({
      ticker,
      label: `${p.owner}: Form 4`,
      periodLabel: p.date,
      unit: "shares",
      value: p.shares,
      doc: { accn: p.accn, doc: p.doc, title: `Form 4 filed ${p.filed}` },
    });

  return (
    <Panel
      title="Insider timeline"
      subtitle={`Open-market Form 4 trades over the share price. Last 90 days: ${t90.buys} discretionary buys (${fmtCompactUsd(t90.buyValue)}, ${t90.buyers} ${t90.buyers === 1 ? "person" : "people"}), ${t90.sells} discretionary sales (${fmtCompactUsd(t90.sellValue)}), ${t90.plan} plan sales (${fmtCompactUsd(t90.planValue)})`}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {hasHolders && (
            <Segmented
              label="Layer"
              value={layer}
              onChange={setLayer}
              options={[
                { v: "insiders", l: "Officers & directors" },
                { v: "holders", l: "Funds & 10% owners" },
                { v: "both", l: "Both" },
              ]}
            />
          )}
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={(Object.keys(RANGES) as RangeKey[]).map((r) => ({ v: r, l: r.toUpperCase() }))}
          />
        </div>
      }
      collapse={false}
    >
      <div ref={ref} className="relative px-2 py-2">
        {prices.isLoading ? (
          <LoadingState label="Loading prices" variant="Dots" className="p-4" />
        ) : (
          <svg width={W} height={H} role="img" aria-label={`${ticker} insider trades over price`} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={V(10 ** t)} y2={V(10 ** t)} stroke="var(--border)" strokeWidth={0.6} />
                <text x={padL - 6} y={V(10 ** t) + 3} textAnchor="end" className="num fill-muted-foreground text-[10px]">
                  {fmtCompactUsd(10 ** t, 0)}
                </text>
              </g>
            ))}
            {months.map((m) => (
              <text key={m} x={X(m)} y={H - 8} textAnchor="middle" className="num fill-muted-foreground text-[10px]">
                {m.slice(0, 7)}
              </text>
            ))}
            {closes.length > 1 && (
              <>
                <path d={priceLine} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1.2} />
                {[pMin, pMax].map((c) => (
                  <text key={c} x={W - padR + 6} y={P(c) + 3} className="num fill-muted-foreground text-[10px]">
                    {fmtPrice(c)}
                  </text>
                ))}
              </>
            )}
            {pts.map((p, i) => {
              const s = STYLE[p.kind];
              const r = 3 + Math.min(6, Math.max(0, Math.log10(Math.max(p.value, 1)) - 4));
              return (
                <g
                  key={`${p.accn}-${i}`}
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => openPoint(p)}
                  className="cursor-pointer"
                >
                  {p.holder ? (
                    <rect
                      x={X(p.date) - r}
                      y={V(p.value) - r}
                      width={2 * r}
                      height={2 * r}
                      fill={s.fill}
                      fillOpacity={p.kind === "plan" ? 0 : 0.5}
                      stroke={s.stroke}
                      strokeWidth={1.2}
                    />
                  ) : (
                    <circle
                      cx={X(p.date)}
                      cy={V(p.value)}
                      r={r}
                      fill={s.fill}
                      fillOpacity={p.kind === "plan" ? 0 : 0.6}
                      stroke={s.stroke}
                      strokeWidth={1.2}
                      strokeDasharray={p.kind === "plan" ? "2 1.5" : undefined}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[320px] rounded-md border bg-popover px-2.5 py-1.5 text-[11.5px] shadow-sm">
            <p className="font-medium">{hover.owner}</p>
            <p className="text-muted-foreground">{hover.role || (hover.holder ? "Fund / 10% owner" : "Insider")}</p>
            <p className="num tabular-nums">
              {STYLE[hover.kind].label} · {fmtDate(hover.date)} · {Math.round(hover.shares).toLocaleString()} sh @{" "}
              {fmtPrice(hover.price)} = {fmtCompactUsd(hover.value)}
            </p>
            {hover.joint.length > 0 && (
              <p className="text-muted-foreground">Also reported by {hover.joint.join(", ")} (drawn once)</p>
            )}
            <p className="text-muted-foreground">Click to open the Form 4 filed {fmtDate(hover.filed)}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 px-1 pt-1 text-[11px] text-muted-foreground">
          {(["buy", "sell", "plan"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <svg width={12} height={12} aria-hidden>
                <circle
                  cx={6}
                  cy={6}
                  r={4.5}
                  fill={STYLE[k].fill}
                  fillOpacity={k === "plan" ? 0 : 0.6}
                  stroke={STYLE[k].stroke}
                  strokeDasharray={k === "plan" ? "2 1.5" : undefined}
                />
              </svg>
              {STYLE[k].label}
            </span>
          ))}
          {hasHolders && (
            <span className="inline-flex items-center gap-1">
              <svg width={12} height={12} aria-hidden>
                <rect x={1.5} y={1.5} width={9} height={9} fill="transparent" stroke="currentColor" />
              </svg>
              Fund or 10% owner
            </span>
          )}
          <span className={cn(!pts.length && "text-foreground")}>
            {pts.length ? `${pts.length} trades shown; size = trade value (log scale)` : "No open-market trades in this range."}
          </span>
        </div>
      </div>
    </Panel>
  );
}
