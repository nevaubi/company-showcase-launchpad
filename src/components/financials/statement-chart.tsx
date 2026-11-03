import { X } from "lucide-react";
import { ComboChart, CHART_COLORS, type ComboSeries } from "@/components/charts/combo-chart";
import { useSource } from "@/components/source/source-context";
import type { Row, Statement } from "@/lib/financials/types";
import { fmtCell, scaled, unitLabel, type Scale } from "@/lib/format";

/** Charts the rows a user picked from a statement table; bars and points open the SEC source. */
export function StatementChart({
  statement,
  keys,
  ticker,
  scale,
  maxPeriods,
  onRemove,
}: {
  statement: Statement;
  keys: string[];
  ticker: string;
  scale: Scale;
  maxPeriods?: number;
  onRemove: (key: string) => void;
}) {
  const { open } = useSource();
  const start = maxPeriods ? Math.max(0, statement.periods.length - maxPeriods) : 0;
  const periods = statement.periods.slice(start);
  const rows = keys.map((k) => statement.rows.find((r) => r.key === k)).filter((r): r is Row => !!r);
  if (!rows.length) return null;

  const hasDollar = rows.some((r) => r.unit === "usd" || r.unit === "shares");
  const series: ComboSeries[] = rows.map((r, i) => {
    const bar = r.unit === "usd" || r.unit === "shares" || (!hasDollar && r.unit === "usdPerShare");
    return {
      id: r.key,
      label: r.label,
      color: CHART_COLORS[i % CHART_COLORS.length],
      type: bar ? "bar" : "line",
      axis: hasDollar && !bar ? "right" : "left",
      values: r.cells.slice(start).map((c) => (c ? scaled(c.v, r.unit, scale) : null)),
      format: (v) =>
        r.unit === "usd" || r.unit === "shares"
          ? `${v < 0 ? "−" : ""}${r.unit === "usd" ? "$" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: scale === "B" ? 1 : 0 })}${scale === "full" ? "" : scale}`
          : fmtCell(v, r.unit, scale),
      onSelect: (i) => {
        const c = r.cells[start + i];
        if (c) open({ ticker, label: r.label, periodLabel: periods[i].label, unit: r.unit, value: c.v, src: c.src, alts: c.alts, derived: c.derived, approx: c.approx });
      },
    };
  });
  const leftUnit = rows.find((r) => series.find((s) => s.id === r.key)?.axis !== "right")?.unit ?? "usd";

  return (
    <div className="min-w-0 rounded-lg border bg-card p-3 shadow-paper sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {rows.map((r, i) => (
          <span key={r.key} className="inline-flex items-center gap-1.5 rounded-full border bg-secondary/60 py-0.5 pl-2 pr-1 text-xs">
            <span className="size-2 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {r.label}
            <span className="num text-[10px] text-muted-foreground">{unitLabel(r.unit, scale)}</span>
            <button type="button" onClick={() => onRemove(r.key)} aria-label={`Remove ${r.label} from chart`} className="grid size-4 place-items-center rounded-full hover:bg-card">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">Use the chart icon beside any line to add it (up to 4)</span>
      </div>
      <ComboChart
        categories={periods.map((p) => p.label)}
        series={series}
        height={230}
        leftFormat={(v) => (leftUnit === "pct" ? `${(v * 100).toFixed(0)}%` : leftUnit === "ratio" ? `${v.toFixed(1)}×` : leftUnit === "usdPerShare" ? `$${v.toFixed(2)}` : compactAxis(v))}
        rightFormat={(v) => {
          const u = rows.find((r) => series.find((s) => s.id === r.key)?.axis === "right")?.unit;
          return u === "pct" ? `${(v * 100).toFixed(0)}%` : u === "ratio" ? `${v.toFixed(1)}×` : u === "days" ? `${v.toFixed(0)}d` : v.toFixed(2);
        }}
      />
    </div>
  );
}

function compactAxis(v: number) {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : a.toFixed(a < 10 ? 1 : 0);
  return v < 0 ? `−${s}` : s;
}
