import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import LoadingState from "@/components/ui/loading-state";
import { supabase } from "@/integrations/supabase/client";
import { addDays, weekStart } from "@/lib/calendars/data";
import type { CalData } from "@/lib/calendars/rows";
import {
  altCatalysts,
  CATALYST_LABEL,
  daysAway,
  dividendCatalysts,
  earningsCatalysts,
  heatGrid,
  lockupCatalysts,
  macroCatalysts,
  mergeCatalysts,
  type AltEventRow,
  type CatalystEvent,
  type CatalystKind,
} from "@/lib/calendars/catalysts";
import { usePortfolios } from "@/lib/portfolio/store";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<CatalystKind, string> = {
  earnings: "bg-chart-1",
  dividend: "bg-chart-3",
  lockup: "bg-chart-4",
  trial: "bg-chart-5",
  fda: "bg-chart-2",
  award: "bg-positive",
  award_end: "bg-muted-foreground",
  macro: "bg-foreground",
};

const WEEKS = 13;

function useAltCatalystRows(from: string, to: string) {
  return useQuery({
    queryKey: ["catalyst-alt", from, to],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<AltEventRow[]> => {
      const cols = "uid,ticker,dataset,date,title,value,meta,source,source_url";
      const [trials, awards, ends, fda] = await Promise.all([
        supabase.from("alt_data").select(cols).eq("dataset", "trials").gte("meta->>primary_completion", from.slice(0, 7)).lte("meta->>primary_completion", to).limit(600),
        supabase.from("alt_data").select(cols).eq("dataset", "contracts").eq("kind", "event").gte("date", from).lte("date", to).order("value", { ascending: false }).limit(300),
        supabase.from("alt_data").select(cols).eq("dataset", "contracts").eq("kind", "event").gte("meta->>end", from).lte("meta->>end", to).order("value", { ascending: false }).limit(300),
        supabase.from("alt_data").select(cols).eq("dataset", "fda").eq("kind", "event").gte("date", from).lte("date", to).limit(300),
      ]);
      return [trials, awards, ends, fda].flatMap((r) => (r.data ?? []) as unknown as AltEventRow[]);
    },
  });
}

export function CatalystCalendar({ d }: { d: CalData }) {
  const start = weekStart(addDays(d.today, -14));
  const end = addDays(start, WEEKS * 7 - 1);
  const alt = useAltCatalystRows(start, end);
  const watch = useWatchlist();
  const portfolios = usePortfolios();
  const [scope, setScope] = useState<string>("all");
  const [kinds, setKinds] = useState<Set<CatalystKind>>(new Set(Object.keys(CATALYST_LABEL) as CatalystKind[]));
  const [day, setDay] = useState<string | null>(null);

  const scopeTickers = useMemo(() => {
    if (scope === "watchlist") return new Set((watch.data ?? []).map((x) => x.ticker));
    const p = portfolios.data?.find((x) => x.id === scope);
    return p ? new Set(p.content.holdings.map((h) => h.ticker)) : null;
  }, [scope, watch.data, portfolios.data]);

  const names = useMemo(() => new Map([...d.uni].map(([t, u]) => [t, u.name])), [d.uni]);
  const all = useMemo(
    () =>
      mergeCatalysts(
        [earningsCatalysts(d), dividendCatalysts(d), lockupCatalysts(d), macroCatalysts(d.releases), altCatalysts(alt.data ?? [], names)],
        start,
        end,
        scopeTickers,
      ),
    [d, alt.data, names, start, end, scopeTickers],
  );
  const shown = all.filter((e) => kinds.has(e.kind));
  const grid = heatGrid(shown, start, WEEKS);
  const maxW = Math.max(1, ...grid.flat().map((c) => c.weight));
  const list = (day ? shown.filter((e) => e.date === day) : shown.filter((e) => e.date >= d.today)).slice(0, 400);
  const counts = Object.fromEntries((Object.keys(CATALYST_LABEL) as CatalystKind[]).map((k) => [k, all.filter((e) => e.kind === k).length]));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { v: "all", l: "All companies" },
            { v: "watchlist", l: "Watchlist" },
            ...(portfolios.data ?? []).slice(0, 4).map((p) => ({ v: p.id, l: p.title })),
          ]}
        />
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(Object.keys(CATALYST_LABEL) as CatalystKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kinds.has(k)}
              onClick={() =>
                setKinds((s) => {
                  const n = new Set(s);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
              className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5", !kinds.has(k) && "opacity-40")}
            >
              <span className={cn("size-2 rounded-full", KIND_TONE[k])} />
              {CATALYST_LABEL[k]} <span className="num text-muted-foreground">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <Panel
        title="Catalyst heat calendar"
        subtitle={`Weekdays from ${start} to ${end}; shade = number and weight of events. Click a day to list it.`}
        actions={alt.isLoading ? <LoadingState label="Loading trials and awards" variant="Orbit" showTimer={false} /> : null}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[520px] grid-cols-[3.5rem_repeat(5,minmax(0,1fr))] gap-1 text-[10.5px]">
            <span />
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((x) => (
              <span key={x} className="text-center text-muted-foreground">
                {x}
              </span>
            ))}
            {grid.map((row) => (
              <Row key={row[0].date} row={row} maxW={maxW} today={d.today} day={day} onDay={(x) => setDay(day === x ? null : x)} />
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={day ? `Events on ${day}` : "Upcoming events"} subtitle={day ? undefined : `${list.length} from today`} collapse={640}>
        {list.length ? <EventList events={list} today={d.today} /> : <p className="text-sm text-muted-foreground">Nothing scheduled in this scope.</p>}
      </Panel>
    </div>
  );
}

function Row({ row, maxW, today, day, onDay }: { row: ReturnType<typeof heatGrid>[number]; maxW: number; today: string; day: string | null; onDay: (d: string) => void }) {
  return (
    <>
      <span className="num self-center text-muted-foreground">{row[0].date.slice(5)}</span>
      {row.map((c) => {
        const a = c.weight ? 0.12 + 0.88 * (c.weight / maxW) : 0;
        return (
          <button
            key={c.date}
            type="button"
            onClick={() => onDay(c.date)}
            title={`${c.date}: ${c.count} events${Object.entries(c.kinds).map(([k, n]) => `\n${CATALYST_LABEL[k as CatalystKind]}: ${n}`).join("")}`}
            className={cn(
              "relative h-9 rounded-sm border text-left",
              c.date === today && "ring-1 ring-foreground",
              day === c.date && "ring-2 ring-chart-1",
              c.date < today && "opacity-60",
            )}
            style={{ background: c.weight ? `color-mix(in oklab, var(--chart-1) ${Math.round(a * 100)}%, transparent)` : undefined }}
          >
            <span className="num absolute left-1 top-0.5 text-[9.5px] text-muted-foreground">{Number(c.date.slice(8))}</span>
            {c.count > 0 && <span className="num absolute bottom-0.5 right-1 text-[10px] font-semibold">{c.count}</span>}
          </button>
        );
      })}
    </>
  );
}

function EventList({ events, today }: { events: CatalystEvent[]; today: string }) {
  let last = "";
  return (
    <ul className="grid">
      {events.map((e) => {
        const head = e.date !== last;
        last = e.date;
        const n = daysAway(e.date, today);
        return (
          <li key={e.id} className={cn("grid grid-cols-[5.5rem_1fr] gap-3 py-1.5 text-[12.5px]", head && "border-t first:border-0")}>
            <span className={cn("num text-muted-foreground", !head && "invisible")}>
              {e.date}
              <span className="block text-[10px]">{n === 0 ? "today" : n > 0 ? `in ${n}d` : `${-n}d ago`}</span>
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={cn("size-2 shrink-0 rounded-full", KIND_TONE[e.kind])} />
                <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{CATALYST_LABEL[e.kind]}</span>
                {e.ticker ? (
                  <Link to="/app/companies/$ticker" params={{ ticker: e.ticker }} className="font-medium hover:underline">
                    {e.title}
                  </Link>
                ) : (
                  <span className="font-medium">{e.title}</span>
                )}
                {e.estimated && <span className="rounded border px-1 text-[10px] text-muted-foreground" title={e.basis ?? undefined}>estimated</span>}
              </span>
              <span className="block text-[11.5px] text-muted-foreground">
                {[e.ticker && e.name !== e.ticker ? e.name : null, e.detail, e.estimated ? e.basis : null].filter(Boolean).join(" · ")}
                {" · "}
                {e.source.url ? (
                  <a href={e.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                    {e.source.label} <ExternalLink className="size-2.5" />
                  </a>
                ) : (
                  e.source.label
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
