import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { EventRow } from "@/components/changes/event-row";
import { Button } from "@/components/ui/button";
import LoadingState from "@/components/ui/loading-state";
import { filterEvents, groupByDay, newSince, TYPE_LABEL } from "@/lib/changes/core";
import { changesFeedQuery, useVisits, visitBaseline } from "@/lib/changes/data";
import type { ChangeTier, ChangeType } from "@/lib/changes/types";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtRelative } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const TYPES = Object.keys(TYPE_LABEL) as ChangeType[];
const search = z.object({
  scope: z.enum(["all", "mine"]).optional(),
  tier: z.enum(["high", "medium", "low"]).optional(),
  types: z.string().max(200).optional(),
  sector: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
});

export const Route = createFileRoute("/_authenticated/app/feed")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "What changed — Filed Under" },
      {
        name: "description",
        content:
          "One ranked stream of what changed across covered companies: filing changes, 8-K events, insider trades, analyst actions, earnings, contracts, dividends and IR documents, each with its source.",
      },
      { property: "og:title", content: "What changed — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Feed,
});

const PAGE = 120;

function dayLabel(d: string, today: string) {
  if (d === today) return "Today";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (d === y.toISOString().slice(0, 10)) return "Yesterday";
  return fmtDate(d, { weekday: "short", month: "short", day: "numeric" });
}

function Feed() {
  const { scope = "all", tier = "medium", types, sector, q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const feed = useQuery(changesFeedQuery);
  const watch = useWatchlist();
  const visits = useVisits();
  const [limit, setLimit] = useState(PAGE);
  const today = new Date().toISOString().slice(0, 10);
  const picked = useMemo(
    () =>
      types
        ? (types.split(",").filter((t) => TYPES.includes(t as ChangeType)) as ChangeType[])
        : [],
    [types],
  );
  const mine = useMemo(() => new Set((watch.data ?? []).map((w) => w.ticker)), [watch.data]);
  const sectors = useMemo(
    () =>
      [
        ...new Set((feed.data?.events ?? []).map((e) => e.sector).filter(Boolean) as string[]),
      ].sort(),
    [feed.data],
  );
  const filtered = useMemo(
    () =>
      filterEvents(feed.data?.events ?? [], {
        types: picked,
        minTier: tier,
        sector: sector ?? null,
        tickers: scope === "mine" ? mine : null,
        query: q,
      }),
    [feed.data, picked, tier, sector, scope, mine, q],
  );
  const fresh = useMemo(() => {
    const ids = new Set<string>();
    for (const e of filtered) {
      if (!e.t) continue;
      const since = visitBaseline(visits.data?.[e.t]);
      if (since && newSince([e], since).length) ids.add(e.id);
    }
    return ids;
  }, [filtered, visits.data]);
  const groups = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit]);
  const set = (patch: Partial<z.infer<typeof search>>) => {
    setLimit(PAGE);
    navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  };
  const toggleType = (t: ChangeType) => {
    const next = picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t];
    set({ types: next.length ? next.join(",") : undefined });
  };
  const byType = feed.data?.counts.by_type ?? {};

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        eyebrow="Monitoring"
        title="What changed"
        description="Filing changes, 8-K events, insider trades, analyst actions, earnings, federal contracts, dividends, IPOs, IR documents and technical events in one stream. Each event shows the rule that ranked it and links to its source."
        actions={
          feed.data ? (
            <p className="text-[11px] text-muted-foreground">
              Updated {fmtRelative(feed.data.generated)} ·{" "}
              {feed.data.counts.total.toLocaleString("en-US")} events in {feed.data.window_days}{" "}
              days
            </p>
          ) : null
        }
      />

      <div
        className="grid grid-cols-1 gap-2 border-y bg-card/40 px-3.5 py-2.5"
        data-section="Feed filters"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Companies"
            value={scope}
            onChange={(v) => set({ scope: v === "all" ? undefined : v })}
            options={[
              { v: "all", l: "All companies" },
              { v: "mine", l: `My companies${mine.size ? ` (${mine.size})` : ""}` },
            ]}
          />
          <Segmented
            label="Materiality"
            value={tier}
            onChange={(v: ChangeTier) => set({ tier: v === "medium" ? undefined : v })}
            options={[
              { v: "high", l: "High", title: feed.data?.tiers.high },
              { v: "medium", l: "Medium and high", title: feed.data?.tiers.medium },
              { v: "low", l: "Everything", title: feed.data?.tiers.low },
            ]}
          />
          <select
            aria-label="Sector"
            value={sector ?? ""}
            onChange={(e) => set({ sector: e.target.value || undefined })}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Filter by ticker or words"
            defaultValue={q ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value || undefined });
            }}
            onBlur={(e) => set({ q: e.target.value || undefined })}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs sm:max-w-64"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Event types">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={picked.includes(t)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                picked.includes(t)
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {TYPE_LABEL[t]}
              {byType[t] != null && <span className="num ml-1 opacity-70">{byType[t]}</span>}
            </button>
          ))}
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => set({ types: undefined })}
              className="px-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {feed.isLoading ? (
        <div className="px-3.5 py-10">
          <LoadingState label="Loading the feed" variant="Dots" />
        </div>
      ) : feed.isError ? (
        <div className="flex items-center gap-2 border-y px-3.5 py-6 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" /> {friendlyError(feed.error)}
        </div>
      ) : !filtered.length ? (
        <p className="border-y px-3.5 py-8 text-center text-sm text-muted-foreground">
          {scope === "mine" && !mine.size
            ? "Follow companies to see their events here."
            : "No events match these filters."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {groups.map((g) => (
            <section key={g.date} className="min-w-0 border-y bg-card/40">
              <header className="flex items-baseline gap-2 border-b px-3.5 py-1.5">
                <h2 className="text-[12px] font-semibold">
                  {g.upcoming ? `Coming up · ${dayLabel(g.date, today)}` : dayLabel(g.date, today)}
                </h2>
                <span className="num text-[11px] text-muted-foreground">{g.events.length}</span>
              </header>
              <ul className="divide-y">
                {g.events.map((e) => (
                  <EventRow key={e.id} e={e} isNew={fresh.has(e.id)} />
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > limit && (
            <Button
              variant="outline"
              size="sm"
              className="justify-self-center"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Show more ({(filtered.length - limit).toLocaleString("en-US")} left)
            </Button>
          )}
          <p className="px-3.5 text-[11px] leading-relaxed text-muted-foreground">
            {feed.data?.method} The feed holds the {feed.data?.shown.toLocaleString("en-US")}{" "}
            highest-ranked events of the last {feed.data?.window_days} days; each company's page
            keeps 90 days of events.
          </p>
        </div>
      )}
    </div>
  );
}
