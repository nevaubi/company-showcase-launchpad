import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { PriceChart, type ChartMarker, type ChartPane, type Overlay } from "@/components/charts/price-chart";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrices, type Interval, type Range } from "@/lib/data";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import type { Technicals } from "@/lib/technicals/analysis";
import { barsInRange } from "@/lib/technicals/chart-model";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { Note, TechPanel } from "./ui";
import type { SymbolHistory } from "./use-technicals";

export const CHART_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
/** Ranges left out of the selector at phone width so it fits on one line (still reachable through the address). */
const PHONE_HIDDEN = new Set<ChartRange>(["5d", "2y", "10y"]);

/** True below Tailwind's sm breakpoint (640 px). */
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639.98px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

const RANGE_LABEL: Record<ChartRange, string> = { "1d": "1D", "5d": "5D", "1mo": "1M", "3mo": "3M", "6mo": "6M", ytd: "YTD", "1y": "1Y", "2y": "2Y", "5y": "5Y", "10y": "10Y", max: "Max" };
const INTRADAY: Partial<Record<ChartRange, Interval>> = { "1d": "5m", "5d": "15m" };

type EventLayer = "earnings" | "filings" | "insiders";
interface ChartPrefs {
  mode: "candles" | "line";
  scale: "linear" | "log";
  overlays: Overlay[];
  panes: ChartPane[];
  events: EventLayer[];
  levels: boolean;
  compare: string;
}
const DEFAULTS: ChartPrefs = { mode: "candles", scale: "linear", overlays: ["sma50", "sma200"], panes: [], events: ["earnings"], levels: true, compare: "" };
const OVERLAYS: { id: Overlay; label: string; token: string }[] = [
  { id: "sma20", label: "SMA 20", token: "--chart-2" },
  { id: "sma50", label: "SMA 50", token: "--chart-1" },
  { id: "sma200", label: "SMA 200", token: "--chart-4" },
  { id: "ema21", label: "EMA 21", token: "--chart-3" },
  { id: "bb", label: "Bands", token: "--chart-5" },
];

/** A layer toggle: a real button with its pressed state, so keyboard users and the assistant can operate it. */
function Toggle({ on, onClick, children, swatch, title }: { on: boolean; onClick: () => void; children: React.ReactNode; swatch?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        on ? "border-foreground/30 bg-secondary font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {swatch && <span aria-hidden className="h-0 w-3" style={{ borderTop: `2px solid var(${swatch})`, opacity: on ? 1 : 0.45 }} />}
      {children}
    </button>
  );
}
const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-0.5">
    <span className="eyebrow mr-1 shrink-0">{label}</span>
    {children}
  </div>
);

/** Chart markers from the company's own filings: earnings releases, annual and quarterly reports, insider trades. */
export function eventMarkers(co: CompanyDataset | null, releases: { filed: string; accn: string; doc: string }[], layers: EventLayer[]): ChartMarker[] {
  const out: ChartMarker[] = [];
  if (layers.includes("earnings"))
    for (const r of releases) out.push({ time: r.filed, label: "E", color: "var(--chart-2)", title: `Earnings release, ${fmtDate(r.filed)}`, id: `8-K|${r.accn}|${r.doc}|${r.filed}` });
  if (co && layers.includes("filings"))
    for (const f of co.filings)
      if (f.form === "10-K" || f.form === "10-Q")
        out.push({ time: f.filed, label: f.form === "10-K" ? "K" : "Q", color: "var(--chart-3)", position: "belowBar", title: `${f.form} filed ${fmtDate(f.filed)}`, id: `${f.form}|${f.accn}|${f.doc}|${f.filed}` });
  if (co && layers.includes("insiders")) {
    // One marker a day and direction: net open-market dollars bought or sold above $250,000.
    const days = new Map<string, number>();
    for (const t of co.insiders) if (t.code === "P" || t.code === "S") days.set(t.date, (days.get(t.date) ?? 0) + (t.code === "P" ? 1 : -1) * t.shares * (t.price ?? 0));
    for (const [d, v] of days)
      if (Math.abs(v) > 250_000)
        out.push({
          time: d,
          label: v > 0 ? "B" : "S",
          color: v > 0 ? "var(--positive)" : "var(--negative)",
          position: "belowBar",
          title: `Insiders ${v > 0 ? "bought" : "sold"} $${(Math.abs(v) / 1e6).toFixed(1)}M net, ${fmtDate(d)}`,
        });
  }
  return out;
}

export function ChartPanel({
  symbol,
  history,
  loading,
  T,
  company,
  releases,
  sectorEtf,
  range,
  onRange,
}: {
  symbol: string;
  history: SymbolHistory | null;
  loading: boolean;
  T: Technicals | null;
  company: CompanyDataset | null;
  releases: { filed: string; accn: string; doc: string }[];
  sectorEtf?: string | null;
  range: ChartRange;
  onRange: (r: ChartRange) => void;
}) {
  const [prefs, setPrefs] = useSessionState<ChartPrefs>("fu:tech:chart", DEFAULTS, (v): v is ChartPrefs => !!v && typeof v === "object" && Array.isArray((v as ChartPrefs).overlays) && Array.isArray((v as ChartPrefs).panes) && Array.isArray((v as ChartPrefs).events));
  const set = <K extends keyof ChartPrefs>(k: K, v: ChartPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const flip = <K extends "overlays" | "panes" | "events">(k: K, id: ChartPrefs[K][number]) =>
    setPrefs((p) => ({ ...p, [k]: (p[k] as string[]).includes(id) ? (p[k] as string[]).filter((x) => x !== id) : [...(p[k] as string[]), id] }));
  const { open } = useSource();

  const intraday = INTRADAY[range];
  const phone = usePhone();
  const live = usePrices(symbol, (intraday ? range : "1mo") as Range, intraday ?? "1d", !!intraday);
  const compareOptions = [symbol !== "SPY" ? "SPY" : null, sectorEtf && sectorEtf !== symbol ? sectorEtf : null, symbol !== "QQQ" ? "QQQ" : null].filter((x): x is string => !!x);
  const compareSym = !intraday && compareOptions.includes(prefs.compare) ? prefs.compare : "";
  const cmp = usePrices(compareSym || "SPY", "10y", "1d", !!compareSym);

  const rows = intraday ? (live.data?.bars ?? []) : (history?.rows ?? []);
  const visible = intraday ? undefined : barsInRange(rows, range as Exclude<ChartRange, "1d" | "5d">);
  const markers = useMemo(() => (intraday ? [] : eventMarkers(company, releases, prefs.events)), [intraday, company, releases, prefs.events]);
  // Nearest two levels on each side of the close, from the swing clusters and the anchored VWAPs.
  const levels = useMemo(() => {
    if (!prefs.levels || !T || intraday) return [];
    const close = T.measures.close;
    // A wide zone of chained swing points is not a line: only tight levels and the anchored VWAPs are drawn.
    const pick = T.measures.levels.filter((l) => ((l.kind === "support" || l.kind === "resistance") && l.tight !== false) || l.kind === "vwap");
    const above = pick.filter((l) => l.price > close).slice(-2);
    const below = pick.filter((l) => l.price <= close).slice(0, 2);
    return [...above, ...below].map((l) => ({
      price: l.price,
      label: l.kind === "vwap" ? l.label.replace("VWAP from the ", "VWAP, ") : `${l.label}${l.touches ? `, ${l.touches} touches` : ""}`,
      color: l.kind === "vwap" ? "var(--chart-6)" : "var(--muted-foreground)",
    }));
  }, [prefs.levels, T, intraday]);

  const onMarker = (m: ChartMarker) => {
    if (!m.id) return;
    const [form, accn, doc, filed] = m.id.split("|");
    open({ ticker: symbol, label: m.title ?? form, periodLabel: fmtDate(filed), unit: "count", value: 0, doc: { accn, doc, form, filed, title: `${form} filed ${filed}` } });
  };

  const paneCount = intraday ? 0 : prefs.panes.length;
  const busy = intraday ? live.isPending : loading;
  const failed = intraday ? live.isError : !loading && !history;
  const hasEvents = !!company && !intraday;

  return (
    <TechPanel
      section="Price chart"
      id="chart"
      tour="tech-chart"
      title="Price"
      subtitle={
        intraday
          ? "Intraday bars from the live quote service"
          : history
            ? `Daily bars ${fmtDate(history.first)} to ${fmtDate(history.last)}${history.source === "prices" ? " (ten-year price file)" : ""}; drag sideways to move through history`
            : undefined
      }
      actions={
        <>
          <Segmented
            size="xs"
            label="Range"
            value={range}
            onChange={onRange}
            options={CHART_RANGES.filter((r) => !phone || !PHONE_HIDDEN.has(r) || r === range).map((r) => ({ v: r, l: RANGE_LABEL[r] }))}
          />
          <Segmented size="xs" label="Chart type" value={prefs.mode} onChange={(v) => set("mode", v)} options={[{ v: "candles", l: "Candles" }, { v: "line", l: "Line" }]} />
          <Segmented size="xs" label="Price scale" value={prefs.scale} onChange={(v) => set("scale", v)} options={[{ v: "linear", l: "Linear", title: "Equal distances are equal price changes" }, { v: "log", l: "Log", title: "Equal distances are equal percentage changes" }]} />
        </>
      }
    >
      <div data-agent-controls className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5">
        <Group label="Averages">
          {OVERLAYS.map((o) => (
            <Toggle key={o.id} on={prefs.overlays.includes(o.id)} onClick={() => flip("overlays", o.id)} swatch={o.token}>
              {o.label}
            </Toggle>
          ))}
        </Group>
        {!intraday && (
          <Group label="Show">
            <Toggle on={prefs.levels} onClick={() => set("levels", !prefs.levels)} title="Nearest tight support and resistance levels and the anchored VWAPs">
              Levels
            </Toggle>
            {hasEvents && (
              <>
                <Toggle on={prefs.events.includes("earnings")} onClick={() => flip("events", "earnings")} title="Earnings releases (8-K results)">
                  Earnings
                </Toggle>
                <Toggle on={prefs.events.includes("filings")} onClick={() => flip("events", "filings")} title="Annual and quarterly reports">
                  10-K / 10-Q
                </Toggle>
                <Toggle on={prefs.events.includes("insiders")} onClick={() => flip("events", "insiders")} title="Net insider buying or selling above $250,000 in a day">
                  Insiders
                </Toggle>
              </>
            )}
          </Group>
        )}
        {!intraday && (
          <Group label="Panes">
            <Toggle on={prefs.panes.includes("rsi")} onClick={() => flip("panes", "rsi")}>
              RSI
            </Toggle>
            <Toggle on={prefs.panes.includes("drawdown")} onClick={() => flip("panes", "drawdown")}>
              Drawdown
            </Toggle>
          </Group>
        )}
        {!intraday && compareOptions.length > 0 && (
          <Group label="Compare">
            {compareOptions.map((s) => (
              <Toggle key={s} on={compareSym === s} onClick={() => set("compare", compareSym === s ? "" : s)} swatch="--chart-6">
                {s}
              </Toggle>
            ))}
          </Group>
        )}
      </div>
      <div className="px-2 pb-1 pt-2">
        {failed ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            {intraday ? "Intraday prices are unavailable right now. Daily ranges use the stored history." : `No price history is stored for ${symbol} yet.`}
          </p>
        ) : busy || !rows.length ? (
          <Skeleton className="h-[420px]" />
        ) : (
          <PriceChart
            label={`${symbol} price`}
            bars={rows}
            visible={visible}
            mode={prefs.mode}
            scale={prefs.scale}
            overlays={prefs.overlays}
            panes={intraday ? [] : prefs.panes}
            markers={markers}
            levels={levels}
            fitLevels={false}
            compare={compareSym && cmp.data ? { label: compareSym, bars: cmp.data.bars } : null}
            onMarker={onMarker}
            height={420 + paneCount * 68}
          />
        )}
      </div>
      <Note>
        Averages use the whole history, so they are complete from the first bar shown. With more bars than pixels the candles are merged into weeks, months or quarters; the readout says which.
        {hasEvents ? " Markers open the filing." : ""}
      </Note>
    </TechPanel>
  );
}
