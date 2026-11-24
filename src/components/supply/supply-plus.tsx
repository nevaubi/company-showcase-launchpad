import { useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCheck, CircleHelp, ExternalLink, Loader2, Microscope, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { returnsQuery } from "@/lib/markets/query";
import { supplyHistoryQuery } from "@/lib/supply/query";
import { concentrationHistory, ecosystemBasket, freshness, regionShock, type SignalLite } from "@/lib/supply/analytics";
import { dependencyScore, type GraphNode, type ProLink } from "@/lib/supply/core";
import { verifySupplyLink, type VerifyResult } from "@/lib/supply-verify.functions";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { quoteShown } from "@/lib/supply/quote-cut";

// ---------------------------------------------------------------- data

/** Light coverage-wide view of verified signals (country, kind, impact) for maps and region shocks. */
export const allSignalsQuery = {
  queryKey: ["supply_signals_all"],
  queryFn: async () => {
    const out: SignalLite[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("supply_signals").select("ticker,kind,country,impact,title,amount_usd").not("country", "is", null).range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as SignalLite[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
  staleTime: 10 * 60_000,
};

// ---------------------------------------------------------------- region shock

const SHOCK_PRESETS = ["Taiwan", "China", "Mexico", "Israel", "South Korea", "Japan", "India", "Germany"];
const SHOCK_ROWS = 12;

/** Which covered companies their own filings tie to one country, strongest first. Coverage-wide: a row maps that company. */
export function RegionShockPanel({ country, links, signals, revenue, names, onPick, onCountry, countries, current }: {
  /** the country in question; the page passes the one picked in the register, or its own default */
  country: string; links: ProLink[]; signals: SignalLite[]; revenue: Record<string, number | undefined>; names: Record<string, string>;
  onPick: (t: string) => void; onCountry: (c: string) => void; countries: string[]; current: string;
}) {
  const hits = useMemo(() => regionShock(country, links, signals, revenue), [country, links, signals, revenue]);
  const max = Math.max(1, ...hits.map((h) => h.score));
  const presets = SHOCK_PRESETS.filter((p) => countries.includes(p) || p === country);
  const options = (presets.includes(country) ? presets : [country, ...presets]).map((p) => ({ v: p, l: p }));
  return (
    <Panel title={`Region shock · ${country}`} subtitle="Across coverage" collapse={false} className="min-w-0">
      {options.length > 1 && <Segmented label="Country to cut off" size="xs" value={country} options={options} onChange={onCountry} className="mb-2" />}
      <p className="mb-2 text-xs text-muted-foreground">If {country} is cut off by export controls, conflict or tariffs, these covered companies are exposed through their own filings. The score weights single-source ties, stated dollars against revenue, facilities and policy items.</p>
      {!hits.length ? <p className="text-xs text-muted-foreground">No covered company ties a link or facility to {country}.</p> : (
        <ul className="divide-y border-y">
          {hits.slice(0, SHOCK_ROWS).map((h) => (
            <li key={h.ticker}>
              <button type="button" onClick={() => onPick(h.ticker)} aria-current={h.ticker === current ? "true" : undefined} title={`Map ${names[h.ticker] ?? h.ticker}`}
                className={cn("grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1.5 text-left transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none", h.ticker === current && "bg-highlight-soft")}>
                <CompanyLogo ticker={h.ticker} size="xs" decorative />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5"><span className="num text-[13px] font-semibold">{h.ticker}</span><span className="truncate text-[11px] text-muted-foreground">{names[h.ticker]}</span></span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", h.severity === "high" ? "bg-negative" : h.severity === "medium" ? "bg-warning" : "bg-foreground/40")} style={{ width: `${(h.score / max) * 100}%` }} /></span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {[h.singleSource && `${h.singleSource} single-source`, h.hq && `${h.hq} counterparties based there`, h.links && `${h.links} stated links`, h.facilities && `${h.facilities} facilities`, h.policy && `${h.policy} policy`, h.dollars && fmtCompactUsd(h.dollars)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={cn("num rounded px-1.5 py-0.5 text-xs font-semibold", h.severity === "high" ? "bg-negative-soft text-negative" : h.severity === "medium" ? "bg-warning-soft" : "bg-muted")}>{h.score}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits.length > SHOCK_ROWS && <p className="mt-2 text-[11px] text-muted-foreground">The <span className="num">{SHOCK_ROWS}</span> most exposed of <span className="num">{hits.length}</span> companies are listed.</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------- concentration history

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--negative)"];

export function ConcentrationHistory({ ticker, name }: { ticker: string; name: string }) {
  const { data, isLoading } = useQuery(supplyHistoryQuery(ticker));
  const h = useMemo(() => concentrationHistory(ticker, (data ?? []) as ProLink[]), [ticker, data]);
  return (
    <Panel title="Customer concentration history" collapse={false} className="min-w-0">
      {isLoading ? <Skeleton className="h-[220px] w-full" /> : h.points.length < 2 ? (
        <p className="text-xs text-muted-foreground">{name}'s 10-Ks do not state a named customer's revenue share in two or more years.</p>
      ) : (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <LineChart data={h.points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="filed" tickFormatter={(d) => String(d).slice(0, 4)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v}% of revenue`} labelFormatter={(d) => `10-K filed ${fmtDate(String(d))}`} />
                {h.series.map((s, i) => <Line key={s} dataKey={s} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
            {h.series.map((s, i) => <span key={s} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />{s}</span>)}
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- ecosystem basket

const WINDOWS = [{ v: 63, l: "3M" }, { v: 126, l: "6M" }, { v: 252, l: "1Y" }, { v: 750, l: "3Y" }];

export function EcosystemBasket({ ticker, name, graph }: { ticker: string; name: string; graph: GraphNode[] }) {
  const { data: rf } = useQuery(returnsQuery);
  const [win, setWin] = useState(252);
  const [side, setSide] = useState<"all" | "supplier" | "customer">("all");
  const members = useMemo(() => [...new Set(graph.filter((n) => n.ticker && n.relation !== "competitor" && (side === "all" || n.relation === side)).map((n) => n.ticker!))], [graph, side]);
  const b = useMemo(() => (rf ? ecosystemBasket(ticker, members, rf.dates, rf.returns as never, win) : null), [rf, ticker, members, win]);
  const rel = new Map(graph.map((n) => [n.ticker, n.relation]));
  return (
    <Panel
      title={`${name} ecosystem basket`}
      collapse={false}
      className="min-w-0"
      actions={
        <div className="flex flex-wrap justify-end gap-1.5">
          <Segmented label="Basket members" size="xs" value={side} options={[{ v: "all", l: "All" }, { v: "supplier", l: "Suppliers" }, { v: "customer", l: "Customers" }]} onChange={setSide} />
          <Segmented label="Window" size="xs" value={String(win)} options={WINDOWS.map((w) => ({ v: String(w.v), l: w.l }))} onChange={(v) => setWin(Number(v))} />
        </div>
      }
    >
      {!rf ? <Skeleton className="h-[260px] w-full" /> : !b ? (
        <p className="text-xs text-muted-foreground">No covered, listed {side === "all" ? "suppliers or customers" : `${side}s`} to build a basket from.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 grid grid-cols-4 gap-2">
              <Kpi label={`Basket (${b.members.length})`} v={b.basketRet} />
              <Kpi label={name} v={b.focusRet} />
              <Kpi label="S&P 500" v={b.spyRet} />
              <div className="rounded-md bg-muted/60 px-2 py-1.5"><p className="text-[11px] text-muted-foreground">Dispersion</p><p className="num text-sm font-semibold">{fmtPct(b.dispersion, 0)}</p></div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer>
                <AreaChart data={b.index} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bk" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { month: "short", year: "2-digit" })} minTickGap={50} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => v.toFixed(1)} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area dataKey="basket" name="Basket" stroke="var(--chart-1)" strokeWidth={2} fill="url(#bk)" />
                  <Area dataKey="focus" name={name} stroke="var(--foreground)" strokeWidth={1.5} fill="none" />
                  <Area dataKey="spy" name="S&P 500" stroke="var(--muted-foreground)" strokeDasharray="4 3" strokeWidth={1.2} fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_44px] gap-x-2 border-b pb-1 text-[11px] text-muted-foreground">
              <span>Member</span><span className="text-right">Return</span><span className="text-right">Vol</span><span className="text-right">ρ</span>
            </div>
            <ul>
              {b.members.map((m) => {
                const maxAbs = Math.max(...b.members.map((x) => Math.abs(x.ret)), 0.01);
                return (
                  <li key={m.ticker} className="grid grid-cols-[minmax(0,1fr)_64px_48px_44px] items-center gap-x-2 border-b border-border/50 py-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <CompanyLogo ticker={m.ticker} size="xs" />
                      <span className="num font-medium">{m.ticker}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{rel.get(m.ticker)}</span>
                    </span>
                    <span className="relative text-right">
                      <span className={cn("absolute inset-y-0.5 right-0 rounded-sm", m.ret >= 0 ? "bg-positive/15" : "bg-negative/15")} style={{ width: `${(Math.abs(m.ret) / maxAbs) * 100}%` }} />
                      <span className={cn("num relative font-semibold", m.ret >= 0 ? "text-positive" : "text-negative")}>{fmtPct(m.ret, 0, true)}</span>
                    </span>
                    <span className="num text-right text-muted-foreground">{fmtPct(m.vol, 0)}</span>
                    <span className="num text-right">{m.corr != null ? m.corr.toFixed(2).replace("-", "−") : "–"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Equal-weight, rebalanced daily. ρ is the daily correlation with {ticker}.</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Kpi({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1.5">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("num text-sm font-semibold", v == null ? "" : v >= 0 ? "text-positive" : "text-negative")}>{v == null ? "–" : fmtPct(v, 1, true)}</p>
    </div>
  );
}

// ---------------------------------------------------------------- freshness

export function FreshnessBadge({ filed, today }: { filed: string; today: string }) {
  const f = freshness(filed, today);
  return (
    <span title={`Last stated in a filing ${f.days} days ago`} className={cn("num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
      f.status === "fresh" ? "bg-positive-soft text-positive" : f.status === "aging" ? "bg-warning-soft" : "bg-negative-soft text-negative")}>
      <span className={cn("size-1.5 rounded-full", f.status === "fresh" ? "bg-positive" : f.status === "aging" ? "bg-warning" : "bg-negative")} />
      {f.status === "fresh" ? "Fresh" : f.status === "aging" ? "Aging" : "Stale"} · {f.days}d
    </span>
  );
}

// ---------------------------------------------------------------- deep verify

const VERDICT = {
  confirmed: { label: "Confirmed by independent sources", icon: CheckCheck, cls: "bg-positive-soft text-positive" },
  partly: { label: "Partly confirmed", icon: CircleHelp, cls: "bg-warning-soft" },
  unconfirmed: { label: "Not independently confirmed", icon: CircleHelp, cls: "bg-muted text-muted-foreground" },
  contradicted: { label: "Contradicted by newer sources", icon: XCircle, cls: "bg-negative-soft text-negative" },
} as const;

/** Runs a multi-search web cross-check of one link; results are cached and shared. */
export function DeepVerify({ linkId }: { linkId: string }) {
  const run = useServerFn(verifySupplyLink);
  const [go, setGo] = useState(false);
  const q = useQuery({ queryKey: ["supply-verify", linkId], queryFn: () => run({ data: { id: linkId } }), enabled: go, staleTime: Infinity, retry: false });
  if (!go) {
    return (
      <button type="button" onClick={() => setGo(true)} className="inline-flex min-h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        <Microscope className="size-3" /> Cross-check on the web
      </button>
    );
  }
  if (q.isLoading) return <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Searching, reading pages and checking every quote…</p>;
  const r = q.data as (VerifyResult & { cachedAt?: string }) | undefined;
  if (!r || r.error) return <p className="text-xs text-negative">{r?.error ?? (q.error as Error)?.message ?? "Check failed"}</p>;
  const v = VERDICT[r.verdict];
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold", v.cls)}><v.icon className="size-3" />{v.label}</span>
      {r.summary && <p className="text-xs">{r.summary}</p>}
      {r.facts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {r.facts.map((f, i) => <li key={i}>{f.text} <span className="text-[11px] text-muted-foreground">[{f.evidenceIds.map((x) => x.slice(1)).join(",")}]</span></li>)}
        </ul>
      )}
      <ul className="space-y-1.5">
        {r.evidence.slice(0, 8).map((e) => (
          <li key={e.id} className="text-[11px]">
            <span className={cn("mr-1 rounded px-1 text-[11px] font-medium", e.stance === "supports" ? "bg-positive-soft text-positive" : e.stance === "contradicts" ? "bg-negative-soft text-negative" : "bg-muted text-muted-foreground")}>{e.id.slice(1)} · {e.stance}</span>
            <span className="italic text-muted-foreground">“{quoteShown(e.quote)}”</span>{" "}
            <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">{new URL(e.url).hostname.replace(/^www\./, "")}{e.publishedAt && `, ${e.publishedAt.slice(0, 10)}`}<ExternalLink className="size-2.5" /></a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{r.searched} results searched · {r.read} pages read · only sentences naming both companies kept{r.cachedAt && ` · checked ${fmtDate(r.cachedAt)}`}</p>
    </div>
  );
}

// ---------------------------------------------------------------- fragility table

const FRAGILITY_ROWS = 15;

/**
 * Supply-chain fragility of every covered company, most fragile first. The table shows the top of the ranking and the
 * company the page is about (with its rank); the filter finds any other. No inner scroller: the list is short by design.
 */
export function FragilityTable({ tickers, all, names, onPick, current }: { tickers: string[]; all: ProLink[]; names: Record<string, string>; onPick: (t: string) => void; current: string }) {
  const rows = useMemo(() => {
    /* one pass to group the links by filer, so scoring 1,800 companies does not scan every link 1,800 times */
    const own = new Map<string, ProLink[]>();
    for (const l of all) { const list = own.get(l.ticker); if (list) list.push(l); else own.set(l.ticker, [l]); }
    return tickers.flatMap((t) => { const d = dependencyScore(t, own.get(t) ?? []); return d.score > 0 ? [{ t, d }] : []; })
      .sort((a, b) => b.d.score - a.d.score || a.t.localeCompare(b.t)).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [tickers, all]);
  const [q, setQ] = useState("");
  const query = q.trim();
  const matches = query ? rows.filter((r) => r.t.includes(query.toUpperCase()) || (names[r.t] ?? "").toLowerCase().includes(query.toLowerCase())) : rows;
  const top = matches.slice(0, FRAGILITY_ROWS);
  const mine = rows.find((r) => r.t === current);
  const shown = !query && mine && !top.includes(mine) ? [...top, mine] : top;
  /* the table keeps the height of its unfiltered state, so typing in the filter never changes the length of the page */
  const fullRows = Math.min(rows.length, FRAGILITY_ROWS) + (mine && mine.rank > FRAGILITY_ROWS ? 1 : 0);
  const filler = Math.max(0, fullRows - Math.max(shown.length, 1));
  const th = "border-b py-2 font-medium";
  return (
    <Panel title="Fragility across coverage" subtitle="Customer concentration, single-source inputs and geography, from each company's own filings" collapse={false} className="min-w-0"
      actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company" aria-label="Find a company in the ranking" className="h-7 w-36 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className={cn(th, "w-10 pl-1 text-right")}>Rank</th>
              <th scope="col" className={cn(th, "pl-3")}>Company</th>
              <th scope="col" className={cn(th, "w-[32%]")}>Score, of 100</th>
              <th scope="col" className={cn(th, "text-right")}>Top customer</th>
              <th scope="col" className={cn(th, "text-right")}>Single source</th>
              <th scope="col" className={cn(th, "pr-1 text-right")}>Hotspots</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ t, d, rank }) => (
              <tr key={t} className={cn("transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none", t === current && "bg-highlight-soft")}>
                <td className="num h-9 border-b pl-1 text-right text-muted-foreground">{rank}</td>
                <td className="h-9 border-b pl-3">
                  <button type="button" onClick={() => onPick(t)} aria-current={t === current ? "true" : undefined} title={`Map ${names[t] ?? t}`}
                    className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <CompanyLogo ticker={t} size="xs" decorative />
                    <span className="num font-semibold">{t}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{names[t]}</span>
                  </button>
                </td>
                <td className="h-9 border-b pr-3">
                  <span className="flex items-center gap-2">
                    <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted" title={d.parts.map((x) => `${x.label} ${x.points} of ${x.max}`).join(" · ")}>
                      <span className="bg-chart-1" style={{ width: `${d.parts[0].points}%` }} />
                      <span className="bg-negative" style={{ width: `${d.parts[1].points}%` }} />
                      <span className="bg-warning" style={{ width: `${d.parts[2].points}%` }} />
                    </span>
                    <span className={cn("num w-7 text-right font-semibold", d.score >= 50 && "text-negative")}>{d.score}</span>
                  </span>
                </td>
                <td className="num h-9 border-b text-right">{d.topCustomerPct ? `${d.topCustomerPct}%` : <span className="text-muted-foreground">–</span>}</td>
                <td className="num h-9 border-b text-right">{d.singleSource || <span className="text-muted-foreground">–</span>}</td>
                <td className="h-9 border-b pr-1 text-right">
                  {d.hotspots.length ? <span className="inline-flex flex-wrap justify-end gap-0.5">{d.hotspots.slice(0, 2).map((h) => <span key={h} className="rounded bg-negative-soft px-1 text-[11px] text-negative">{h}</span>)}</span> : <span className="text-muted-foreground">–</span>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="h-9 border-b text-xs text-muted-foreground">No company in the ranking matches “{query}”.</td></tr>}
            {Array.from({ length: filler }, (_, i) => <tr key={`filler-${i}`} aria-hidden="true"><td colSpan={6} className="h-9 border-b border-transparent" /></tr>)}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-chart-1" />Customer concentration, up to 40</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-negative" />Single source, up to 30</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-warning" />Geography, up to 30</span>
        <span className="ml-auto">{query ? <><span className="num">{Math.min(matches.length, FRAGILITY_ROWS)}</span> of <span className="num">{matches.length}</span> matches</> : <>Top <span className="num">{Math.min(rows.length, FRAGILITY_ROWS)}</span> of <span className="num">{rows.length}</span> companies with a score{mine && !top.includes(mine) ? `, and ${current}` : ""}</>}</span>
      </div>
    </Panel>
  );
}
