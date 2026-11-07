import { useMemo } from "react";
import { friendlyError } from "@/lib/errors";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getDailyBrief } from "@/lib/brief.functions";
import { auctionsQuery, crowding, gauges, hedgeFundsQuery, allSeries } from "@/lib/hedge/query";
import { mostUnusual, readAuctions, seriesStats } from "@/lib/hedge/core";
import { fmtAlt } from "@/lib/alt/query";
import { cn } from "@/lib/utils";

interface Fact {
  id: string;
  area: string;
  text: string;
  href: string;
  external: boolean;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** Collect numbered, source-linked facts from every data area for the brief. */
async function gatherFacts(tickers: string[]): Promise<Fact[]> {
  const since = new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10);
  const facts: Fact[] = [];
  const add = (area: string, text: string, href: string, external = false) =>
    facts.push({ id: `F${facts.length + 1}`, area, text, href, external });
  const scope = tickers.length ? tickers : null;

  const [sig, hf, au, alt, intel] = await Promise.all([
    fetch("/data/signals.json")
      .then((r) => r.json())
      .catch(() => null),
    hedgeFundsQuery.queryFn().catch(() => null),
    auctionsQuery.queryFn().catch(() => null),
    (() => {
      let q = supabase
        .from("alt_data")
        .select("ticker,dataset,date,title,value,unit,source_url")
        .eq("kind", "event")
        .gte("date", since)
        .order("date", { ascending: false })
        .limit(60);
      if (scope) q = q.in("ticker", scope);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("supply_signals")
        .select("ticker,kind,title,impact,quote,filed,accn,url")
        .gte("filed", since)
        .order("filed", { ascending: false })
        .limit(40);
      if (scope) q = q.in("ticker", scope);
      return q;
    })(),
  ]);

  const ideas = ((sig?.ideas ?? []) as any[])
    .filter((i) => !scope || scope.includes(i.ticker))
    .slice(0, scope ? 20 : 12);
  for (const i of ideas)
    add(
      "trade setup",
      `${i.ticker} ${i.direction.toUpperCase()} setup (score ${i.score}) at $${i.price}: ${i.signals.map((s: any) => `${s.detail} [rule hit rate ${pct(s.stats.hitRate)} over ${s.stats.n} past cases, avg excess vs SPY ${(s.stats.avgExcess * 100).toFixed(1)}%]`).join("; ")}`,
      "/app/ideas",
    );
  for (const r of (alt.data ?? []) as any[])
    add(
      `alt data/${r.dataset}`,
      `${r.date} ${r.ticker}: ${r.title}${r.value != null ? ` = ${fmtAlt(r.value, r.unit)}` : ""}`,
      r.source_url ?? `/app/companies/${r.ticker}/alt-data`,
      !!r.source_url,
    );
  for (const s of (intel.data ?? []) as any[])
    add(
      "supply chain",
      `${s.filed?.slice(0, 10)} ${s.ticker} [${s.kind}, ${s.impact}] ${s.title}: "${String(s.quote).slice(0, 200)}"`,
      `/app/supply-chain?t=${s.ticker}`,
    );
  if (hf) {
    const gs = gauges(hf);
    const cr = crowding(gs);
    add(
      "hedge funds",
      `Hedge fund crowding composite ${cr.score?.toFixed(2)}σ vs history (avg of leverage/borrowing/basis-trade/repo z-scores)`,
      "/app/hedge-funds",
    );
    for (const g of gs) {
      const s = seriesStats(g.data, g.unit)!;
      add(
        "hedge funds",
        `${g.label}: latest ${s.latest[1].toPrecision(4)} ${g.unit} on ${s.latest[0]}, z ${s.z?.toFixed(1)}, ${s.percentile.toFixed(0)}th percentile${s.record ? `, record ${s.record}` : ""}`,
        "/app/hedge-funds",
      );
    }
    const cutoff = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);
    for (const u of mostUnusual(allSeries(hf), cutoff, 5))
      add(
        "hedge funds",
        `Unusual: ${u.name} z ${u.z.toFixed(1)}${u.record ? ` (record ${u.record})` : ""} as of ${u.date}`,
        "/app/hedge-funds",
      );
  }
  if (au)
    for (const r of readAuctions(au.auctions).slice(0, 6))
      add(
        "treasury auction",
        `${r.date} ${r.term} ${r.type} auction: yield ${r.rate}%, bid-to-cover ${r.btc} vs ${r.avgBtc?.toFixed(2)} avg, indirect ${r.indirect}% vs ${r.avgIndirect?.toFixed(1)}%, dealers ${r.dealer}% vs ${r.avgDealer?.toFixed(1)}% → ${r.verdict}`,
        "/app/hedge-funds",
      );
  return facts.slice(0, 220);
}

export function DailyBrief({ tickers }: { tickers: string[] }) {
  const run = useServerFn(getDailyBrief);
  const date = new Date().toISOString().slice(0, 10);
  const key = useMemo(() => [...tickers].sort().join(",").slice(0, 80) || "market", [tickers]);
  const facts = useQuery({
    queryKey: ["brief-facts", key],
    queryFn: () => gatherFacts(tickers),
    staleTime: 30 * 60_000,
  });
  const brief = useQuery({
    queryKey: ["daily-brief", date, key],
    enabled: !!facts.data?.length,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: () =>
      run({
        data: {
          date,
          key,
          tickers,
          facts: facts.data!.map(({ id, area, text }) => ({
            id,
            area: area.slice(0, 30),
            text: text.slice(0, 590),
          })),
        },
      }),
  });
  const byId = new Map((facts.data ?? []).map((f) => [f.id, f]));

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> Your morning brief
        </span>
      }
      subtitle={`Written from ${facts.data?.length ?? "…"} sourced facts across filings, alt data, supply chain, trade setups, hedge funds and Treasury auctions${tickers.length ? " · focused on your watchlist" : ""}`}
      actions={
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => {
            facts.refetch();
            brief.refetch();
          }}
          disabled={brief.isFetching}
        >
          <RefreshCw className={cn("size-3", brief.isFetching && "animate-spin")} />
        </Button>
      }
      bodyClassName="p-0"
    >
      {brief.isError ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          The brief couldn't be written right now. {friendlyError(brief.error)}
        </p>
      ) : !brief.data ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <p className="text-[11px] text-muted-foreground">Reading everything that changed…</p>
        </div>
      ) : (
        <div>
          <p className="border-b px-4 py-3 font-display text-[1.25rem] leading-snug">
            {brief.data.headline}
          </p>
          <ol>
            {brief.data.items.map((it, i) => (
              <li key={i} className="border-b px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      it.stance === "bullish" && "border-positive text-positive",
                      (it.stance === "bearish" || it.stance === "risk") &&
                        "border-negative text-negative",
                    )}
                  >
                    {it.stance}
                  </Badge>
                  {it.urgency === "high" && <Badge className="text-[10px]">high priority</Badge>}
                  <span className="text-[13px] font-medium">{it.title}</span>
                  {it.tickers.map((t) => (
                    <Link
                      key={t}
                      to="/app/companies/$ticker"
                      params={{ ticker: t }}
                      className="text-[11px] underline"
                    >
                      {t}
                    </Link>
                  ))}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{it.body}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.factIds.map((id) => {
                    const f = byId.get(id);
                    if (!f) return null;
                    return f.external ? (
                      <a
                        key={id}
                        href={f.href}
                        target="_blank"
                        rel="noreferrer"
                        title={f.text}
                        className="rounded border px-1.5 text-[10px] text-muted-foreground hover:bg-secondary"
                      >
                        {id} · {f.area}
                      </a>
                    ) : (
                      <Link
                        key={id}
                        to={f.href as never}
                        title={f.text}
                        className="rounded border px-1.5 text-[10px] text-muted-foreground hover:bg-secondary"
                      >
                        {id} · {f.area}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          {brief.data.watch.length > 0 && (
            <p className="px-4 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Check next:</span>{" "}
              {brief.data.watch.join(" · ")}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
