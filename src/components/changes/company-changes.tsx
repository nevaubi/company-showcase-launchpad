import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { PixelGrid } from "@/components/ui/loading-state";
import { countByType, filterEvents, newSince, rankEvents, TYPE_SHORT } from "@/lib/changes/core";
import { companyChangesQuery, useCompanyVisit } from "@/lib/changes/data";
import type { ChangeTier } from "@/lib/changes/types";
import { fmtRelative } from "@/lib/format";
import { EventRow } from "./event-row";

type View = "ranked" | "latest";

/** The company's last 90 days of sourced events, ranked by the stated tier rules. */
export function WhatChangedPanel({ ticker }: { ticker: string }) {
  const q = useQuery(companyChangesQuery(ticker));
  const visit = useCompanyVisit(ticker);
  const [view, setView] = useState<View>("ranked");
  const [floor, setFloor] = useState<ChangeTier>("medium");
  const [all, setAll] = useState(false);
  const fresh = useMemo(
    () => new Set(newSince(q.data?.events ?? [], visit.since).map((e) => e.id)),
    [q.data, visit.since],
  );
  const list = useMemo(() => {
    const evs = filterEvents(q.data?.events ?? [], { minTier: floor });
    return view === "ranked"
      ? rankEvents(evs)
      : [...evs].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [q.data, floor, view]);
  if (q.isLoading)
    return (
      <Panel title="What changed" subtitle="Last 90 days">
        <div className="flex items-center gap-2 px-3.5 py-4 text-[12px] text-muted-foreground">
          <PixelGrid variant="Dots" /> Loading events
        </div>
      </Panel>
    );
  if (!q.data) return null;
  const shown = all ? list : list.slice(0, 6);
  return (
    <Panel
      title="What changed"
      subtitle={`Last ${q.data.window_days} days · ${q.data.counts.total} events · updated ${fmtRelative(q.data.generated)}`}
      collapse={false}
      actions={
        <>
          <Segmented
            label="Materiality floor"
            size="xs"
            value={floor}
            onChange={setFloor}
            options={[
              { v: "high", l: "High" },
              { v: "medium", l: "Medium+" },
              { v: "low", l: "All" },
            ]}
          />
          <Segmented
            label="Order"
            size="xs"
            value={view}
            onChange={setView}
            options={[
              { v: "ranked", l: "Ranked" },
              { v: "latest", l: "Latest" },
            ]}
          />
        </>
      }
    >
      {list.length ? (
        <ul className="divide-y">
          {shown.map((e) => (
            <EventRow key={e.id} e={e} isNew={fresh.has(e.id)} showCompany={false} />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-4 text-[12px] text-muted-foreground">
          No {floor === "high" ? "high" : floor === "medium" ? "medium or high" : ""} materiality
          events in the window.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {list.length > 6 && (
          <Button size="xs" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${list.length}`}
          </Button>
        )}
        <span>Tiers follow fixed rules stated on each event; there is no composite score.</span>
        <Link to="/app/feed" className="ml-auto underline-offset-2 hover:underline">
          All companies
        </Link>
      </div>
    </Panel>
  );
}

/** "Since your last visit" counts under the company header. */
export function SinceVisitBadges({ ticker }: { ticker: string }) {
  const q = useQuery(companyChangesQuery(ticker));
  const visit = useCompanyVisit(ticker, true);
  if (!q.data || !visit.ready || !visit.since) return null;
  const fresh = newSince(q.data.events, visit.since);
  if (!fresh.length) return null;
  const parts = countByType(fresh);
  const high = fresh.filter((e) => e.tier === "high").length;
  return (
    <p
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
      data-section="Since your last visit"
    >
      <span className="font-medium text-foreground">Since your last visit</span>
      <span>({fmtRelative(visit.since)}):</span>
      {parts.map((p) => (
        <a
          key={p.type}
          href="#ov-what-changed"
          className="num rounded bg-secondary px-1.5 py-px text-foreground hover:bg-secondary/70"
        >
          {p.n} {TYPE_SHORT[p.type]}
          {p.n > 1 && !TYPE_SHORT[p.type].endsWith("s") ? "s" : ""}
        </a>
      ))}
      {high > 0 && (
        <span className="rounded bg-highlight-soft px-1.5 py-px font-medium text-highlight-foreground">
          {high} high
        </span>
      )}
    </p>
  );
}
