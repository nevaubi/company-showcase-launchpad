import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText } from "lucide-react";
import { Panel, Stat } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { useSource } from "@/components/source/source-context";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import LoadingState from "@/components/ui/loading-state";
import { pricesQuery, useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE } from "@/lib/coverage";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import { screenerFileQuery } from "@/lib/screener/use-rows";
import { rowsFromFile } from "@/lib/screener/engine";
import { crossQuery, rowsOf } from "@/lib/technicals/cross";
import { supplyLinksQuery } from "@/lib/supply/query";
import type { RiskLink } from "@/lib/supply/core";
import type { Bar } from "@/lib/financials/types";
import type { Holding } from "@/lib/portfolio/parse";
import {
  averageDollarVolume,
  buildPositions,
  concentration,
  exposureBy,
  factorExposure,
  governmentExposure,
  hiddenOverlap,
  liquidity,
  shockBook,
  shockCandidates,
  type FactorDef,
  type OverlapEvidence,
  type Position,
} from "@/lib/portfolio/analytics";
import { cn } from "@/lib/utils";

const FACTORS: FactorDef[] = [
  { id: "beta", label: "Beta to the S&P 500", unit: "ratio", source: "Screener: 1-year daily returns vs SPY" },
  { id: "mom12_1", label: "Momentum (12-month return excl. last month)", unit: "pct", source: "Quant cross-section" },
  { id: "vol60", label: "Volatility, 60-day annualized", unit: "pct", source: "Quant cross-section" },
  { id: "ret_3m", label: "Return, 3 months", unit: "pct", source: "Screener: daily closes" },
  { id: "rs_spy_6m", label: "Relative strength vs SPY, 6 months", unit: "pct", source: "Screener: daily closes" },
  { id: "c_tnx", label: "Correlation with the 10-year yield", unit: "corr", source: "Screener: 1-year daily return correlations" },
  { id: "c_oil", label: "Correlation with crude oil", unit: "corr", source: "Screener: 1-year daily return correlations" },
  { id: "c_dxy", label: "Correlation with the dollar index", unit: "corr", source: "Screener: 1-year daily return correlations" },
  { id: "c_btc", label: "Correlation with bitcoin", unit: "corr", source: "Screener: 1-year daily return correlations" },
];

const fmtF = (v: number | null, unit: FactorDef["unit"]) =>
  v == null ? "–" : unit === "pct" ? fmtPct(v, 1, true) : unit === "corr" ? v.toFixed(2) : v.toFixed(2);

const w = (v: number) => `${(v * 100).toFixed(1)}%`;

function useModel(holdings: Holding[]) {
  const tickers = useMemo(() => holdings.map((h) => h.ticker), [holdings]);
  const uni = useUniverse();
  const quotes = useQuotes(tickers);
  const screen = useQuery(screenerFileQuery);
  const cross = useQuery(crossQuery);
  const links = useQuery(supplyLinksQuery);
  const bars = useQueries({ queries: tickers.slice(0, 80).map((t) => ({ ...pricesQuery(t, "3mo", "1d"), staleTime: 30 * 60_000 })) });

  const screenRows = useMemo(() => new Map((screen.data ? rowsFromFile(screen.data) : []).map((r) => [r.ticker, r])), [screen.data]);
  const crossRows = useMemo(() => new Map((cross.data ? rowsOf(cross.data) : []).map((r) => [r.sym, r])), [cross.data]);
  const meta = useMemo(() => {
    const m = new Map<string, { name: string; sector: string; industry: string; mcap: number | null }>();
    for (const c of uni.data?.companies ?? []) {
      const s = screenRows.get(c.ticker);
      m.set(c.ticker, { name: c.name, sector: c.sector, industry: c.industry, mcap: typeof s?.mcap === "number" ? s.mcap : null });
    }
    return m;
  }, [uni.data, screenRows]);
  const prices = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol.toUpperCase(), q.price])), [quotes.data]);
  const built = useMemo(() => buildPositions(holdings, prices, meta), [holdings, prices, meta]);
  const values = useMemo(() => {
    const m = new Map<string, Record<string, number | null>>();
    for (const t of tickers) {
      const s = screenRows.get(t) ?? {};
      const c = crossRows.get(t) ?? {};
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      m.set(t, { beta: n((s as Record<string, unknown>).beta) ?? n((c as Record<string, unknown>).beta), mom12_1: n((c as Record<string, unknown>).mom12_1), vol60: n((c as Record<string, unknown>).vol60), ret_3m: n((s as Record<string, unknown>).ret_3m), rs_spy_6m: n((s as Record<string, unknown>).rs_spy_6m), c_tnx: n((s as Record<string, unknown>).c_tnx), c_oil: n((s as Record<string, unknown>).c_oil), c_dxy: n((s as Record<string, unknown>).c_dxy), c_btc: n((s as Record<string, unknown>).c_btc) });
    }
    return m;
  }, [tickers, screenRows, crossRows]);
  const adv = useMemo(() => {
    const m = new Map<string, number | null>();
    tickers.slice(0, 80).forEach((t, i) => m.set(t, averageDollarVolume(bars[i]?.data?.bars as Bar[] | undefined)));
    return m;
  }, [tickers, bars]);
  const names = useMemo(() => Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])), []);
  const revenue = useMemo(() => Object.fromEntries((uni.data?.companies ?? []).map((c) => [c.ticker, c.revenueTTM ?? undefined])), [uni.data]);
  const all = (links.data ?? []) as RiskLink[];
  return {
    ...built,
    loading: uni.isLoading || quotes.isLoading,
    screenAsOf: screen.data?.asof?.prices ?? null,
    crossAsOf: cross.data?.as_of ?? null,
    values,
    adv,
    advLoading: bars.some((b) => b.isLoading),
    links: all,
    linksLoading: links.isLoading,
    names,
    revenue,
  };
}

export function PortfolioView({ holdings }: { holdings: Holding[] }) {
  const m = useModel(holdings);
  const { positions } = m;
  const conc = useMemo(() => concentration(positions), [positions]);
  const sectors = useMemo(() => exposureBy(positions, "sector"), [positions]);
  const industries = useMemo(() => exposureBy(positions, "industry").slice(0, 12), [positions]);
  const factors = useMemo(() => factorExposure(positions, m.values, FACTORS), [positions, m.values]);
  const overlap = useMemo(() => hiddenOverlap(positions, m.links), [positions, m.links]);
  const gov = useMemo(() => governmentExposure(positions, m.links), [positions, m.links]);
  const liq = useMemo(() => liquidity(positions, m.adv), [positions, m.adv]);

  if (m.loading) return <LoadingState label="Pricing holdings" variant="Drive" className="py-8" />;
  const basisText = { value: "market value (shares × last price)", weights: "the weights you gave", mixed: "your weights, the rest by market value", equal: "equal weights (no shares or weights given)" }[m.basis];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Positions", value: String(conc.count), sub: `weighted by ${m.basis === "value" ? "market value" : m.basis}` },
          { label: "Market value", value: m.total ? fmtCompactUsd(m.total) : "–", sub: m.basis === "value" ? "shares × last price" : "needs share counts" },
          { label: "Largest position", value: w(conc.top1), sub: positions[0]?.ticker ?? "" },
          { label: "Top five", value: w(conc.top5), sub: `top ten ${w(conc.top10)}` },
          { label: "Effective positions", value: conc.effectiveN.toFixed(1), sub: "1 / sum of squared weights" },
          { label: "Government revenue", value: gov.coverage ? w(gov.weighted) : "–", sub: gov.coverage ? `disclosed by ${gov.rows.length} holdings (${w(gov.coverage)} of book)` : "none disclosed" },
        ].map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} sub={s.sub} className="bg-background" />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Weights use {basisText}. Measures that need data a holding lacks are averaged over the holdings that have it, and the coverage is shown.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sector exposure" subtitle="Share of the book by GICS sector">
          <Bars rows={sectors.map((s) => ({ label: s.key, value: s.weight, note: s.tickers.slice(0, 6).join(", ") }))} />
        </Panel>
        <Panel title="Industry exposure" subtitle="Largest twelve industries">
          <Bars rows={industries.map((s) => ({ label: s.key, value: s.weight, note: s.tickers.slice(0, 6).join(", ") }))} />
        </Panel>
      </div>

      <Panel title="Holdings" subtitle={m.screenAsOf ? `Valuation and returns from the screener, prices as of ${m.screenAsOf}` : undefined} collapse={520}>
        <HoldingsTable positions={positions} values={m.values} />
      </Panel>

      <Panel title="Factor and macro exposure" subtitle={`Book-weighted averages with the holdings that contribute most${m.crossAsOf ? ` · quant cross-section as of ${m.crossAsOf}` : ""}`}>
        <div className="overflow-x-auto">
          <table className="research-table">
            <thead>
              <tr>
                <th className="text-left">Measure</th>
                <th className="text-right">Book</th>
                <th className="text-right">Coverage</th>
                <th className="text-left">Largest contributors (holding: value)</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.label}
                    <span className="block text-[10.5px] text-muted-foreground">{f.source}</span>
                  </td>
                  <td className="num text-right font-medium">{fmtF(f.value, f.unit)}</td>
                  <td className="num text-right text-muted-foreground">{w(f.coverage)}</td>
                  <td className="text-[11.5px]">
                    {f.contributors.map((c) => (
                      <span key={c.ticker} className="mr-3 inline-block">
                        <Link to="/app/companies/$ticker" params={{ ticker: c.ticker }} className="font-medium hover:underline">
                          {c.ticker}
                        </Link>
                        <span className="num text-muted-foreground"> {fmtF(c.x, f.unit)}</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Hidden overlap" subtitle="Single-source suppliers and 10%+ customers that two or more holdings depend on, from their own filings">
          {m.linksLoading ? (
            <Skeleton className="h-40" />
          ) : overlap.length ? (
            <div className="grid gap-3">
              {overlap.slice(0, 12).map((g) => (
                <div key={g.key} className="border-b pb-2 last:border-0">
                  <p className="text-[13px]">
                    <span className="font-semibold">{g.counterpartyTicker ? `${g.counterparty} (${g.counterpartyTicker})` : g.counterparty}</span>
                    <span className="text-muted-foreground"> · {g.kind} for {g.holdings.length} holdings · {w(g.weight)} of the book</span>
                  </p>
                  <EvidenceList items={g.holdings} label={g.kind === "major customer" ? "of revenue" : null} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No supplier or customer is a shared single point of dependence across these holdings in the current filings.</p>
          )}
        </Panel>
        <Panel title="Government revenue" subtitle="Disclosed share of revenue from the U.S. government, defense branches, Medicare and Medicaid">
          {gov.rows.length ? (
            <EvidenceList items={gov.rows} label="of revenue" showName />
          ) : (
            <p className="text-sm text-muted-foreground">None of these holdings discloses a government customer share.</p>
          )}
        </Panel>
      </div>

      <ShockPanel m={m} />

      <Panel title="Concentration and liquidity" subtitle="Sessions to exit at 20% of average daily dollar volume (last 20 sessions); needs share counts" collapse={420}>
        {m.advLoading ? (
          <LoadingState label="Reading trading volumes" variant="Dots" />
        ) : (
          <div className="overflow-x-auto">
            <table className="research-table">
              <thead>
                <tr>
                  <th className="text-left">Holding</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Avg daily $ volume</th>
                  <th className="text-right">Days to exit</th>
                  <th className="text-right">Share of market cap</th>
                </tr>
              </thead>
              <tbody>
                {liq.map((r) => (
                  <tr key={r.ticker}>
                    <td className="font-medium">{r.ticker}</td>
                    <td className="num text-right">{w(r.weight)}</td>
                    <td className="num text-right">{r.value != null ? fmtCompactUsd(r.value) : "–"}</td>
                    <td className="num text-right">{r.adv != null ? fmtCompactUsd(r.adv) : "–"}</td>
                    <td className={cn("num text-right", (r.days ?? 0) > 5 && "font-semibold text-negative")}>{r.days != null ? (r.days < 0.1 ? "<0.1" : r.days.toFixed(1)) : "–"}</td>
                    <td className="num text-right">{r.ofMcap != null ? fmtPct(r.ofMcap, r.ofMcap < 0.001 ? 4 : 2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.value));
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-2 text-[12px]">
          <span className="truncate" title={r.note ? `${r.label}: ${r.note}` : r.label}>
            {r.label}
          </span>
          <span className="h-3 rounded-sm bg-muted">
            <span className="block h-3 rounded-sm bg-chart-1" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="num text-right">{w(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function HoldingsTable({ positions, values }: { positions: Position[]; values: Map<string, Record<string, number | null>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="research-table">
        <thead>
          <tr>
            <th className="text-left">Holding</th>
            <th className="text-left">Sector</th>
            <th className="text-right">Weight</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Price</th>
            <th className="text-right">Value</th>
            <th className="text-right">Unrealized</th>
            <th className="text-right">Beta</th>
            <th className="text-right">3M</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const v = values.get(p.ticker) ?? {};
            const pnl = p.cost != null && p.price != null && p.shares != null ? (p.price - p.cost) * p.shares : null;
            return (
              <tr key={p.ticker}>
                <td>
                  <Link to="/app/companies/$ticker" params={{ ticker: p.ticker }} className="flex items-center gap-2 hover:underline">
                    <CompanyLogo ticker={p.ticker} size="xs" />
                    <span className="font-medium">{p.ticker}</span>
                    <span className="hidden truncate text-muted-foreground sm:inline">{p.name}</span>
                  </Link>
                </td>
                <td className="text-muted-foreground">{p.sector}</td>
                <td className="num text-right font-medium">{w(p.weight)}</td>
                <td className="num text-right">{p.shares != null ? p.shares.toLocaleString() : "–"}</td>
                <td className="num text-right">{p.price != null ? `$${p.price.toFixed(2)}` : "–"}</td>
                <td className="num text-right">{p.value != null ? fmtCompactUsd(p.value) : "–"}</td>
                <td className={cn("num text-right", pnl != null && (pnl >= 0 ? "text-positive" : "text-negative"))}>{pnl != null ? fmtCompactUsd(pnl) : "–"}</td>
                <td className="num text-right">{v.beta != null ? v.beta.toFixed(2) : "–"}</td>
                <td className={cn("num text-right", v.ret_3m != null && (v.ret_3m >= 0 ? "text-positive" : "text-negative"))}>{v.ret_3m != null ? fmtPct(v.ret_3m, 1, true) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceList({ items, label, showName }: { items: (OverlapEvidence & { name?: string; counterparty?: string })[]; label: string | null; showName?: boolean }) {
  const { open } = useSource();
  return (
    <ul className="mt-1 grid gap-1">
      {items.map((h) => (
        <li key={`${h.ticker}:${h.accn}`} className="text-[12px]">
          <button
            type="button"
            className="group text-left"
            onClick={() => open({ ticker: h.ticker, label: `${h.ticker} ${h.form} filed ${h.filed}`, unit: "", value: 0, doc: { accn: h.accn, doc: h.doc, form: h.form, filed: h.filed, search: h.quote.slice(0, 160) } })}
          >
            <span className="font-medium">{h.ticker}</span>
            {showName && h.counterparty && <span className="text-muted-foreground"> · {h.counterparty}</span>}
            {label && h.share != null && <span className="num"> · {h.share}% {label}</span>}
            <span className="num text-muted-foreground"> · {w(h.weight)} of book</span>
            <FileText className="ml-1 inline size-3 opacity-50 group-hover:opacity-100" />
            <span className="block text-[11px] text-muted-foreground line-clamp-2">"{h.quote}" ({h.form} filed {h.filed})</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ShockPanel({ m }: { m: ReturnType<typeof useModel> }) {
  const candidates = useMemo(() => shockCandidates(m.positions, m.links), [m.positions, m.links]);
  const [src, setSrc] = useState<string>("");
  const [shock, setShock] = useState(25);
  const source = (src || candidates[0]?.ticker || "").toUpperCase();
  const result = useMemo(() => (source ? shockBook(source, shock / 100, m.positions, m.links, m.names, m.revenue) : null), [source, shock, m.positions, m.links, m.names, m.revenue]);
  const { open } = useSource();
  return (
    <Panel
      title="Supply shock on the book"
      subtitle="A demand or output drop at one company, propagated two steps through the holdings' disclosed customer and supplier links"
      actions={
        <Link to="/app/supply-chain" search={{ t: source || undefined }} className="text-[11px] text-muted-foreground hover:underline">
          Open the supply map
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Shocked company (ticker)</span>
          <Input value={src} onChange={(e) => setSrc(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))} placeholder={candidates[0]?.ticker ?? "TSM"} className="num h-8 w-28" />
        </label>
        <label className="grid w-56 gap-1 text-xs">
          <span className="text-muted-foreground">Size of the drop: {shock}%</span>
          <Slider value={[shock]} min={5} max={100} step={5} onValueChange={(v) => setShock(v[0] ?? 25)} />
        </label>
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[11px]">
            <span className="text-muted-foreground">Most linked to your holdings:</span>
            {candidates.slice(0, 8).map((c) => (
              <button key={c.ticker} type="button" onClick={() => setSrc(c.ticker)} className={cn("rounded border px-1.5 py-0.5 hover:bg-secondary", source === c.ticker && "border-foreground")}>
                {c.ticker} <span className="text-muted-foreground">({c.holdings})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {m.linksLoading ? (
        <LoadingState label="Loading supply links" variant="Orbit" />
      ) : !result || !result.rows.length ? (
        <p className="text-sm text-muted-foreground">
          {source ? `No holding is linked to ${source} within two steps in the disclosed filings.` : "Pick a company to shock."}
          {result && result.direct > 0 ? ` You hold ${source} directly (${w(result.direct)} of the book).` : ""}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-4 text-[12px]">
            <span>
              Quantified revenue at risk, book-weighted: <span className="num font-semibold">{fmtPct(result.quantified, 2)}</span>
            </span>
            <span className="text-muted-foreground">
              Exposed without a disclosed share: <span className="num">{w(result.unquantifiedWeight)}</span> of the book
            </span>
            {result.direct > 0 && <span className="text-muted-foreground">Held directly: {w(result.direct)}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="research-table">
              <thead>
                <tr>
                  <th className="text-left">Holding</th>
                  <th className="text-right">Weight</th>
                  <th className="text-left">Step</th>
                  <th className="text-left">Channel</th>
                  <th className="text-right">Revenue at risk</th>
                  <th className="text-right">Book impact</th>
                  <th className="text-left">Path and evidence</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 30).map((r) => (
                  <tr key={`${r.ticker}:${r.hop}:${r.channel}`}>
                    <td className="font-medium">{r.ticker}</td>
                    <td className="num text-right">{w(r.weight)}</td>
                    <td>{r.hop === 1 ? "First order" : "Second order"}</td>
                    <td className={cn(r.severity === "high" && "font-medium text-negative")}>{r.channel}</td>
                    <td className="num text-right">{r.revenuePct != null ? fmtPct(r.revenuePct, 2) : "not disclosed"}</td>
                    <td className="num text-right">{r.bookPct != null ? fmtPct(r.bookPct, 3) : "–"}</td>
                    <td className="text-[11.5px]">
                      {r.path.join(" → ")}
                      <button
                        type="button"
                        className="ml-2 text-muted-foreground hover:text-foreground hover:underline"
                        onClick={() => open({ ticker: r.link.ticker, label: `${r.link.ticker} ${r.link.form} filed ${r.link.filed}`, unit: "", value: 0, doc: { accn: r.link.accn, doc: r.link.doc, form: r.link.form, filed: r.link.filed, search: r.link.quote.slice(0, 160) } })}
                      >
                        {r.link.ticker} {r.link.form} {r.link.filed}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Revenue at risk is quantified only where a filing states the customer's share of revenue; second-order losses scale the first-order loss
            by the next link's share. Supply disruption downstream is flagged by severity, not sized.
          </p>
        </>
      )}
    </Panel>
  );
}
