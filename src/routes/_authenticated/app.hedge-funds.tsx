import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Sparkline } from "@/components/charts/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { mostUnusual, readAuctions, seriesStats, zLabel, type Point } from "@/lib/hedge/core";
import { allSeries, auctionsQuery, crowding, gauges, hedgeFundsQuery, type HfPayload, type HfSeries } from "@/lib/hedge/query";

export const Route = createFileRoute("/_authenticated/app/hedge-funds")({
  head: () => ({
    meta: [
      { title: "Hedge funds & funding — Filed Under" },
      { name: "description", content: "Hedge fund leverage, crowding and the Treasury basis trade from OFR, SEC Form PF, CFTC and Fed data, plus every Treasury auction graded for demand." },
      { property: "og:title", content: "Hedge funds & funding — Filed Under" },
      { property: "og:description", content: "Leverage, positioning and Treasury auction demand from U.S. government data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HedgeFunds,
});

const group = (s: HfSeries) => s.name.split(":")[0].trim();

export function fmtHf(v: number, unit: string) {
  if (/dollars/i.test(unit)) {
    const a = Math.abs(v);
    return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;
  }
  if (/percent/i.test(unit)) return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
  if (unit === "ratio") return `${v.toFixed(2)}×`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function yoyText(s: ReturnType<typeof seriesStats>, unit: string) {
  if (!s?.yoy) return null;
  return s.yoy.pct != null ? `${s.yoy.pct >= 0 ? "+" : ""}${s.yoy.pct.toFixed(1)}% y/y` : `${s.yoy.abs! >= 0 ? "+" : ""}${unit === "ratio" ? s.yoy.abs!.toFixed(2) : fmtHf(s.yoy.abs!, unit)} y/y`;
}

const TABS = [
  { id: "overview", label: "Leverage & crowding" },
  { id: "auctions", label: "Treasury auctions" },
  { id: "explorer", label: "All 497 series" },
] as const;

function HedgeFunds() {
  const q = useQuery(hedgeFundsQuery);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [sel, setSel] = useState<string | null>(null);
  const openSeries = (m: string) => { setSel(m); setTab("explorer"); };

  return (
    <div>
      <PageHeader eyebrow="Data" title="Hedge funds & funding" description="Where leverage is building in the financial system — SEC Form PF, CFTC futures positioning, Fed dealer surveys and sponsored repo via the Office of Financial Research — plus every U.S. Treasury auction since 2010, graded for demand." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("rounded-full border px-3 py-1 text-[12px]", t.id === tab ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>{t.label}</button>
        ))}
      </div>
      {tab === "auctions" ? <Auctions /> : q.isLoading || !q.data ? <Skeleton className="h-96" /> : tab === "overview" ? <Overview p={q.data} onOpen={openSeries} /> : <Explorer p={q.data} sel={sel} setSel={setSel} />}
    </div>
  );
}

function Overview({ p, onOpen }: { p: HfPayload; onOpen: (m: string) => void }) {
  const gs = useMemo(() => gauges(p), [p]);
  const cr = useMemo(() => crowding(gs), [gs]);
  const unusual = useMemo(() => {
    const cutoff = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);
    return mostUnusual(allSeries(p).filter((s) => !/_(LONG|SHORT)_(POSITION|DV01|POS10YREQV)$/.test(s.m)), cutoff, 24);
  }, [p]);
  const names = useMemo(() => new Map(allSeries(p).map((s) => [s.m, s])), [p]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Panel className="min-w-0" bodyClassName="p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Crowding composite</p>
            <p className="mt-1 font-display text-[2.4rem] leading-none tabular-nums">{cr.score == null ? "—" : `${cr.score >= 0 ? "+" : ""}${cr.score.toFixed(2)}σ`}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{zLabel(cr.score)} · average z-score of {cr.parts.filter((x) => x.z != null).length} leverage and funding gauges vs their own history (higher = more leverage)</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cr.parts.map((x) => {
              const g = gs.find((g) => g.id === x.id)!;
              const v = x.z == null ? null : x.z * x.sign;
              return <Badge key={x.id} variant="outline" className={cn("text-[10px]", v != null && v >= 1 && "border-negative text-negative", v != null && v <= -1 && "border-positive text-positive")}>{g.label.split("(")[0].trim()} {v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}σ`}</Badge>;
            })}
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {gs.map((g) => {
          const st = seriesStats(g.data, g.unit)!;
          const zz = st.z == null ? null : st.z * g.sign;
          return (
            <button key={g.id} onClick={() => onOpen(g.sources[0])} className="min-w-0 rounded-lg border bg-card p-3 text-left shadow-paper transition-colors hover:bg-secondary">
              <p className="text-[12px] font-medium leading-tight">{g.label}</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{g.why}</p>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-[18px] font-medium tabular-nums">{fmtHf(st.latest[1], g.unit)}</span>
                <Sparkline values={g.data.slice(-60).map((d) => d[1])} className="h-8 w-24" />
              </div>
              <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                {st.latest[0]} · {yoyText(st, g.unit)} · {st.percentile.toFixed(0)}th pct
                {st.record && <span className="ml-1 font-medium text-foreground">· record {st.record}</span>}
              </p>
              <p className={cn("mt-0.5 text-[10px]", zz != null && zz >= 1 ? "text-negative" : zz != null && zz <= -1 ? "text-positive" : "text-muted-foreground")}>{zz == null ? "" : `${zLabel(st.z)} (${st.z! >= 0 ? "+" : ""}${st.z!.toFixed(1)}σ)`}</p>
              <p className="mt-1 truncate text-[9px] text-muted-foreground">{g.formula ?? g.sources[0]}</p>
            </button>
          );
        })}
      </div>

      <Panel className="min-w-0" title="Most unusual readings right now" subtitle="Across every OFR series updated in the last ~6 months: records first, then largest distance from the series' own history" bodyClassName="p-0">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {unusual.map((u) => {
            const s = names.get(u.m)!;
            return (
              <button key={u.m} onClick={() => onOpen(u.m)} className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-2 text-left text-[12px] hover:bg-secondary md:odd:border-r">
                <span className="min-w-0"><span className="line-clamp-2">{s.name}</span><span className="text-[10px] text-muted-foreground">{u.date} · {fmtHf(s.data[s.data.length - 1][1], s.unit)}</span></span>
                <span className="shrink-0 text-right">
                  {u.record && <Badge variant="outline" className="mb-0.5 block text-[9px]">record {u.record}</Badge>}
                  <span className={cn("block tabular-nums", u.z > 0 ? "text-negative" : "text-positive")}>{u.z >= 0 ? "+" : ""}{u.z.toFixed(1)}σ</span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
      <p className="text-[11px] text-muted-foreground">Source: U.S. Office of Financial Research Hedge Fund Monitor (SEC Form PF, CFTC Traders in Financial Futures, Fed SCOOS, DTCC FICC), values as published, updated {p.updated.slice(0, 10)}. z-scores use each series' full published history.</p>
    </div>
  );
}

function Auctions() {
  const q = useQuery(auctionsQuery);
  const [term, setTerm] = useState("10-Year|Note");
  const reads = useMemo(() => (q.data ? readAuctions(q.data.auctions) : []), [q.data]);
  const terms = useMemo(() => [...new Set(reads.map((r) => `${r.term}|${r.type}`))].sort((a, b) => parseInt(a) - parseInt(b)), [reads]);
  if (q.isLoading || !q.data) return <Skeleton className="h-96" />;
  const recent = reads.slice(0, 40);
  const series = reads.filter((r) => `${r.term}|${r.type}` === term).slice(0, 60).reverse();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel className="min-w-0" title="Latest auctions" subtitle="Each graded against the previous six auctions of the same tenor: bid-to-cover, foreign/indirect take-up and how much dealers had to absorb" bodyClassName="max-h-[680px] overflow-auto p-0">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr><th className="px-3 py-1.5 text-left">Date</th><th className="text-left">Security</th><th className="text-right">Yield</th><th className="text-right">Bid/cover</th><th className="text-right">Indirect</th><th className="text-right">Dealers</th><th className="px-3 text-right">Demand</th></tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.cusip + r.date} onClick={() => setTerm(`${r.term}|${r.type}`)} className="cursor-pointer border-b hover:bg-secondary">
                <td className="px-3 py-1.5">{r.date}</td>
                <td>{r.term} {r.type}{r.printedTerm !== r.term && <span className="text-[10px] text-muted-foreground"> (reopen)</span>}</td>
                <td className="text-right">{r.rate != null ? `${r.rate.toFixed(3)}%` : "—"}</td>
                <td className="text-right">{r.btc?.toFixed(2)}<span className="block text-[9px] text-muted-foreground">avg {r.avgBtc?.toFixed(2) ?? "—"}</span></td>
                <td className="text-right">{r.indirect?.toFixed(1)}%<span className="block text-[9px] text-muted-foreground">avg {r.avgIndirect?.toFixed(1) ?? "—"}</span></td>
                <td className="text-right">{r.dealer?.toFixed(1)}%<span className="block text-[9px] text-muted-foreground">avg {r.avgDealer?.toFixed(1) ?? "—"}</span></td>
                <td className={cn("px-3 text-right font-medium", r.verdict === "strong" && "text-positive", r.verdict === "weak" && "text-negative")}>{r.verdict ?? "—"}{r.score != null && <span className="block text-[9px] font-normal text-muted-foreground">{r.score >= 0 ? "+" : ""}{r.score.toFixed(1)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel className="min-w-0" title={`${term.replace("|", " ")} history`} actions={
        <select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded border bg-card px-2 py-0.5 text-[11px]">{terms.map((t) => <option key={t} value={t}>{t.replace("|", " ")}</option>)}</select>
      } bodyClassName="p-4">
        <p className="mb-1 text-[11px] text-muted-foreground">Demand score per auction (last 60)</p>
        <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={series.map((r) => ({ d: r.date, v: r.score ?? 0 }))}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="d" tick={{ fontSize: 9 }} minTickGap={30} /><YAxis tick={{ fontSize: 9 }} width={30} /><ReferenceLine y={0} stroke="var(--muted-foreground)" /><Tooltip contentStyle={{ fontSize: 11 }} /><Bar dataKey="v" fill="var(--primary)" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        <p className="mb-1 mt-4 text-[11px] text-muted-foreground">Stop-out yield and bid-to-cover</p>
        <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={series.map((r) => ({ d: r.date, y: r.rate, b: r.btc }))}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="d" tick={{ fontSize: 9 }} minTickGap={30} /><YAxis yAxisId="y" tick={{ fontSize: 9 }} width={34} /><YAxis yAxisId="b" orientation="right" tick={{ fontSize: 9 }} width={30} /><Tooltip contentStyle={{ fontSize: 11 }} /><Line yAxisId="y" dataKey="y" name="yield %" dot={false} stroke="var(--primary)" isAnimationActive={false} /><Line yAxisId="b" dataKey="b" name="bid/cover" dot={false} stroke="var(--chart-2)" isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">Score = (bid-to-cover − avg) × 10 + (indirect % − avg) ÷ 2 − (dealer % − avg) ÷ 2. ≥ +3 strong, ≤ −3 weak. Shares are of competitive bids accepted. <a className="underline" href={q.data.sourceUrl} target="_blank" rel="noreferrer">Source: {q.data.source}</a>.</p>
      </Panel>
    </div>
  );
}

function Explorer({ p, sel, setSel }: { p: HfPayload; sel: string | null; setSel: (m: string | null) => void }) {
  const initial = useMemo(() => (sel ? Object.entries(p.datasets).find(([, v]) => v.series.some((s) => s.m === sel))?.[0] : null) ?? "fpf", [p, sel]);
  const [ds, setDs] = useState(initial);
  const [grp, setGrp] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const set = p.datasets[ds];
  const groups = useMemo(() => [...new Set((set?.series ?? []).map(group))], [set]);
  const list = useMemo(() => (set?.series ?? []).filter((s) => (!grp || group(s) === grp) && (!term || `${s.name} ${s.m}`.toLowerCase().includes(term.toLowerCase()))), [set, grp, term]);
  const cur = list.find((s) => s.m === sel) ?? list[0];
  const st = cur ? seriesStats(cur.data, cur.unit) : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {Object.entries(p.datasets).map(([k, v]) => (
          <button key={k} onClick={() => { setDs(k); setGrp(null); setSel(null); }} className={cn("rounded-full border px-3 py-1 text-[12px]", k === ds ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>{v.name} · {v.series.length}</button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search series…" className="h-8 w-56 text-[12px]" />
        {groups.length > 1 && [null, ...groups].map((g) => (
          <button key={g ?? "all"} onClick={() => setGrp(g)} className={cn("rounded border px-2 py-0.5 text-[11px]", g === grp ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary")}>{g ?? "All"}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel className="min-w-0" bodyClassName="p-0">
          {list.map((s) => {
            const last = s.data[s.data.length - 1]; const c = seriesStats(s.data, s.unit);
            return (
              <button key={s.m} onClick={() => setSel(s.m)} className={cn("flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left text-[12px] hover:bg-secondary", cur?.m === s.m && "bg-secondary")}>
                <span className="min-w-0">{s.name}<span className="block text-[10px] text-muted-foreground">{s.freq} · {last[0]}</span></span>
                <span className="shrink-0 text-right tabular-nums">{fmtHf(last[1], s.unit)}
                  <span className="block text-[10px] text-muted-foreground">{yoyText(c, s.unit)}</span>
                </span>
              </button>
            );
          })}
          {!list.length && <p className="p-4 text-[12px] text-muted-foreground">No series match.</p>}
        </Panel>
        {cur && st && (
          <Panel className="min-w-0" bodyClassName="p-4">
            <h3 className="text-[14px] font-medium">{cur.name}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{cur.release} · {cur.freq} · {cur.unit} · {cur.data[0][0]} to {cur.data[cur.data.length - 1][0]}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <Stat k="Latest" v={fmtHf(st.latest[1], cur.unit)} />
              <Stat k="vs history" v={st.z == null ? "—" : `${st.z >= 0 ? "+" : ""}${st.z.toFixed(1)}σ · ${st.percentile.toFixed(0)}th pct`} />
              <Stat k="High" v={`${fmtHf(st.high[1], cur.unit)} (${st.high[0]})`} />
              <Stat k="Low" v={`${fmtHf(st.low[1], cur.unit)} (${st.low[0]})`} />
            </div>
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cur.data.map(([d, v]: Point) => ({ d, v }))}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="d" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} width={64} tickFormatter={(v) => fmtHf(v, cur.unit)} />
                  <Tooltip formatter={(v: number) => fmtHf(v, cur.unit)} contentStyle={{ fontSize: 11 }} />
                  <Line dataKey="v" dot={false} stroke="var(--primary)" strokeWidth={1.5} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {cur.notes && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{cur.notes}</p>}
            <p className="mt-2 text-[11px]"><a className="underline" href={cur.url} target="_blank" rel="noreferrer">Source: OFR series {cur.m}</a></p>
          </Panel>
        )}
      </div>
    </>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => <div className="rounded border bg-secondary/40 px-2 py-1"><p className="text-[9px] uppercase text-muted-foreground">{k}</p><p className="truncate tabular-nums">{v}</p></div>;
