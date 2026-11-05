import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, Gauge, Zap } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { marketsQuery } from "@/lib/markets/query";
import { PATTERN_META } from "@/lib/markets/core";
import { buildTimeline, estimateNextEarnings, type EventKind, type TimelineEvent } from "@/lib/company/catalysts";
import { fmtCompactUsd, fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fmtAlt } from "@/lib/alt/query";

const today = () => new Date().toISOString().slice(0, 10);

/** One-screen read of the stock's setup: earnings behaviour, live signals, key levels. */
export function SetupPanel({ ticker, data, price }: { ticker: string; data: CompanyDataset; price: number | null }) {
  const m = useQuery(marketsQuery);
  const mc = m.data?.companies.find((c) => c.ticker === ticker);
  const next = useMemo(() => estimateNextEarnings(data.earningsReleases.map((r) => r.filed), today()), [data.earningsReleases]);
  const days = next ? Math.round((Date.parse(next.date) - Date.parse(today())) / 86_400_000) : null;
  const px = price ?? mc?.price ?? null;
  const sup = mc?.levels.support.filter((l) => px == null || l.price < px).sort((a, b) => b.price - a.price)[0];
  const res = mc?.levels.resistance.filter((l) => px == null || l.price > px).sort((a, b) => a.price - b.price)[0];
  const last = mc?.reactions[0];
  const s = mc?.stats;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Gauge className="size-3.5" /> Setup at a glance
        </span>
      }
      subtitle={mc ? `Prices through ${fmtDate(mc.asOf)} · rules-based, no forecasts` : "Loading…"}
    >
      {!mc ? (
        m.isLoading ? <Skeleton className="h-40" /> : <p className="text-sm text-muted-foreground">No market history for {ticker}.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5">
        <div className="grid grid-cols-3 divide-x rounded-md border bg-secondary/40">
          {[
            { k: "Next earnings", v: days != null ? `${days}d` : "—", sub: next ? fmtDate(next.date) : "" },
            { k: "Avg 2-day move", v: s?.n ? `±${fmtPct(s.avgAbsMove, 1)}` : "—", sub: s?.n ? `${s.n} prints` : "" },
            { k: "Up after earnings", v: s?.n ? fmtPct(s.upRate, 0) : "—", sub: s?.avgDrift20 != null ? `${fmtPct(s.avgDrift20, 1, true)} avg 20d drift` : "" },
          ].map((t) => (
            <div key={t.k} className="min-w-0 px-3 py-2.5">
              <p className="truncate text-[11px] text-muted-foreground">{t.k}</p>
              <p className="num text-lg font-medium leading-tight">{t.v}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{t.sub}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <p className="eyebrow flex items-center gap-1.5"><CalendarClock className="size-3" /> Earnings</p>
            {next && <p className="text-[11px] text-muted-foreground">Next-date estimate: {next.basis}</p>}
            {s?.continuation != null && <p>Follow-through after the print <b className="num">{fmtPct(s.continuation, 0)}</b> of the time</p>}
            {last && (
              <p className="text-muted-foreground">
                Last measured print {fmtDate(last.date)}:{" "}
                <span className={cn("num font-medium", last.move >= 0 ? "text-positive" : "text-negative")}>{fmtPct(last.move, 1, true)}</span>
                {last.sigma != null && <> ({last.sigma.toFixed(1)}σ)</>}
                {last.drift20 != null && <> · then {fmtPct(last.drift20, 1, true)} over 20 days</>}
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <p className="eyebrow flex items-center gap-1.5"><Zap className="size-3" /> Chart signals</p>
            {mc.active.length === 0 ? (
              <p className="text-muted-foreground">No pattern fired in the last 10 sessions.</p>
            ) : (
              <ul className="space-y-1.5">
                {mc.active.slice(0, 4).map((a) => {
                  const meta = PATTERN_META[a.kind];
                  const edge = mc.edges.find((e) => e.kind === a.kind);
                  return (
                    <li key={`${a.kind}-${a.date}`} className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn(meta.bias === "bullish" ? "text-positive" : meta.bias === "bearish" ? "text-negative" : "")}>
                        {meta.label}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {fmtDate(a.date)}
                        {edge && edge.n > 0 && edge.hitRate != null && ` · worked ${fmtPct(edge.hitRate, 0)} of ${edge.n} past times`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-muted-foreground">
              Support <b className="num text-foreground">{sup ? fmtPrice(sup.price) : "—"}</b> · Resistance{" "}
              <b className="num text-foreground">{res ? fmtPrice(res.price) : "—"}</b>
            </p>
          </div>
        </div>
        {mc.reactions.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Last {Math.min(12, mc.reactions.length)} earnings reactions</p>
            {(() => {
              const rs = mc.reactions.slice(0, 12).reverse();
              const max = Math.max(...rs.map((r) => Math.abs(r.move)), 0.01);
              return (
                <div className="flex h-24 items-stretch gap-1">
                  {rs.map((r) => (
                    <div key={r.date} className="flex min-w-0 flex-1 flex-col" title={`${fmtDate(r.date)}: ${fmtPct(r.move, 1, true)}`}>
                      <div className="flex flex-1 items-end">
                        {r.move >= 0 && <div className="w-full rounded-t-sm bg-positive/80" style={{ height: `${(r.move / max) * 100}%` }} />}
                      </div>
                      <div className="border-t" />
                      <div className="flex flex-1 items-start">
                        {r.move < 0 && <div className="w-full rounded-b-sm bg-negative/80" style={{ height: `${(-r.move / max) * 100}%` }} />}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
              <span>{fmtDate(mc.reactions[Math.min(11, mc.reactions.length - 1)].date)}</span>
              <span>max ±{fmtPct(Math.max(...mc.reactions.slice(0, 12).map((r) => Math.abs(r.move))), 1)}</span>
              <span>{fmtDate(mc.reactions[0].date)}</span>
            </p>
          </div>
        )}
        </div>
      )}
    </Panel>
  );
}

const KIND_LABEL: Record<EventKind, string> = {
  earnings: "Earnings",
  annual: "10-K",
  quarterly: "10-Q",
  "8k": "8-K",
  proxy: "Proxy",
  insider_buy: "Insider buy",
  insider_sell: "Insider sale",
  pattern: "Signal",
  alt: "Alt data",
  intel: "Supply intel",
};
const ALT_LABEL: Record<string, string> = { ownership: "Ownership", contracts: "Gov contract", regulatory: "Regulatory", fda: "FDA", recalls: "Recall" };
const FILTERS: { id: string; label: string; kinds: EventKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "filings", label: "Filings", kinds: ["earnings", "annual", "quarterly", "8k", "proxy"] },
  { id: "insiders", label: "Insiders", kinds: ["insider_buy", "insider_sell"] },
  { id: "signals", label: "Signals", kinds: ["pattern"] },
  { id: "alt", label: "Alt data", kinds: ["alt", "intel"] },
];

/** Everything that happened to the company, newest first, each row opening its source. */
export function CatalystsTimeline({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const m = useQuery(marketsQuery);
  const [filter, setFilter] = useState("all");
  const mc = m.data?.companies.find((c) => c.ticker === ticker);
  // Alt data (13D/G, contracts, FDA, recalls, regulatory) and verified supply-chain intel join the same timeline.
  const extra = useQuery({
    queryKey: ["timeline-extra", ticker],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [alt, sig] = await Promise.all([
        supabase.from("alt_data").select("dataset,date,title,value,unit,source_url").eq("ticker", ticker).eq("kind", "event").in("dataset", Object.keys(ALT_LABEL)).not("date", "is", null).order("date", { ascending: false }).limit(80),
        supabase.from("supply_signals").select("kind,title,detail,impact,filed,accn,doc,url").eq("ticker", ticker).not("filed", "is", null).order("filed", { ascending: false }).limit(60),
      ]);
      return { alt: alt.data ?? [], sig: sig.data ?? [] };
    },
  });

  const events = useMemo(() => {
    const ev: TimelineEvent[] = [];
    for (const r of extra.data?.alt ?? []) {
      ev.push({ date: r.date!, kind: "alt", title: `${ALT_LABEL[r.dataset] ?? r.dataset}: ${r.title}`, detail: r.value != null ? fmtAlt(r.value, r.unit) : undefined, url: r.source_url ?? undefined, tone: r.dataset === "recalls" ? "negative" : "neutral" });
    }
    for (const s of extra.data?.sig ?? []) {
      ev.push({ date: s.filed!.slice(0, 10), kind: "intel", title: s.title, detail: s.detail ?? undefined, accn: s.accn ?? undefined, doc: s.doc ?? undefined, url: s.accn ? undefined : s.url ?? undefined, tone: s.impact === "positive" ? "positive" : s.impact === "negative" ? "negative" : "neutral" });
    }
    const rx = new Map((mc?.reactions ?? []).map((r) => [r.accn, r]));
    for (const r of data.earningsReleases) {
      const re = rx.get(r.accn);
      ev.push({
        date: r.filed,
        kind: "earnings",
        title: r.title || "Earnings release",
        detail: re ? `Stock ${fmtPct(re.move, 1, true)} over two days` : undefined,
        tone: re ? (re.move >= 0 ? "positive" : "negative") : "neutral",
        accn: r.accn,
        doc: r.doc,
      });
    }
    for (const f of data.filings) {
      const kind: EventKind | null = f.form === "10-K" ? "annual" : f.form === "10-Q" ? "quarterly" : f.form === "8-K" ? "8k" : f.form === "DEF 14A" ? "proxy" : null;
      if (!kind) continue;
      ev.push({ date: f.filed, kind, title: f.desc || f.form, detail: f.items ? `Items ${f.items}` : f.report ? `Period ${fmtDate(f.report)}` : undefined, accn: f.accn, doc: f.doc });
    }
    // Group open-market insider trades per filing.
    const byAccn = new Map<string, { t: (typeof data.insiders)[number]; usd: number }>();
    for (const t of data.insiders) {
      if (t.code !== "S" && t.code !== "P") continue;
      const cur = byAccn.get(t.accn);
      const usd = t.shares * (t.price ?? 0);
      byAccn.set(t.accn, { t, usd: (cur?.usd ?? 0) + usd });
    }
    for (const { t, usd } of byAccn.values()) {
      const buy = t.code === "P";
      ev.push({
        date: t.date,
        kind: buy ? "insider_buy" : "insider_sell",
        title: `${t.owner} ${buy ? "bought" : "sold"} ${fmtCompactUsd(usd)}`,
        detail: `${t.role}${t.plan10b5 ? " · 10b5-1 plan" : ""}`,
        tone: buy ? "positive" : "negative",
        accn: t.accn,
        doc: t.doc,
      });
    }
    for (const p of mc?.recent ?? []) {
      const meta = PATTERN_META[p.kind];
      ev.push({
        date: p.date,
        kind: "pattern",
        title: meta.label,
        detail: `${meta.rule} · at ${fmtPrice(p.price)}${p.fwd20 != null ? ` · ${fmtPct(p.fwd20, 1, true)} next 20 days` : ""}`,
        tone: meta.bias === "bullish" ? "positive" : meta.bias === "bearish" ? "negative" : "neutral",
      });
    }
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? [];
    return buildTimeline(kinds.length ? ev.filter((e) => kinds.includes(e.kind)) : ev, 60);
  }, [data, mc, filter, extra.data]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" /> Catalysts & events
        </span>
      }
      subtitle="Filings, earnings, insiders, signals, alt data and supply-chain intel · every row opens its source"
      actions={
        <div className="flex rounded-md border bg-secondary/50 p-0.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={cn("rounded px-2 py-0.5 text-[11px]", filter === f.id ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}>
              {f.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="p-0"
    >
      <ol>
        {events.map((e, i) => {
          const month = e.date.slice(0, 7);
          const header =
            i === 0 || events[i - 1].date.slice(0, 7) !== month ? (
              <li key={`m-${month}`} className="border-b bg-secondary/70 px-4 py-1">
                <span className="eyebrow">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
              </li>
            ) : null;
          const body = (
            <>
              <span className="num w-7 shrink-0 pt-px text-right text-[12px] font-medium tabular-nums">{Number(e.date.slice(8, 10))}</span>
              <span className="relative flex w-2 shrink-0 justify-center self-stretch">
                <span className="absolute inset-y-[-10px] w-px bg-border" />
                <span className={cn("relative mt-1.5 size-2 rounded-full ring-2 ring-card", e.tone === "positive" ? "bg-positive" : e.tone === "negative" ? "bg-negative" : "bg-chart-2")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <Badge variant="outline" className="shrink-0 text-[10px]">{KIND_LABEL[e.kind]}</Badge>
                  <span className="truncate text-[13px]">{e.title}</span>
                </span>
                {e.detail && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{e.detail}</span>}
              </span>
              {e.accn && <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
            </>
          );
          return [
            header,
            <li key={`${e.kind}-${e.accn ?? e.title}-${e.date}-${i}`} className="border-b border-border/60 last:border-b-0">
              {e.accn ? (
                <button
                  onClick={() => open({ ticker, label: KIND_LABEL[e.kind], periodLabel: e.date, unit: "usd", value: 0, doc: { accn: e.accn!, doc: e.doc ?? "", title: e.title } })}
                  className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-secondary"
                >
                  {body}
                </button>
              ) : e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-secondary">{body}</a>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2">{body}</div>
              )}
            </li>,
          ];
        })}
        {events.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing in this view.</li>}
      </ol>
    </Panel>
  );
}
