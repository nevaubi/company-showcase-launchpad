import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { DisclosureChanges } from "@/components/filings/disclosure-changes";
import { FormChip, Pager, QuietLine } from "@/components/filings/parts";
import { useSource } from "@/components/source/source-context";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { byImportance, FEED_COLUMNS, familyCounts, feedRows, filterFeed, indexUrl, type FeedFamily, type FeedFiling, type FeedRow } from "@/lib/filings/daily";
import { paginate } from "@/lib/filings/list";
import { fmtDate } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const FAMS = ["all", "periodic", "current", "ownership", "proxy", "offerings", "other"] as const;
const searchSchema = z.object({
  view: z.enum(["filings", "changes"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fam: z.enum(FAMS).optional(),
  sector: z.string().max(60).optional(),
  watch: z.boolean().optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  form: z.enum(["all", "10-K", "10-Q"]).optional(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_authenticated/app/filings")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Filings · FiledUnder" },
      { name: "description", content: "Every SEC filing across coverage, one filing day at a time, by form family, sector and watchlist; plus the largest disclosure changes in recent 10-K and 10-Q filings." },
      { property: "og:title", content: "Filings · FiledUnder" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Filings,
});

const FAM_LABEL: Record<FeedFamily, string> = { all: "All", periodic: "10-K and 10-Q", current: "8-K", ownership: "Ownership", proxy: "Proxy", offerings: "Offerings", other: "Other" };
const SECTORS = [...new Set(COVERAGE.map((c) => c.sector).filter(Boolean))].sort();
const sectorOf = (t: string) => coverageOf(t)?.sector;
const nameOf = (t: string) => coverageOf(t)?.shortName;

/** The newest filing day on or before `day` (or the newest overall), and its neighbours. */
function useFilingDay(day: string | undefined) {
  const latest = useQuery({
    queryKey: ["feed-latest-day"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("sec_filings").select("filed").order("filed", { ascending: false }).limit(1);
      if (error) throw error;
      return (data?.[0]?.filed as string | undefined) ?? null;
    },
  });
  const current = day ?? latest.data ?? undefined;
  const neighbours = useQuery({
    queryKey: ["feed-neighbours", current],
    enabled: !!current,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [prev, next] = await Promise.all([
        supabase.from("sec_filings").select("filed").lt("filed", current!).order("filed", { ascending: false }).limit(1),
        supabase.from("sec_filings").select("filed").gt("filed", current!).order("filed", { ascending: true }).limit(1),
      ]);
      return { prev: (prev.data?.[0]?.filed as string | undefined) ?? null, next: (next.data?.[0]?.filed as string | undefined) ?? null };
    },
  });
  const rows = useQuery({
    queryKey: ["feed-day", current],
    enabled: !!current,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FeedFiling[]> => {
      const out: FeedFiling[] = [];
      for (let from = 0; from < 6000; from += 1000) {
        const { data, error } = await supabase.from("sec_filings").select(FEED_COLUMNS).eq("filed", current!).order("accn").range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as FeedFiling[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
  return { day: current, latest: latest.data ?? null, prev: neighbours.data?.prev ?? null, next: neighbours.data?.next ?? null, rows, loadingDay: latest.isLoading };
}

function Filings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "filings";
  const watch = useWatchlist();
  const watched = useMemo(() => new Set((watch.data ?? []).map((w) => w.ticker)), [watch.data]);
  const set = (s: Partial<Search>, keepPage = false) => navigate({ search: (prev) => ({ ...prev, ...(keepPage ? {} : { page: undefined }), ...s }), replace: true, resetScroll: false });
  const [text, setText] = useState(search.q ?? "");
  useEffect(() => setText(search.q ?? ""), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== text.trim()) set({ q: text.trim() || undefined });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const sector = search.sector && SECTORS.includes(search.sector) ? search.sector : "all";
  const stableSector = useCallback(sectorOf, []);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        eyebrow="Filings and data"
        title="Filings"
        description={view === "filings" ? "Every SEC filing across coverage, one filing day at a time. Click a row to read the filing." : "What changed in recent 10-K and 10-Q filings against the same filing a year earlier."}
      />
      <div data-section="Feed controls" className="flex flex-wrap items-center gap-2">
        <Segmented label="View" size="xs" value={view} onChange={(v) => set({ view: v === "filings" ? undefined : v })} options={[{ v: "filings", l: "All filings" }, { v: "changes", l: "Disclosure changes" }]} />
        <Select value={sector} onValueChange={(v) => set({ sector: v === "all" ? undefined : v })}>
          <SelectTrigger aria-label="Sector" className="h-7 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              All sectors
            </SelectItem>
            {SECTORS.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex h-7 items-center gap-2 rounded px-1 text-[12px] text-muted-foreground">
          <Switch checked={!!search.watch} onCheckedChange={(v) => set({ watch: v || undefined })} aria-label="Watchlist only" disabled={!watched.size} />
          Watchlist only{watched.size ? ` · ${watched.size}` : ""}
        </label>
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ticker, company or words" aria-label="Filter by ticker, company or words" className="h-7 pl-7 text-xs" />
        </div>
        {(sector !== "all" || search.watch || search.q) && (
          <button type="button" onClick={() => (setText(""), set({ sector: undefined, watch: undefined, q: undefined }))} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>
      {view === "filings" ? (
        <DayFeed search={search} set={set} sector={sector} watched={watched} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Form" size="xs" value={search.form ?? "all"} onChange={(v) => set({ form: v === "all" ? undefined : v })} options={[{ v: "all", l: "10-K and 10-Q" }, { v: "10-K", l: "10-K" }, { v: "10-Q", l: "10-Q" }]} />
            <Segmented label="Window" size="xs" value={String(search.days ?? 30) as "7" | "30" | "90"} onChange={(v) => set({ days: Number(v) === 30 ? undefined : (Number(v) as 7 | 90) })} options={[{ v: "7", l: "7 days" }, { v: "30", l: "30 days" }, { v: "90", l: "90 days" }]} />
          </div>
          <DisclosureChanges scope={{ form: search.form ?? "all", sector, watch: !!search.watch, q: search.q ?? "", days: search.days ?? 30 }} sectorOf={stableSector} watched={watched} />
        </>
      )}
    </div>
  );
}

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,13rem)_5.5rem_minmax(0,1fr)_4.5rem]";

function DayFeed({ search, set, sector, watched }: { search: Search; set: (s: Partial<Search>, keepPage?: boolean) => void; sector: string; watched: Set<string> }) {
  const { open } = useSource();
  const d = useFilingDay(search.day);
  const fam = search.fam ?? "all";
  const all = useMemo(() => feedRows(d.rows.data ?? []), [d.rows.data]);
  // Counts follow every filter except the family, so each family button says what it would show.
  const scoped = useMemo(() => filterFeed(all, { family: "all", sector, watch: !!search.watch, q: search.q ?? "" }, sectorOf, nameOf, watched), [all, sector, search.watch, search.q, watched]);
  const counts = useMemo(() => familyCounts(scoped), [scoped]);
  const rows = useMemo(() => (fam === "all" ? scoped : scoped.filter((r) => (r.family === "correspondence" ? "other" : r.family) === fam)).sort(byImportance), [scoped, fam]);
  const p = paginate(rows, search.page ?? 1, 100);
  const filings = (d.rows.data ?? []).length;
  const dayBtn = "inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

  const openRow = (r: FeedRow) => {
    const f = r.filings[0];
    const cov = coverageOf(f.ticker);
    open({ ticker: f.ticker, label: r.title, periodLabel: `filed ${fmtDate(f.filed)}`, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, title: `${f.form} filed ${fmtDate(f.filed)}`, ...(cov && Number(cov.cik) !== Number(f.cik) ? { cik: String(Number(f.cik)) } : {}) } });
  };

  return (
    <div data-section="Filing day" className="min-w-0">
      <Panel
        collapse={false}
        bodyClassName="p-0"
        title={d.day ? fmtDate(d.day, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Latest filing day"}
        subtitle={d.rows.data ? `${filings.toLocaleString()} filings from covered companies${d.day && d.day === d.latest ? " · latest day, still arriving" : ""} · same-day insider forms from one company share a row` : "Loading the filing day"}
        actions={
          <nav aria-label="Filing days" className="flex items-center">
            <button type="button" className={dayBtn} disabled={!d.prev} onClick={() => set({ day: d.prev ?? undefined })} title="Earlier filing day">
              <ChevronLeft className="size-3.5" /> {d.prev ? fmtDate(d.prev, { month: "short", day: "numeric" }) : "Earlier"}
            </button>
            <button type="button" className={dayBtn} disabled={!d.next} onClick={() => set({ day: d.next && d.next !== d.latest ? d.next : undefined })} title="Later filing day">
              {d.next ? fmtDate(d.next, { month: "short", day: "numeric" }) : "Later"} <ChevronRight className="size-3.5" />
            </button>
            {search.day && d.latest && search.day !== d.latest && (
              <button type="button" className={dayBtn} onClick={() => set({ day: undefined })}>
                Latest
              </button>
            )}
          </nav>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
          <Segmented label="Form family" size="xs" value={fam} onChange={(v) => set({ fam: v === "all" ? undefined : v })} options={FAMS.filter((f) => f === "all" || counts[f] > 0 || f === fam).map((f) => ({ v: f, l: `${FAM_LABEL[f]} · ${counts[f].toLocaleString()}` }))} />
          <Pager p={p} onPage={(n) => set({ page: n }, true)} label="Feed pages, top" className="ml-auto" />
        </div>
        {d.loadingDay || d.rows.isLoading ? (
          <Skeleton className="m-3.5 h-96" />
        ) : d.rows.isError ? (
          <QuietLine>Filings could not be loaded right now.</QuietLine>
        ) : !p.rows.length ? (
          <QuietLine>{filings ? "No filings on this day match these filters." : "No filings recorded on this day."}</QuietLine>
        ) : (
          <div role="table" aria-label="Filings" className="text-[13px]">
            <div role="row" className={cn(GRID, "border-b px-3.5 py-1.5 text-[11px] text-muted-foreground")}>
              <span role="columnheader">Company</span>
              <span role="columnheader" className="hidden sm:block">
                Form
              </span>
              <span role="columnheader" className="hidden sm:block">
                Filing
              </span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {p.rows.map((r) => {
              const f = r.filings[0];
              return (
                <div role="row" key={r.key} className={cn(GRID, "group min-h-8 border-b px-3.5 py-1 transition-colors duration-150 last:border-0 hover:bg-secondary/50")}>
                  <span role="cell" className="flex min-w-0 flex-col sm:block">
                    <TickerMark ticker={r.ticker} name size="xs" className="max-w-full" />
                    <button type="button" onClick={() => openRow(r)} className="flex min-w-0 items-center gap-2 pl-[26px] text-left sm:hidden">
                      <FormChip form={r.form} />
                      <span className="truncate">{r.title}</span>
                    </button>
                  </span>
                  <span role="cell" className="hidden sm:block">
                    <FormChip form={r.form} />
                  </span>
                  <span role="cell" className="hidden min-w-0 sm:block">
                    <button type="button" onClick={() => openRow(r)} className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="truncate underline-offset-2 group-hover:underline">{r.title}</span>
                      {r.detail && <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground md:inline">{r.detail}</span>}
                    </button>
                  </span>
                  <span role="cell" className="flex items-center justify-end gap-0.5">
                    {r.filings.length > 1 && (
                      <Link to="/app/companies/$ticker/filings" params={{ ticker: r.ticker }} search={{ kind: "ownership" }} className="inline-flex h-7 items-center rounded px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground" title={`All ${r.filings.length} filings on the company's Filings tab`}>
                        All
                      </Link>
                    )}
                    <a href={indexUrl(f.cik, f.accn)} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground" aria-label={`${r.ticker} ${f.form}: filing index on SEC.gov`}>
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {p.pages > 1 && (
          <div className="flex justify-end border-t px-3.5 py-2">
            <Pager p={p} onPage={(n) => set({ page: n }, true)} label="Feed pages, bottom" />
          </div>
        )}
      </Panel>
    </div>
  );
}
