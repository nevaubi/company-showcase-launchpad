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
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/reactions" search={{ ticker }}>
            Earnings profile
          </Link>
        </Button>
      }
    >
      {!mc ? (
        m.isLoading ? <Skeleton className="h-40" /> : <p className="text-sm text-muted-foreground">No market history for {ticker}.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <p className="eyebrow flex items-center gap-1.5"><CalendarClock className="size-3" /> Earnings</p>
            {next && (
              <p>
                Next release likely around <b>{fmtDate(next.date)}</b>
                {days != null && <span className="text-muted-foreground"> ({days} days)</span>}
                <span className="block text-[11px] text-muted-foreground">Estimate: {next.basis}</span>
              </p>
            )}
            {s && s.n > 0 && (
              <p>
                Typically moves <b className="num">±{fmtPct(s.avgAbsMove, 1)}</b> over two days, up{" "}
                <b className="num">{fmtPct(s.upRate, 0)}</b> of {s.n} prints
                {s.continuation != null && <> · follow-through {fmtPct(s.continuation, 0)}</>}
              </p>
            )}
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
};
const FILTERS: { id: string; label: string; kinds: EventKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "filings", label: "Filings", kinds: ["earnings", "annual", "quarterly", "8k", "proxy"] },
  { id: "insiders", label: "Insiders", kinds: ["insider_buy", "insider_sell"] },
  { id: "signals", label: "Signals", kinds: ["pattern"] },
];

/** Everything that happened to the company, newest first, each row opening its source. */
export function CatalystsTimeline({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const m = useQuery(marketsQuery);
  const [filter, setFilter] = useState("all");
  const mc = m.data?.companies.find((c) => c.ticker === ticker);

  const events = useMemo(() => {
    const ev: TimelineEvent[] = [];
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
  }, [data, mc, filter]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" /> Catalysts & events
        </span>
      }
      subtitle="Filings, earnings, insider trades and chart signals · click a filing to open it"
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
      <ol className="max-h-[420px] overflow-y-auto scrollbar-thin">
        {events.map((e, i) => {
          const body = (
            <>
              <span className="num w-20 shrink-0 text-[11px] text-muted-foreground">{fmtDate(e.date)}</span>
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", e.tone === "positive" ? "bg-positive" : e.tone === "negative" ? "bg-negative" : "bg-chart-2")} />
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
          return (
            <li key={`${e.kind}-${e.accn ?? e.title}-${e.date}-${i}`} className="border-b last:border-b-0">
              {e.accn ? (
                <button
                  onClick={() => open({ ticker, label: KIND_LABEL[e.kind], periodLabel: e.date, unit: "usd", value: 0, doc: { accn: e.accn!, doc: e.doc ?? "", title: e.title } })}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
        {events.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing in this view.</li>}
      </ol>
    </Panel>
  );
}
