import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DividendsList,
  EarningsList,
  EconomicList,
  IposList,
  WeekAgenda,
} from "@/components/calendars/calendars";
import { CatalystCalendar } from "@/components/calendars/catalysts";
import type { CalData } from "@/lib/calendars/rows";
import {
  dividendsQuery,
  earningsIndexQuery,
  iposQuery,
  releasesQuery,
  todayIso,
  weekStart,
} from "@/lib/calendars/data";
import { useUniverse } from "@/lib/data";
import { fmtRelative } from "@/lib/format";

const TABS = ["week", "catalysts", "earnings", "economic", "dividends", "ipos"] as const;
const search = z.object({
  tab: z.enum(TABS).optional(),
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const Route = createFileRoute("/_authenticated/app/calendars")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Calendars — Filed Under" },
      {
        name: "description",
        content:
          "Earnings, economic releases, dividends and IPOs on one calendar, each entry linked to the schedule or SEC filing it came from.",
      },
      { property: "og:title", content: "Calendars — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Calendars,
});

function Calendars() {
  const { tab = "week", week: weekParam, day } = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = todayIso();
  const week = weekParam ?? weekStart(today);
  const earnings = useQuery(earningsIndexQuery);
  const releases = useQuery(releasesQuery);
  const dividends = useQuery(dividendsQuery);
  const ipos = useQuery(iposQuery);
  const uni = useUniverse();
  const uniMap = useMemo(
    () => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])),
    [uni.data],
  );
  const d: CalData = {
    today,
    earnings: earnings.data,
    releases: releases.data,
    dividends: dividends.data,
    ipos: ipos.data,
    uni: uniMap,
  };
  const loading = earnings.isLoading || releases.isLoading;
  const stamps = [
    earnings.data && `earnings ${fmtRelative(earnings.data.generated)}`,
    dividends.data && `dividends ${fmtRelative(dividends.data.generated)}`,
    ipos.data && `IPOs ${fmtRelative(ipos.data.generated)}`,
  ].filter(Boolean);
  const missing = [
    earnings.isError && "earnings",
    releases.isError && "economic releases",
    dividends.isError && "dividends",
    ipos.isError && "IPOs",
  ].filter(Boolean);
  const go = (next: { tab?: (typeof TABS)[number]; week?: string; day?: string }) =>
    navigate({
      search: {
        tab: next.tab === "week" ? undefined : next.tab,
        week: next.week && next.week !== weekStart(today) ? next.week : undefined,
        day: next.day,
      },
      replace: true,
    });
  const labels: Record<(typeof TABS)[number], string> = {
    week: "Week",
    catalysts: "Catalysts",
    earnings: "Earnings",
    economic: "Economic",
    dividends: "Dividends",
    ipos: "IPOs",
  };

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Markets"
        title="Calendars"
        description={`Earnings, economic releases, ex-dividend dates and the IPO pipeline${stamps.length ? ` · updated ${stamps.join(", ")}` : ""}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Calendar"
          value={tab}
          onChange={(v) => go({ tab: v, week: weekParam })}
          options={TABS.map((t) => ({ v: t, l: labels[t] }))}
        />
      </div>
      {missing.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-chart-4/30 bg-chart-4/5 px-3 py-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-chart-4" />
          <p className="min-w-0">
            <span className="font-medium">Could not load {missing.join(", ")}.</span>{" "}
            <span className="text-muted-foreground">
              {stamps.length
                ? `The rest is current: ${stamps.join(", ")}.`
                : "The data service did not respond; try again shortly."}
            </span>
          </p>
        </div>
      )}
      {loading ? (
        <Skeleton className="h-[560px]" />
      ) : tab === "week" ? (
        <WeekAgenda
          d={d}
          week={week}
          onWeek={(w) => go({ tab: "week", week: w })}
          onDay={(t, dd) => go({ tab: t, day: dd })}
        />
      ) : tab === "catalysts" ? (
        <CatalystCalendar d={d} />
      ) : tab === "earnings" ? (
        <EarningsList key={day ?? "all"} d={d} day={day} />
      ) : tab === "economic" ? (
        <EconomicList key={day ?? "all"} d={d} day={day} />
      ) : tab === "dividends" ? (
        dividends.isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <DividendsList key={day ?? "all"} d={d} day={day} />
        )
      ) : ipos.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <IposList key={day ?? "all"} d={d} day={day} />
      )}
    </div>
  );
}
