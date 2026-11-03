import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Stat } from "@/components/app/page-header";
import { InsiderTable, type InsiderRow } from "@/components/app/insider-table";
import { Skeleton } from "@/components/ui/skeleton";
import { COVERAGE } from "@/lib/coverage";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/insiders")({
  head: () => ({
    meta: [
      { title: "Insider trades — Filed Under" },
      { name: "description", content: "Form 4 insider transactions across covered companies." },
      { property: "og:title", content: "Insider trades — Filed Under" },
      { property: "og:description", content: "Form 4 insider transactions across covered companies." },
    ],
  }),
  component: Insiders,
});

function Insiders() {
  const feed = useQuery({
    queryKey: ["insider-feed"],
    queryFn: async () => {
      const r = await fetch("/data/insiders.json");
      if (!r.ok) throw new Error(`Couldn't load the insider feed (${r.status})`);
      return (await r.json()) as { generatedAt: string; trades: InsiderRow[] };
    },
    staleTime: Infinity,
  });
  const watch = useWatchlist();
  const [scope, setScope] = useState<string>("watchlist");
  const followed = new Set((watch.data ?? []).map((w) => w.ticker));
  const rows = useMemo(() => {
    const all = feed.data?.trades ?? [];
    if (scope === "all") return all;
    if (scope === "watchlist") return all.filter((t) => followed.has(t.ticker));
    return all.filter((t) => t.ticker === scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data, scope, watch.data]);

  const market = rows.filter((r) => r.code === "S" || r.code === "P");
  const sold = market.filter((r) => r.code === "S").reduce((s, r) => s + r.shares * (r.price ?? 0), 0);
  const bought = market.filter((r) => r.code === "P").reduce((s, r) => s + r.shares * (r.price ?? 0), 0);
  const planned = market.filter((r) => r.plan10b5).length;
  const insiders = new Set(rows.map((r) => `${r.ticker}|${r.owner}`)).size;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Form 4"
        title="Insider trades"
        description={`Officer, director and 10% holder transactions reported to the SEC. Parsed from each Form 4's XML${feed.data ? `; feed generated ${fmtDate(feed.data.generatedAt)}` : ""}.`}
      />
      <div className="flex flex-wrap gap-1">
        {["watchlist", "all", ...COVERAGE.map((c) => c.ticker)].map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn("rounded-full border px-3 py-1 text-xs", scope === s ? "border-foreground bg-ink text-ink-foreground" : "bg-card hover:bg-secondary", s.length <= 5 && "num")}
          >
            {s === "watchlist" ? "My watchlist" : s === "all" ? "All coverage" : s}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open-market sales" value={fmtCompactUsd(sold)} tone="negative" sub={`${market.filter((r) => r.code === "S").length} transactions`} />
        <Stat label="Open-market purchases" value={fmtCompactUsd(bought)} tone="positive" sub={`${market.filter((r) => r.code === "P").length} transactions`} />
        <Stat label="Under 10b5-1 plans" value={market.length ? `${Math.round((planned / market.length) * 100)}%` : "—"} sub="pre-scheduled trades" />
        <Stat label="Insiders" value={insiders} sub={`${rows.length} rows`} />
      </div>
      {feed.isLoading ? <Skeleton className="h-[500px]" /> : feed.isError ? <p className="text-sm text-negative">{(feed.error as Error).message}</p> : <InsiderTable rows={rows} showTicker />}
    </div>
  );
}
