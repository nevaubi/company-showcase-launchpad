import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { PixelGrid } from "@/components/ui/loading-state";
import { buildDigest } from "@/lib/changes/core";
import { useCompanyChangesMany, useVisits, visitBaseline } from "@/lib/changes/data";
import { EventRow } from "./event-row";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Top events across the user's companies in the last 7 days (medium and high tier, at most 3 per company). */
export function TodayDigest({ tickers }: { tickers: string[] }) {
  const files = useCompanyChangesMany(tickers);
  const visits = useVisits();
  const loading = files.some((f) => f.isLoading);
  const digest = useMemo(() => {
    const ok = files.flatMap((f) =>
      f.data ? [{ ticker: f.data.ticker, events: f.data.events }] : [],
    );
    const lastSeen = Object.fromEntries(
      Object.entries(visits.data ?? {}).map(([t, v]) => [t, visitBaseline(v) ?? undefined]),
    );
    return buildDigest({ files: ok, lastSeen, today: todayIso(), days: 7, limit: 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => f.dataUpdatedAt).join(","), visits.data]);
  if (!tickers.length) return null;
  return (
    <Panel
      title="Today"
      subtitle={`What changed across your ${tickers.length} companies in the last 7 days, ranked by materiality`}
      collapse={false}
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/feed" search={{ scope: "mine" }}>
            Full feed <ArrowRight />
          </Link>
        </Button>
      }
    >
      {loading && !digest.items.length ? (
        <div className="flex items-center gap-2 px-3.5 py-4 text-[12px] text-muted-foreground">
          <PixelGrid variant="Dots" /> Reading your companies' events
        </div>
      ) : digest.items.length ? (
        <ul className="divide-y">
          {digest.items.map(({ event, isNew }) => (
            <EventRow key={event.id} e={event} isNew={isNew} compact />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-4 text-[12px] text-muted-foreground">
          Nothing at medium or high materiality across your companies this week.
        </p>
      )}
    </Panel>
  );
}
