import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/hedge-funds")({
  head: () => ({
    meta: [
      { title: "Hedge fund monitor — Filed Under" },
      { name: "description", content: "Every public OFR Hedge Fund Monitor series: SEC Form PF leverage and liquidity, CFTC futures positioning, Fed SCOOS and sponsored repo." },
      { property: "og:title", content: "Hedge fund monitor — Filed Under" },
      { property: "og:description", content: "Hedge fund leverage, positioning, liquidity and repo data from the U.S. Office of Financial Research." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HedgeFunds,
});

type Series = { m: string; name: string; notes: string; unit: string; freq: string; updated: string | null; release: string; url: string; data: [string, number][] };
type Payload = { updated: string; datasets: Record<string, { name: string; series: Series[] }> };

const group = (s: Series) => s.name.split(":")[0].trim();

function fmt(v: number, unit: string) {
  if (/dollars/i.test(unit)) {
    const a = Math.abs(v);
    return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;
  }
  if (/percent/i.test(unit)) return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function change(s: Series) {
  const d = s.data; if (d.length < 2) return null;
  const last = d[d.length - 1];
  const target = new Date(last[0]); target.setFullYear(target.getFullYear() - 1);
  const prev = [...d].reverse().find(([t]) => new Date(t) <= target);
  if (!prev || prev[1] === 0) return null;
  return /percent|ratio|count of respondents/i.test(s.unit) ? { abs: last[1] - prev[1] } : { pct: (last[1] / prev[1] - 1) * 100 };
}

function HedgeFunds() {
  const q = useQuery({ queryKey: ["hedge-funds"], queryFn: async () => (await fetch("/data/hedge-funds.json")).json() as Promise<Payload>, staleTime: Infinity });
  const [ds, setDs] = useState("fpf");
  const [grp, setGrp] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  const set = q.data?.datasets[ds];
  const groups = useMemo(() => [...new Set((set?.series ?? []).map(group))], [set]);
  const list = useMemo(() => (set?.series ?? []).filter((s) => (!grp || group(s) === grp) && (!term || `${s.name} ${s.m}`.toLowerCase().includes(term.toLowerCase()))), [set, grp, term]);
  const cur = list.find((s) => s.m === sel) ?? list[0];

  return (
    <div>
      <PageHeader eyebrow="Data" title="Hedge fund monitor" description="All public series from the U.S. Office of Financial Research: hedge fund size, leverage, liquidity and stress tests (SEC Form PF), futures positioning by trader type (CFTC), dealer credit terms (Fed SCOOS) and sponsored repo." />
      {q.isLoading || !q.data ? <Skeleton className="h-96" /> : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(q.data.datasets).map(([k, v]) => (
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
            <Panel className="min-w-0" bodyClassName="max-h-[640px] overflow-y-auto p-0">
              {list.map((s) => {
                const last = s.data[s.data.length - 1]; const c = change(s);
                return (
                  <button key={s.m} onClick={() => setSel(s.m)} className={cn("flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left text-[12px] hover:bg-secondary", cur?.m === s.m && "bg-secondary")}>
                    <span className="min-w-0">{s.name}<span className="block text-[10px] text-muted-foreground">{s.freq} · {last[0]}</span></span>
                    <span className="shrink-0 text-right tabular-nums">{fmt(last[1], s.unit)}
                      {c && <span className={cn("block text-[10px]", (c.pct ?? c.abs ?? 0) >= 0 ? "text-success" : "text-destructive")}>{c.pct != null ? `${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(1)}% y/y` : `${c.abs! >= 0 ? "+" : ""}${c.abs!.toFixed(2)} y/y`}</span>}
                    </span>
                  </button>
                );
              })}
              {!list.length && <p className="p-4 text-[12px] text-muted-foreground">No series match.</p>}
            </Panel>
            {cur && (
              <Panel className="min-w-0" bodyClassName="p-4">
                <h3 className="text-[14px] font-medium">{cur.name}</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{cur.release} · {cur.freq} · {cur.unit} · {cur.data[0][0]} to {cur.data[cur.data.length - 1][0]}</p>
                <div className="mt-3 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cur.data.map(([d, v]) => ({ d, v }))}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="d" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} width={64} tickFormatter={(v) => fmt(v, cur.unit)} />
                      <Tooltip formatter={(v: number) => fmt(v, cur.unit)} contentStyle={{ fontSize: 11 }} />
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
      )}
    </div>
  );
}
