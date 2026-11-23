import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Search, Star } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TickerMark } from "@/components/app/ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFits } from "@/components/ir/panel";
import { useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE, COVERAGE_TICKERS, coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import { useToggleFollow } from "@/lib/workspace";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { fmtField, type FieldDef } from "@/lib/screener/engine";
import { ROW_H, useWindowRange } from "@/lib/screener/window";

export const Route = createFileRoute("/_authenticated/app/companies/")({
  head: () => ({
    meta: [
      { title: "Companies · FiledUnder" },
      { name: "description", content: "Every covered company with live price, market cap and SEC-sourced fundamentals; sort, filter and follow." },
      { property: "og:title", content: "Companies · FiledUnder" },
      { property: "og:description", content: "Covered companies with SEC-sourced fundamentals and live prices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Companies,
});

type SortKey = "ticker" | "sector" | "price" | "chg" | "mcap" | "revenueTTM" | "growth" | "gm" | "pe" | "fcf" | "filed";
const SORT_KEYS: SortKey[] = ["ticker", "sector", "price", "chg", "mcap", "revenueTTM", "growth", "gm", "pe", "fcf", "filed"];
function validSort(value: unknown): value is { key: SortKey; dir: 1 | -1 } {
  if (!value || typeof value !== "object" || !("key" in value) || !("dir" in value)) return false;
  return SORT_KEYS.some((key) => key === value.key) && (value.dir === 1 || value.dir === -1);
}
function validSector(value: unknown): value is string {
  return typeof value === "string" && (value === "All" || COVERAGE.some((c) => c.sector === value));
}
const STICKY = "top-[var(--sticky-top,3.5rem)]";
const U = (id: string, u: FieldDef["u"]): FieldDef => ({ id, g: "", n: id, u, d: "" });
const F_USD = U("usd", "usd");
const F_PCT = U("pct", "pct");
const F_X = U("x", "x");
const fmtSignedPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${fmtField(F_PCT, v)}`);

interface CRow {
  ticker: string;
  name: string;
  sector: string;
  group: string;
  logo?: string;
  price: number | null;
  chg: number | null;
  mcap: number | null;
  revenueTTM: number | null;
  growth: number | null;
  gm: number | null;
  pe: number | null;
  fcf: number | null;
  filed: { form: string; filed: string } | null;
}

const COLS: { k: SortKey; l: string; title: string; first?: 1 | -1 }[] = [
  { k: "price", l: "Price", title: "Live price where quoted, otherwise the last close" },
  { k: "chg", l: "Day", title: "Change from the previous close" },
  { k: "mcap", l: "Market cap", title: "Price × shares outstanding from the latest 10-K or 10-Q cover page" },
  { k: "revenueTTM", l: "Revenue", title: "Sum of the last four reported quarters (SEC filings)" },
  { k: "growth", l: "Rev. YoY", title: "Latest quarter vs the same quarter a year earlier" },
  { k: "gm", l: "Gross mgn", title: "Gross profit / revenue, trailing four quarters" },
  { k: "pe", l: "P/E", title: "Price / diluted EPS, trailing four quarters; empty when EPS is not positive", first: 1 },
  { k: "fcf", l: "FCF yield", title: "Free cash flow (trailing four quarters) / market cap" },
  { k: "filed", l: "Last filing", title: "Latest 10-K or 10-Q" },
];

function Companies() {
  const u = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const follow = useToggleFollow();
  const navigate = useNavigate();
  const [sort, setSort] = useSessionState<{ key: SortKey; dir: 1 | -1 }>("fu:companies:sort", { key: "mcap", dir: -1 }, validSort);
  const [sector, setSector] = useSessionState<string>("fu:companies:sector", "All", validSector);
  const [group, setGroup] = useSessionState<string>("fu:companies:group", "All");
  const [following, setFollowing] = useSessionState("fu:companies:following", false);
  const [q, setQ] = useSessionState("fu:companies:query", "");
  const [wrap, fits] = useFits<HTMLDivElement>();
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of COVERAGE) m.set(c.sector, (m.get(c.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of COVERAGE) if (sector === "All" || c.sector === sector) m.set(c.group ?? c.industry, (m.get(c.group ?? c.industry) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sector]);
  const groupOk = group === "All" || groups.some(([g]) => g === group);

  const rows = useMemo<CRow[]>(() => {
    const qs = new Map((quotes.data?.quotes ?? []).map((x) => [x.symbol, x]));
    return (u.data?.companies ?? []).map((c) => {
      const qt = qs.get(c.ticker);
      const cov = coverageOf(c.ticker);
      const mcap = qt && c.sharesOutstanding ? qt.price * c.sharesOutstanding : null;
      return {
        ticker: c.ticker,
        name: cov?.shortName ?? c.name,
        sector: cov?.sector ?? c.sector,
        group: cov?.group ?? cov?.industry ?? c.industry,
        logo: c.logo,
        price: qt?.price ?? null,
        chg: qt?.changePct ?? null,
        mcap,
        revenueTTM: c.revenueTTM ?? null,
        growth: c.revenueGrowthYoY ?? null,
        gm: c.grossMarginTTM ?? null,
        pe: qt && c.epsTTM && c.epsTTM > 0 ? qt.price / c.epsTTM : null,
        fcf: mcap && c.fcfTTM != null ? c.fcfTTM / mcap : null,
        filed: c.lastFiling ? { form: c.lastFiling.form, filed: c.lastFiling.filed } : null,
      };
    });
  }, [u.data, quotes.data]);

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (sector !== "All" && r.sector !== sector) return false;
      if (groupOk && group !== "All" && r.group !== group) return false;
      if (following && !follow.isFollowed(r.ticker)) return false;
      if (!needle) return true;
      return r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || r.group.toLowerCase().includes(needle);
    });
    const val = (r: CRow): number | string | null =>
      sort.key === "ticker" ? r.ticker : sort.key === "sector" ? `${r.sector} ${r.group}` : sort.key === "filed" ? (r.filed?.filed ?? null) : r[sort.key];
    return filtered.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // missing values always last
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, sector, group, groupOk, following, q, follow]);

  const [start, end] = useWindowRange(body, sorted.length);
  const head = cn("border-b bg-card", fits && `sticky ${STICKY} z-20`);
  const toggleSort = (k: SortKey, first: 1 | -1 = -1) => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : first }));
  const filtersOn = q || sector !== "All" || group !== "All" || following;
  const SortHead = ({ k, children, title, className, first }: { k: SortKey; children: React.ReactNode; title?: string; className?: string; first?: 1 | -1 }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn(head, "px-3 py-1.5 align-bottom", className)}>
      <button
        type="button"
        title={title}
        onClick={() => toggleSort(k, first)}
        className={cn("inline-flex items-center gap-1 rounded-sm text-[11px] font-medium leading-4 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sort.key === k ? "text-foreground" : "text-muted-foreground")}
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div>
      <PageHeader eyebrow="Companies" title="Companies" description={u.data ? `${rows.length.toLocaleString()} covered companies · fundamentals as of ${fmtDate(u.data.generatedAt)} · prices live where quoted` : undefined} />
      <div data-section="Company filters" data-agent-controls className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ticker or industry" className="h-8 pl-7 text-xs" aria-label="Filter companies" />
        </div>
        <Select
          value={sector}
          onValueChange={(v) => {
            setSector(v);
            setGroup("All");
          }}
        >
          <SelectTrigger aria-label="Filter sector" className="h-8 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All sectors · {COVERAGE.length.toLocaleString()}</SelectItem>
            {sectors.map(([name, n]) => (
              <SelectItem value={name} key={name}>
                {name} · {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupOk ? group : "All"} onValueChange={setGroup}>
          <SelectTrigger aria-label="Filter industry group" className="h-8 w-60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All industry groups</SelectItem>
            {groups.map(([name, n]) => (
              <SelectItem value={name} key={name}>
                {name} · {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={following} onCheckedChange={setFollowing} aria-label="Only companies I follow" /> Following
        </label>
        <span className="num ml-auto text-[13px]" aria-live="polite">
          <span className="font-semibold">{sorted.length.toLocaleString()}</span> <span className="text-muted-foreground">{sorted.length === 1 ? "company" : "companies"}</span>
        </span>
        {filtersOn && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setQ("");
              setSector("All");
              setGroup("All");
              setFollowing(false);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {u.isError && (
        <div role="alert" className="mb-3 flex items-center gap-3 text-[13px] text-muted-foreground">
          {u.data ? "Refresh failed; showing the last available dataset." : "Company data is temporarily unavailable."}
          <Button size="xs" variant="outline" onClick={() => u.refetch()}>
            Retry
          </Button>
        </div>
      )}
      <section data-section="Company list" className="min-w-0 rounded-md border bg-card shadow-paper">
        <div ref={wrap} className={cn("relative", !fits && "overflow-x-auto scrollbar-thin")}>
          <table className={cn("border-separate border-spacing-0 text-[13px] leading-5", fits ? "w-full" : "w-max min-w-full")}>
            <thead>
              <tr>
                <th scope="col" className={cn(head, "w-9 px-0 py-1.5")}>
                  <span className="sr-only">Follow</span>
                </th>
                <SortHead k="ticker" first={1} className={cn("left-0 z-30 min-w-56 border-r text-left", !fits && "sticky")}>
                  Company
                </SortHead>
                <SortHead k="sector" first={1} className="text-left" title="Industry group; sector on hover. Sorts by sector, then group">
                  Group
                </SortHead>
                {COLS.map((c) => (
                  <SortHead key={c.k} k={c.k} title={c.title} first={c.first} className={c.k === "filed" ? "text-left" : "text-right"}>
                    {c.l}
                  </SortHead>
                ))}
              </tr>
            </thead>
            <tbody ref={setBody}>
              {u.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={12} className="px-3 py-1">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))}
              {start > 0 && (
                <tr aria-hidden style={{ height: start * ROW_H }}>
                  <td colSpan={12} />
                </tr>
              )}
              {sorted.slice(start, end).map((r) => (
                <CompanyRow key={r.ticker} r={r} sticky={!fits} sortKey={sort.key} followed={follow.isFollowed(r.ticker)} pending={follow.pending} onFollow={follow.toggle} onOpen={(t) => navigate({ to: "/app/companies/$ticker", params: { ticker: t } })} />
              ))}
              {end < sorted.length && (
                <tr aria-hidden style={{ height: (sorted.length - end) * ROW_H }}>
                  <td colSpan={12} />
                </tr>
              )}
              {!u.isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                    No companies match{q ? ` “${q}”` : ""}{sector !== "All" ? ` in ${sector}` : ""}{following ? " among those you follow" : ""}. Clear a filter to see more.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          TTM = sum of the last four reported quarters. Revenue YoY compares the latest quarter with the same quarter a year earlier. Day change and price are live where quoted. Arrow keys move between rows; Enter opens the company.
        </p>
      </section>
    </div>
  );
}

function rowKeys(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter") return open();
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const el = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
  if (el?.dataset.row) el.focus();
}

const CompanyRow = memo(function CompanyRow({ r, sticky, sortKey, followed, pending, onFollow, onOpen }: { r: CRow; sticky: boolean; sortKey: SortKey; followed: boolean; pending: boolean; onFollow: (t: string) => void; onOpen: (t: string) => void }) {
  const num = (k: SortKey, text: string, extra?: string) => (
    <td className={cn("num whitespace-nowrap border-b px-3 py-1 text-right group-hover:bg-secondary", sortKey === k && "font-medium", extra)}>{text}</td>
  );
  return (
    <tr data-row tabIndex={0} onClick={() => onOpen(r.ticker)} onKeyDown={(e) => rowKeys(e, () => onOpen(r.ticker))} aria-label={`${r.ticker} ${r.name}`} className="group h-[29px] cursor-pointer focus-visible:outline-none focus-visible:[&>td]:bg-highlight-soft [&>td]:transition-colors [&>td]:duration-150">
      <td className="w-9 border-b px-1 text-center group-hover:bg-secondary">
        <button
          type="button"
          disabled={pending}
          onClick={(e) => {
            e.stopPropagation();
            onFollow(r.ticker);
          }}
          aria-pressed={followed}
          aria-label={followed ? `Unfollow ${r.ticker}` : `Follow ${r.ticker}`}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star className={cn("size-3.5", followed && "fill-chart-2 text-chart-2")} />
        </button>
      </td>
      <td className={cn("left-0 z-10 w-56 max-w-56 border-b border-r bg-card px-3 py-1 group-hover:bg-secondary", sticky && "sticky")}>
        <TickerMark ticker={r.ticker} name={r.name} link={false} logoSrc={r.logo} className="min-w-0" />
      </td>
      <td className="max-w-40 truncate whitespace-nowrap border-b px-3 py-1 text-[11px] text-muted-foreground group-hover:bg-secondary" title={`${r.sector} · ${r.group}`}>
        {r.group}
      </td>
      {num("price", fmtField(F_USD, r.price))}
      {num("chg", fmtSignedPct(r.chg), r.chg == null ? "" : r.chg > 0 ? "text-positive" : r.chg < 0 ? "text-negative" : "")}
      {num("mcap", fmtField(F_USD, r.mcap))}
      {num("revenueTTM", fmtField(F_USD, r.revenueTTM))}
      {num("growth", fmtSignedPct(r.growth))}
      {num("gm", fmtField(F_PCT, r.gm))}
      {num("pe", fmtField(F_X, r.pe))}
      {num("fcf", fmtField(F_PCT, r.fcf))}
      <td className={cn("whitespace-nowrap border-b px-3 py-1 text-[11px] text-muted-foreground group-hover:bg-secondary", sortKey === "filed" && "text-foreground")}>
        {r.filed ? (
          <>
            <span className="font-medium text-foreground">{r.filed.form}</span> {fmtDate(r.filed.filed, { month: "short", day: "numeric", year: "2-digit" })}
          </>
        ) : (
          "–"
        )}
      </td>
    </tr>
  );
});
