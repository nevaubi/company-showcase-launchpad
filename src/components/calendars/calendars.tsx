import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { useWatchlist } from "@/lib/workspace";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addDays,
  dayDiff,
  fmtMoney,
  fmtPct,
  fmtPerShare,
  minutesOf,
  releaseMeta,
  searchOf,
  shortTime,
  weekStart,
  type Declaration,
  type DividendRow,
  type IpoRow,
  type MacroRelease,
} from "@/lib/calendars/data";
import {
  dividendEvents,
  earningsRows,
  type CalData,
  type DivEvent,
  type EarnRow,
} from "@/lib/calendars/rows";

const th = "px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const DAY = (iso: string) => fmtDate(iso, { weekday: "short", month: "short", day: "numeric" });

function csv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Weight({ w }: { w: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`importance ${w} of 3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("size-1.5 rounded-full", i <= w ? "bg-foreground/70" : "bg-border")}
        />
      ))}
    </span>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "pos" | "neg" | "info" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[10.5px] font-medium whitespace-nowrap",
        tone === "muted" && "bg-secondary text-muted-foreground",
        tone === "pos" && "bg-positive/10 text-positive",
        tone === "neg" && "bg-negative/10 text-negative",
        tone === "info" && "bg-chart-1/10 text-chart-1",
        tone === "warn" && "bg-chart-4/15 text-chart-4",
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- source openers
function useOpeners() {
  const { open } = useSource();
  return {
    earnings: (r: EarnRow) =>
      open({
        ticker: r.ticker,
        label: `${r.ticker} next earnings date`,
        periodLabel: r.date ?? "",
        unit: "USD/share",
        value: r.eps ?? 0,
        external: {
          url: r.url ?? `https://finance.yahoo.com/quote/${r.ticker}/analysis/`,
          date: r.as_of?.slice(0, 10),
          quote: `${r.ticker} next earnings: ${r.date}${r.is_estimate ? " (estimated by the provider, not yet confirmed by the company)" : " (company-confirmed)"}${r.call_date && r.call_date >= r.date! ? `, call ${r.call_date}` : ""}. Consensus EPS ${r.eps != null ? r.eps.toFixed(2) : "n/a"}${r.revenue != null ? `, revenue ${fmtMoney(r.revenue)}` : ""}.`,
          confidence: `${r.provider ?? "Yahoo Finance"} consensus, retrieved ${r.as_of?.slice(0, 10) ?? "–"}.`,
        },
      }),
    report: (r: EarnRow) => {
      const rep = r.last?.report;
      const m = rep && /\/data\/(\d+)\/(\d{18})\/([^/?#]+)$/.exec(rep.url);
      if (!rep || !m) return;
      open({
        ticker: r.ticker,
        label: `${r.ticker} reported EPS, quarter ended ${r.last?.quarter_end}`,
        periodLabel: r.last?.quarter_end ?? rep.filed,
        unit: "USD/share",
        value: r.last?.eps_actual ?? 0,
        doc: {
          accn: rep.accn,
          doc: m[3],
          form: "8-K",
          filed: rep.filed,
          title: `8-K filed ${rep.filed}: EPS ${r.last?.eps_actual ?? "–"} against the ${r.last?.eps_estimate?.toFixed(2) ?? "–"} estimate (${r.provider ?? "Yahoo Finance"} basis)`,
        },
      });
    },
    move: (r: EarnRow) =>
      open({
        ticker: r.ticker,
        label:
          r.kind === "reported"
            ? `${r.ticker} move after the ${r.last?.report?.filed} report`
            : `${r.ticker} typical earnings move`,
        periodLabel:
          r.kind === "reported" ? (r.last?.move_date ?? "") : `${r.reaction?.n ?? 0} reports`,
        unit: "pct",
        value: (r.kind === "reported" ? r.last?.move : r.reaction?.median_abs_move) ?? 0,
        external: {
          url: `https://finance.yahoo.com/quote/${r.ticker.replace(".", "-")}/history/`,
          date: r.last?.move_date ?? undefined,
          quote:
            r.kind === "reported"
              ? `${r.ticker} closed ${signedPct(r.last?.move, 2)} on ${r.last?.move_date} against the prior close, the first session after the 8-K filed ${r.last?.report?.filed}.`
              : `Median absolute one-day move after ${r.ticker}'s last ${r.reaction?.n} earnings releases: ${((r.reaction?.median_abs_move ?? 0) * 100).toFixed(2)}%.`,
          confidence:
            "Computed by Filed Under from daily closes (Yahoo Finance chart API) around each 8-K Item 2.02 filing.",
        },
      }),
    release: (x: MacroRelease) =>
      open({
        ticker: "SPY",
        label: releaseMeta(x.release).label,
        periodLabel: x.release_date,
        unit: "count",
        value: 0,
        external: {
          url: x.source_url,
          date: x.release_date,
          quote: `${x.title}: scheduled ${fmtDate(x.release_date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${x.release_time ? ` at ${x.release_time}` : ""}, per the ${x.provider} release schedule.`,
          confidence: `Read from the publisher's schedule${x.retrieved_at ? ` on ${x.retrieved_at.slice(0, 10)}` : ""}. Publishers can reschedule releases.`,
        },
      }),
    declaration: (ticker: string, x: Declaration) =>
      open({
        ticker,
        label: `${ticker} dividend declaration`,
        periodLabel: x.ex_date ?? x.record ?? x.filed,
        unit: "USD/share",
        value: x.amount,
        doc: {
          accn: x.accn,
          doc: x.doc,
          form: x.form,
          filed: x.filed,
          title: `8-K filed ${x.filed}${x.exhibit && x.exhibit !== "8-K" ? `, ${x.exhibit}` : ""}`,
          search: searchOf(x.quote),
        },
      }),
    projected: (r: DividendRow) =>
      open({
        ticker: r.ticker,
        label: `${r.ticker} projected ex-dividend date`,
        periodLabel: r.projected?.ex_date ?? "",
        unit: "USD/share",
        value: r.projected?.amount ?? 0,
        external: {
          url: `https://finance.yahoo.com/quote/${r.ticker.replace(".", "-")}/history/?filter=div`,
          date: r.last?.ex_date,
          quote: `Projection, not a declaration: ${r.projected?.basis}. Recent cash dividends: ${(
            r.history ?? []
          )
            .slice(-6)
            .map(([d, a]) => `${d} $${a}`)
            .join(", ")}.`,
          confidence:
            "Computed by Filed Under from the stored daily price history's dividend events.",
        },
      }),
    ipoTerm: (
      r: IpoRow,
      label: string,
      t: { quote: string; url?: string; date?: string },
      value: number,
      unit: string,
    ) => {
      const f = r.filings.find((x) => t.url && x.url === t.url);
      return f?.doc
        ? open({
            ticker: r.symbol ?? r.name,
            label: `${r.name}: ${label}`,
            periodLabel: f.date,
            unit,
            value,
            doc: {
              accn: f.accn,
              doc: f.doc,
              form: f.form,
              filed: f.date,
              title: `${f.form} filed ${f.date}`,
              search: searchOf(t.quote),
              cik: String(r.cik),
            },
          })
        : open({
            ticker: r.symbol ?? r.name,
            label: `${r.name}: ${label}`,
            periodLabel: t.date ?? "",
            unit,
            value,
            external: { url: t.url ?? "", date: t.date, quote: t.quote },
          });
    },
    firstDay: (r: IpoRow) => {
      const f = r.first_day;
      if (!f) return;
      open({
        ticker: f.symbol,
        label: `${r.name}: first trading day`,
        periodLabel: f.date,
        unit: "USD/share",
        value: f.close,
        external: {
          url: f.url,
          date: f.date,
          quote: `${f.symbol} first session ${f.date}: opened $${f.open.toFixed(2)}, closed $${f.close.toFixed(2)}${r.price ? ` against the $${r.price.value.toFixed(2)} offer price (${signedPct(f.close_ret)} at the close)` : ""}. Latest close $${f.last_close.toFixed(2)} on ${f.last_date}${f.since_ret != null ? `, ${signedPct(f.since_ret)} since the offer` : ""}.`,
          confidence: `${f.source}. The first bar must fall within ten days of the pricing date.`,
        },
      });
    },
    ipoFiling: (r: IpoRow, f: IpoRow["filings"][number]) =>
      f.doc
        ? open({
            ticker: r.symbol ?? r.name,
            label: `${r.name}: ${f.form}`,
            periodLabel: f.date,
            unit: "count",
            value: 0,
            doc: {
              accn: f.accn,
              doc: f.doc,
              form: f.form,
              filed: f.date,
              title: `${f.form} filed ${f.date}`,
              cik: String(r.cik),
            },
          })
        : window.open(f.url, "_blank", "noopener"),
  };
}

// ---------------------------------------------------------------- week agenda
export function WeekAgenda({
  d,
  week,
  onWeek,
  onDay,
}: {
  d: CalData;
  week: string;
  onWeek: (w: string) => void;
  onDay: (tab: "earnings" | "economic" | "dividends" | "ipos", day: string) => void;
}) {
  const o = useOpeners();
  const days = useMemo(() => [0, 1, 2, 3, 4].map((i) => addDays(week, i)), [week]);
  const earn = useMemo(() => earningsRows(d), [d]);
  const divs = useMemo(() => dividendEvents(d), [d]);
  const byDay = useMemo(() => {
    const m = new Map<
      string,
      { rel: MacroRelease[]; earn: EarnRow[]; div: DivEvent[]; ipo: { r: IpoRow; what: string }[] }
    >();
    for (const x of days) m.set(x, { rel: [], earn: [], div: [], ipo: [] });
    for (const x of d.releases ?? []) m.get(x.release_date)?.rel.push(x);
    for (const x of earn) m.get(x.date!)?.earn.push(x);
    for (const x of divs) m.get(x.date)?.div.push(x);
    for (const r of d.ipos?.rows ?? []) {
      if (r.spac) continue;
      if (r.priced) m.get(r.priced)?.ipo.push({ r, what: "Priced" });
      else if (r.effective && r.status === "effective")
        m.get(r.effective)?.ipo.push({ r, what: "Effective" });
    }
    for (const v of m.values()) {
      v.rel.sort(
        (a, b) =>
          minutesOf(a.release_time) - minutesOf(b.release_time) ||
          releaseMeta(b.release).weight - releaseMeta(a.release).weight,
      );
      v.earn.sort((a, b) => b.size - a.size);
      v.div.sort((a, b) =>
        a.kind === b.kind
          ? (b.row.yield_forward ?? 0) - (a.row.yield_forward ?? 0)
          : a.kind === "declared"
            ? -1
            : 1,
      );
    }
    return m;
  }, [d, earn, divs, days]);

  const nav = (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Previous week"
        onClick={() => onWeek(addDays(week, -7))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => onWeek(weekStart(d.today))}
      >
        This week
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Next week"
        onClick={() => onWeek(addDays(week, 7))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </>
  );
  return (
    <Panel
      title={
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate">
            Week of {fmtDate(week, { month: "long", day: "numeric", year: "numeric" })}
          </span>
          <span className="ml-1 flex items-center gap-0.5 sm:hidden">{nav}</span>
        </span>
      }
      subtitle="Scheduled releases, earnings, ex-dividend dates and IPO pricings. Times are Eastern."
      collapse={false}
      bodyClassName="p-0"
      actions={<span className="hidden items-center gap-1.5 sm:flex">{nav}</span>}
    >
      <div className="grid grid-cols-1 divide-y md:grid-cols-5 md:divide-x md:divide-y-0">
        {days.map((day) => {
          const v = byDay.get(day)!;
          const key = v.rel.filter((x) => releaseMeta(x.release).weight >= 2);
          const minor = v.rel.length - key.length;
          const isToday = day === d.today;
          const past = day < d.today;
          const empty = !v.rel.length && !v.earn.length && !v.div.length && !v.ipo.length;
          return (
            <div
              key={day}
              className={cn("min-w-0 p-3", isToday && "bg-chart-1/[0.04]", past && "opacity-75")}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[13px] font-semibold">{DAY(day)}</p>
                {isToday && <Badge tone="info">Today</Badge>}
              </div>
              {empty && <Empty>Nothing scheduled</Empty>}
              {v.rel.length > 0 && (
                <Section label="Economy" count={v.rel.length} onMore={() => onDay("economic", day)}>
                  {key.map((x) => {
                    const m = releaseMeta(x.release);
                    return (
                      <button
                        key={x.release + x.release_date}
                        type="button"
                        onClick={() => o.release(x)}
                        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-secondary"
                        title={x.title}
                      >
                        <span className="num w-9 shrink-0 text-[11px] text-muted-foreground">
                          {shortTime(x.release_time)}
                        </span>
                        <span
                          className={cn("min-w-0 flex-1 truncate", m.weight === 3 && "font-medium")}
                        >
                          {m.label}
                        </span>
                        <Weight w={m.weight} />
                      </button>
                    );
                  })}
                  {minor > 0 && (
                    <button
                      type="button"
                      onClick={() => onDay("economic", day)}
                      className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      +{minor} minor release{minor > 1 ? "s" : ""}
                    </button>
                  )}
                </Section>
              )}
              {v.earn.length > 0 && (
                <Section
                  label="Earnings"
                  count={v.earn.length}
                  onMore={() => onDay("earnings", day)}
                >
                  {v.earn.slice(0, 7).map((r) => (
                    <div
                      key={r.ticker + r.kind}
                      className="flex items-center gap-1.5 px-1 py-0.5 text-[12px]"
                    >
                      <CompanyLogo ticker={r.ticker} src={r.logo} size="sm" />
                      <Link
                        to="/app/companies/$ticker/estimates"
                        params={{ ticker: r.ticker }}
                        className="font-medium hover:underline"
                      >
                        {r.ticker}
                      </Link>
                      {r.is_estimate && (
                        <span
                          className="text-[10px] text-muted-foreground"
                          title="Date estimated by the data provider"
                        >
                          est.
                        </span>
                      )}
                      {r.kind === "reported" ? (
                        <button
                          type="button"
                          onClick={() => o.report(r)}
                          className={cn(
                            "num ml-auto text-[11px] hover:underline",
                            toneOf(r.last?.surprise_pct),
                          )}
                          title={`Reported EPS ${r.last?.eps_actual ?? "–"} against ${r.last?.eps_estimate?.toFixed(2) ?? "–"} expected`}
                        >
                          {r.last?.eps_actual?.toFixed(2) ?? "–"} (
                          {signedPct(r.last?.surprise_pct, 0)})
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => o.earnings(r)}
                          className="num ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                          title="Consensus EPS"
                        >
                          {r.eps != null ? r.eps.toFixed(2) : "–"}
                        </button>
                      )}
                    </div>
                  ))}
                  {v.earn.length > 7 && (
                    <button
                      type="button"
                      onClick={() => onDay("earnings", day)}
                      className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      +{v.earn.length - 7} more
                    </button>
                  )}
                </Section>
              )}
              {v.div.length > 0 && (
                <Section
                  label="Ex-dividend"
                  count={v.div.length}
                  onMore={() => onDay("dividends", day)}
                >
                  {v.div.slice(0, 5).map((x) => (
                    <button
                      key={x.ticker + x.kind}
                      type="button"
                      onClick={() => (x.dec ? o.declaration(x.ticker, x.dec) : o.projected(x.row))}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-secondary"
                    >
                      <span className="font-medium">{x.ticker}</span>
                      {x.kind === "projected" && (
                        <span className="text-[10px] text-muted-foreground">proj.</span>
                      )}
                      <span className="num ml-auto text-[11px] text-muted-foreground">
                        {fmtPerShare(x.amount)}
                      </span>
                    </button>
                  ))}
                  {v.div.length > 5 && (
                    <button
                      type="button"
                      onClick={() => onDay("dividends", day)}
                      className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      +{v.div.length - 5} more
                    </button>
                  )}
                </Section>
              )}
              {v.ipo.length > 0 && (
                <Section label="IPOs" count={v.ipo.length} onMore={() => onDay("ipos", day)}>
                  {v.ipo.map(({ r, what }) => (
                    <button
                      key={r.cik}
                      type="button"
                      onClick={() =>
                        r.filings.length && o.ipoFiling(r, r.filings[r.filings.length - 1])
                      }
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-secondary"
                      title={r.name}
                    >
                      <span className="min-w-0 flex-1 truncate">{r.symbol ?? r.name}</span>
                      <Badge tone={what === "Priced" ? "pos" : "info"}>{what}</Badge>
                    </button>
                  ))}
                </Section>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Section({
  label,
  count,
  onMore,
  children,
}: {
  label: string;
  count: number;
  onMore: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <button
        type="button"
        onClick={onMore}
        className="mb-0.5 flex w-full items-center justify-between px-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        <span>{label}</span>
        {count > 0 && <span className="num">{count}</span>}
      </button>
      <div className="grid">{children}</div>
    </div>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="px-1 text-[11px] text-muted-foreground/70">{children}</p>
);

// ---------------------------------------------------------------- range control shared by the list tabs
export type Win = { from: string; to: string };
const WINDOWS = ["day", "week", "next", "30d", "past"] as const;
type WinKey = (typeof WINDOWS)[number];
function windowOf(k: WinKey, today: string, day?: string): Win {
  const wk = weekStart(today);
  if (k === "day" && day) return { from: day, to: day };
  if (k === "week") return { from: wk, to: addDays(wk, 4) };
  if (k === "next") return { from: addDays(wk, 7), to: addDays(wk, 11) };
  if (k === "past") return { from: addDays(today, -14), to: addDays(today, -1) };
  return { from: today, to: addDays(today, 30) };
}
function WindowPicker({
  value,
  onChange,
  day,
}: {
  value: WinKey;
  onChange: (k: WinKey) => void;
  day?: string;
}) {
  const labels: Record<WinKey, string> = {
    day: day ? DAY(day) : "Day",
    week: "This week",
    next: "Next week",
    "30d": "Next 30 days",
    past: "Past 14 days",
  };
  return (
    <Pills
      label="Date range"
      value={value}
      onChange={onChange}
      options={WINDOWS.filter((k) => k !== "day" || day).map((k) => ({ v: k, l: labels[k] }))}
    />
  );
}

/** Second-level options: one row that scrolls sideways on a phone instead of stacking; counts as muted badges. */
function Pills<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; l: string; n?: number }[];
}) {
  return (
    <div className="w-full overflow-x-auto [scrollbar-width:none] sm:w-auto">
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex snap-x flex-nowrap rounded-md border bg-secondary/50 p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              "inline-flex h-7 shrink-0 snap-start items-center gap-1.5 rounded px-2 text-[11px] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              value === o.v
                ? "bg-card font-medium text-foreground shadow-paper"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.l}
            {o.n != null && (
              <span className="num rounded bg-secondary px-1 text-[10px] font-normal text-muted-foreground">
                {o.n}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Calendar tables scroll sideways on narrow screens with the first column pinned. */
const TABLE =
  "w-full min-w-[640px] text-[12px] [&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] [&_tr>*:first-child]:bg-background";

function DateHeader({
  day,
  today,
  n,
  cols,
}: {
  day: string;
  today: string;
  n: number;
  cols: number;
}) {
  const diff = dayDiff(today, day);
  return (
    <tr className="border-b bg-secondary/40">
      <td colSpan={cols} className="px-3 py-1 text-[11.5px] font-semibold">
        {DAY(day)}
        <span className="ml-2 font-normal text-muted-foreground">
          {diff === 0
            ? "today"
            : diff === 1
              ? "tomorrow"
              : diff === -1
                ? "yesterday"
                : diff > 0
                  ? `in ${diff} days`
                  : `${-diff} days ago`}{" "}
          · {n}
        </span>
      </td>
    </tr>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------- earnings
const signedPct = (v: number | null | undefined, dp = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
const toneOf = (v: number | null | undefined) =>
  v == null ? "" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "";

export function EarningsList({ d, day }: { d: CalData; day?: string }) {
  const o = useOpeners();
  const watch = useWatchlist();
  const watched = useMemo(() => new Set((watch.data ?? []).map((w) => w.ticker)), [watch.data]);
  const [win, setWin] = useState<WinKey>(day ? "day" : "week");
  const [sector, setSector] = useState("all");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => earningsRows(d), [d]);
  const sectors = useMemo(
    () => [...new Set(all.map((r) => r.sector).filter(Boolean))].sort(),
    [all],
  );
  const w = windowOf(win, d.today, day);
  const rows = all.filter(
    (r) =>
      r.date! >= w.from &&
      r.date! <= w.to &&
      (!mine || watched.has(r.ticker)) &&
      (sector === "all" || r.sector === sector) &&
      (!q || r.ticker.includes(q.toUpperCase()) || r.name.toLowerCase().includes(q.toLowerCase())),
  );
  const groups = groupBy(rows, (r) => r.date!).map(
    ([k, v]) =>
      [
        k,
        v.sort(
          (a, b) =>
            Number(watched.has(b.ticker)) - Number(watched.has(a.ticker)) || b.size - a.size,
        ),
      ] as const,
  );
  const reported = rows.filter((r) => r.kind === "reported").length;
  return (
    <Panel
      title="Earnings calendar"
      subtitle={`${rows.length} companies${reported ? `, ${reported} reported` : ""} · dates and consensus from ${all[0]?.provider ?? "Yahoo Finance"}; reported rows show the latest quarter against its estimate and the next day's move`}
      collapse={false}
      bodyClassName="p-0"
      actions={
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={() =>
            csv(
              `earnings-${w.from}-${w.to}.csv`,
              [
                "date",
                "ticker",
                "name",
                "sector",
                "status",
                "eps_expected",
                "eps_actual",
                "surprise_pct",
                "move_1d",
                "typical_abs_move",
                "revenue_consensus",
              ],
              rows.map((r) => [
                r.date,
                r.ticker,
                r.name,
                r.sector,
                r.kind === "reported"
                  ? "reported"
                  : r.is_estimate
                    ? "estimated"
                    : r.is_estimate === false
                      ? "confirmed"
                      : "",
                r.kind === "reported" ? r.last?.eps_estimate : r.eps,
                r.kind === "reported" ? r.last?.eps_actual : null,
                r.kind === "reported" ? r.last?.surprise_pct : null,
                r.kind === "reported" ? r.last?.move : null,
                r.reaction?.median_abs_move,
                r.kind === "upcoming" ? r.revenue : null,
              ]),
            )
          }
        >
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <WindowPicker value={win} onChange={setWin} day={day} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={mine} onCheckedChange={setMine} aria-label="Watchlist only" />
          Watchlist only{watched.size ? ` (${watched.size})` : ""}
        </label>
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger aria-label="Sector" className="h-7 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticker or name"
          className="h-7 w-44 text-xs"
        />
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={th}>Company</th>
              <th className={th}>Status</th>
              <th className={cn(th, "text-right")}>EPS expected</th>
              <th className={cn(th, "text-right")}>EPS actual</th>
              <th className={cn(th, "text-right")}>Surprise</th>
              <th
                className={cn(th, "text-right")}
                title="Reported: the next session's close-to-close move. Upcoming: the median absolute move after recent reports."
              >
                Move
              </th>
              <th className={cn(th, "text-right")}>Revenue consensus</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {mine && !watched.size
                    ? "Your watchlist is empty."
                    : "No earnings in this range."}
                </td>
              </tr>
            )}
            {groups.map(([day_, rs]) => (
              <Frag key={day_}>
                <DateHeader day={day_} today={d.today} n={rs.length} cols={7} />
                {rs.map((r) => {
                  const rep = r.kind === "reported";
                  return (
                    <tr key={r.ticker + r.kind} className="border-b hover:bg-secondary/50">
                      <td className={td}>
                        <div className="flex min-w-0 items-center gap-2">
                          <CompanyLogo ticker={r.ticker} src={r.logo} size="sm" />
                          <Link
                            to="/app/companies/$ticker/estimates"
                            params={{ ticker: r.ticker }}
                            className="font-medium hover:underline"
                          >
                            {r.ticker}
                          </Link>
                          {watched.has(r.ticker) && (
                            <span className="text-[10px] text-chart-1" title="On your watchlist">
                              ●
                            </span>
                          )}
                          <span className="max-w-64 truncate text-muted-foreground">{r.name}</span>
                        </div>
                      </td>
                      <td className={cn(td, "whitespace-nowrap")}>
                        {rep ? (
                          <button
                            type="button"
                            onClick={() => o.report(r)}
                            className="hover:opacity-80"
                          >
                            <Badge tone="info">reported</Badge>
                          </button>
                        ) : r.awaiting ? (
                          <Badge tone="warn">results pending</Badge>
                        ) : r.is_estimate ? (
                          <Badge>est.</Badge>
                        ) : r.is_estimate === false ? (
                          <Badge tone="pos">confirmed</Badge>
                        ) : null}
                        {rep && r.last?.quarter_end && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            qtr ended{" "}
                            {fmtDate(r.last.quarter_end, { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {!rep &&
                          r.call_date &&
                          r.call_date > r.date! &&
                          dayDiff(r.date!, r.call_date) <= 3 && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              call {fmtDate(r.call_date, { month: "short", day: "numeric" })}
                            </span>
                          )}
                      </td>
                      <td className={cn(td, "num text-right")}>
                        <button
                          type="button"
                          onClick={() => (rep ? o.report(r) : o.earnings(r))}
                          className="hover:underline"
                        >
                          {(rep ? r.last?.eps_estimate : r.eps)?.toFixed(2) ?? "–"}
                        </button>
                      </td>
                      <td className={cn(td, "num text-right font-medium")}>
                        {rep ? (
                          <button
                            type="button"
                            onClick={() => o.report(r)}
                            className="hover:underline"
                          >
                            {r.last?.eps_actual?.toFixed(2) ?? "–"}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      <td className={cn(td, "num text-right", rep && toneOf(r.last?.surprise_pct))}>
                        {rep ? signedPct(r.last?.surprise_pct) : "–"}
                      </td>
                      <td className={cn(td, "num text-right", rep && toneOf(r.last?.move))}>
                        {rep ? (
                          <button
                            type="button"
                            onClick={() => o.move(r)}
                            className="hover:underline"
                          >
                            {signedPct(r.last?.move)}
                          </button>
                        ) : r.reaction ? (
                          <button
                            type="button"
                            onClick={() => o.move(r)}
                            className="text-muted-foreground hover:underline"
                            title={`Typical: ${r.reaction.basis} (${r.reaction.n} reports)`}
                          >
                            ±{(r.reaction.median_abs_move * 100).toFixed(1)}%
                          </button>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className={cn(td, "num text-right")}>
                        {rep ? (
                          <span className="text-muted-foreground">–</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => o.earnings(r)}
                            className="hover:underline"
                          >
                            {fmtMoney(r.revenue)}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Frag>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        Reported rows use the provider's EPS basis for actual and estimate; the 8-K opens from the
        status or EPS. Move is the one-day close-to-close return after the release; the typical move
        is the median absolute move over the reports on file.
      </p>
    </Panel>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------- economic
const GROUPS = [
  "Fed",
  "Inflation",
  "Labor",
  "Growth",
  "Consumer",
  "Housing",
  "Rates",
  "Credit",
  "Positioning",
];
export function EconomicList({ d, day }: { d: CalData; day?: string }) {
  const o = useOpeners();
  const [win, setWin] = useState<WinKey>(day ? "day" : "30d");
  const [keyOnly, setKeyOnly] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const w = windowOf(win, d.today, day);
  const rows = (d.releases ?? []).filter((x) => {
    const m = releaseMeta(x.release);
    return (
      x.release_date >= w.from &&
      x.release_date <= w.to &&
      (!keyOnly || m.weight >= 2) &&
      (!groups.length || groups.includes(m.group))
    );
  });
  const byDay = groupBy(rows, (x) => x.release_date).map(
    ([k, v]) =>
      [k, v.sort((a, b) => minutesOf(a.release_time) - minutesOf(b.release_time))] as const,
  );
  const providers = [...new Set((d.releases ?? []).map((x) => x.provider))];
  return (
    <Panel
      title="Economic calendar"
      subtitle={`${rows.length} releases · from the publishers' own schedules: ${providers.join(", ")}`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <WindowPicker value={win} onChange={setWin} day={day} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={keyOnly} onCheckedChange={setKeyOnly} aria-label="Market-moving only" />{" "}
          Market-moving only
        </label>
        <div className="flex w-full gap-1 overflow-x-auto [scrollbar-width:none] sm:w-auto sm:flex-wrap">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() =>
                setGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))
              }
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap",
                groups.includes(g)
                  ? "border-foreground/40 bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={cn(th, "w-20")}>Time (ET)</th>
              <th className={th}>Release</th>
              <th className={th}>Group</th>
              <th className={th}>Publisher</th>
              <th className={cn(th, "w-16")}>Impact</th>
            </tr>
          </thead>
          <tbody>
            {byDay.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No releases scheduled in this range.
                </td>
              </tr>
            )}
            {byDay.map(([day_, xs]) => (
              <Frag key={day_}>
                <DateHeader day={day_} today={d.today} n={xs.length} cols={5} />
                {xs.map((x) => {
                  const m = releaseMeta(x.release);
                  return (
                    <tr
                      key={x.release + x.release_date}
                      className="cursor-pointer border-b hover:bg-secondary/50"
                      onClick={() => o.release(x)}
                    >
                      <td className={cn(td, "num whitespace-nowrap text-muted-foreground")}>
                        {x.release_time?.replace(" ET", "") ?? "–"}
                      </td>
                      <td className={td}>
                        <span className={cn(m.weight === 3 && "font-medium")}>{m.label}</span>
                        <span className="ml-2 text-muted-foreground">
                          {x.title.toLowerCase() !== m.label.toLowerCase() ? x.title : ""}
                        </span>
                      </td>
                      <td className={cn(td, "text-muted-foreground")}>{m.group}</td>
                      <td className={cn(td, "whitespace-nowrap text-muted-foreground")}>
                        {x.provider}
                      </td>
                      <td className={td}>
                        <Weight w={m.weight} />
                      </td>
                    </tr>
                  );
                })}
              </Frag>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        Impact is a fixed editorial ranking of how much each release usually moves rates and
        equities, not a forecast. Click a row for the publisher's schedule.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- dividends
export function DividendsList({ d, day }: { d: CalData; day?: string }) {
  const o = useOpeners();
  const [view, setView] = useState<"upcoming" | "declared" | "yield">(
    day ? "upcoming" : "upcoming",
  );
  const [win, setWin] = useState<WinKey>(day ? "day" : "30d");
  const [proj, setProj] = useState(true);
  const events = useMemo(() => dividendEvents(d), [d]);
  const w = windowOf(win, d.today, day);
  const upcoming = events
    .filter((x) => x.date >= w.from && x.date <= w.to && (proj || x.kind === "declared"))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "declared" ? -1 : 1));
  const declared = (d.dividends?.rows ?? [])
    .flatMap((r) => r.declared.map((x) => ({ r, x })))
    .sort((a, b) => b.x.filed.localeCompare(a.x.filed));
  const yieldRows = (d.dividends?.rows ?? [])
    .filter((r) => r.yield_forward != null && r.frequency && r.frequency !== "irregular")
    .sort((a, b) => (b.yield_forward ?? 0) - (a.yield_forward ?? 0))
    .slice(0, 100);
  return (
    <Panel
      title="Dividend calendar"
      subtitle="Declarations read from 8-K filings; cadence and yields from the cash dividends in the daily price history"
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Pills
          label="View"
          value={view}
          onChange={setView}
          options={[
            { v: "upcoming", l: "Ex-dates" },
            { v: "declared", l: "Recently declared", n: declared.length },
            { v: "yield", l: "Highest yield" },
          ]}
        />
        {view === "upcoming" && (
          <>
            <WindowPicker value={win} onChange={setWin} day={day} />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={proj} onCheckedChange={setProj} aria-label="Include projected" />{" "}
              Include projected
            </label>
          </>
        )}
      </div>
      {view === "upcoming" && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className="border-b">
                <th className={th}>Company</th>
                <th className={cn(th, "text-right")}>Amount</th>
                <th className={th}>Basis</th>
                <th className={th}>Record</th>
                <th className={th}>Payable</th>
                <th className={cn(th, "text-right")}>Fwd yield</th>
                <th className={th}>Frequency</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No ex-dividend dates in this range.
                  </td>
                </tr>
              )}
              {groupBy(upcoming, (x) => x.date).map(([day_, xs]) => (
                <Frag key={day_}>
                  <DateHeader day={day_} today={d.today} n={xs.length} cols={7} />
                  {xs.map((x) => (
                    <tr
                      key={x.ticker + x.kind + x.amount}
                      className="cursor-pointer border-b hover:bg-secondary/50"
                      onClick={() => (x.dec ? o.declaration(x.ticker, x.dec) : o.projected(x.row))}
                    >
                      <td className={td}>
                        <span className="font-medium">{x.ticker}</span>
                        <span className="ml-2 text-muted-foreground">{x.name}</span>
                      </td>
                      <td className={cn(td, "num text-right")}>{fmtPerShare(x.amount, 4)}</td>
                      <td className={td}>
                        {x.kind === "declared" ? (
                          <span className="flex gap-1">
                            <Badge tone="pos">declared</Badge>
                            {x.dec?.kind === "special" && <Badge tone="warn">special</Badge>}
                            {x.dec?.share_class && <Badge>{x.dec.share_class}</Badge>}
                            {x.dec?.increase && <Badge tone="info">increase</Badge>}
                          </span>
                        ) : (
                          <span title={x.row.projected?.basis}>
                            <Badge>projected</Badge>
                          </span>
                        )}
                      </td>
                      <td className={cn(td, "num text-muted-foreground")}>
                        {x.dec?.record
                          ? fmtDate(x.dec.record, { month: "short", day: "numeric" })
                          : "–"}
                      </td>
                      <td className={cn(td, "num text-muted-foreground")}>
                        {x.dec?.payable
                          ? fmtDate(x.dec.payable, { month: "short", day: "numeric" })
                          : "–"}
                      </td>
                      <td className={cn(td, "num text-right")}>{fmtPct(x.row.yield_forward, 2)}</td>
                      <td className={cn(td, "text-muted-foreground")}>{x.row.frequency ?? "–"}</td>
                    </tr>
                  ))}
                </Frag>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "declared" && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className="border-b">
                <th className={th}>Filed</th>
                <th className={th}>Company</th>
                <th className={cn(th, "text-right")}>Amount</th>
                <th className={cn(th, "text-right")}>Prior</th>
                <th className={th}>Ex-date</th>
                <th className={th}>Payable</th>
                <th className={th}>From the filing</th>
              </tr>
            </thead>
            <tbody>
              {declared.map(({ r, x }) => {
                const prior = (r.history ?? [])
                  .filter(([dd]) => dd < (x.ex_date ?? x.filed))
                  .slice(-1)[0];
                const chg = prior && prior[1] ? x.amount / prior[1] - 1 : null;
                return (
                  <tr
                    key={r.ticker + x.accn + x.amount}
                    className="cursor-pointer border-b hover:bg-secondary/50"
                    onClick={() => o.declaration(r.ticker, x)}
                  >
                    <td className={cn(td, "num whitespace-nowrap text-muted-foreground")}>
                      {fmtDate(x.filed, { month: "short", day: "numeric" })}
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      <span className="font-medium">{r.ticker}</span>
                      {x.kind === "special" && (
                        <span className="ml-1">
                          <Badge tone="warn">special</Badge>
                        </span>
                      )}
                    </td>
                    <td className={cn(td, "num text-right")}>{fmtPerShare(x.amount, 4)}</td>
                    <td
                      className={cn(
                        td,
                        "num text-right whitespace-nowrap",
                        chg != null && chg > 0.001
                          ? "text-positive"
                          : chg != null && chg < -0.001
                            ? "text-negative"
                            : "text-muted-foreground",
                      )}
                    >
                      {prior
                        ? `${fmtPerShare(prior[1], 4)}${chg != null && Math.abs(chg) > 0.001 && x.kind !== "special" ? ` (${chg > 0 ? "+" : ""}${(chg * 100).toFixed(1)}%)` : ""}`
                        : "–"}
                    </td>
                    <td className={cn(td, "num whitespace-nowrap")}>
                      {x.ex_date ? fmtDate(x.ex_date, { month: "short", day: "numeric" }) : "–"}
                    </td>
                    <td className={cn(td, "num whitespace-nowrap text-muted-foreground")}>
                      {x.payable ? fmtDate(x.payable, { month: "short", day: "numeric" }) : "–"}
                    </td>
                    <td className={cn(td, "w-full max-w-0 min-w-[14rem]")}>
                      <span className="line-clamp-2 text-[11.5px] text-muted-foreground">
                        {x.quote}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view === "yield" && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className="border-b">
                <th className={th}>Company</th>
                <th className={cn(th, "text-right")}>Last</th>
                <th className={th}>Frequency</th>
                <th className={cn(th, "text-right")}>Forward annual</th>
                <th className={cn(th, "text-right")}>Fwd yield</th>
                <th className={cn(th, "text-right")}>TTM paid</th>
                <th className={cn(th, "text-right")}>TTM yield</th>
                <th className={th}>Next ex-date</th>
              </tr>
            </thead>
            <tbody>
              {yieldRows.map((r) => {
                const dec = r.upcoming[0];
                return (
                  <tr
                    key={r.ticker}
                    className="cursor-pointer border-b hover:bg-secondary/50"
                    onClick={() => (dec ? o.declaration(r.ticker, dec) : o.projected(r))}
                  >
                    <td className={td}>
                      <span className="font-medium">{r.ticker}</span>
                      <span className="ml-2 text-muted-foreground">
                        {d.uni.get(r.ticker)?.name ?? r.name}
                      </span>
                    </td>
                    <td className={cn(td, "num text-right")}>{fmtPerShare(r.last?.amount, 4)}</td>
                    <td className={cn(td, "text-muted-foreground")}>{r.frequency}</td>
                    <td className={cn(td, "num text-right")}>{fmtPerShare(r.forward_annual)}</td>
                    <td className={cn(td, "num text-right font-medium")}>
                      {fmtPct(r.yield_forward, 2)}
                    </td>
                    <td className={cn(td, "num text-right text-muted-foreground")}>
                      {fmtPerShare(r.ttm)}
                    </td>
                    <td className={cn(td, "num text-right text-muted-foreground")}>
                      {fmtPct(r.yield_ttm, 2)}
                    </td>
                    <td className={cn(td, "num whitespace-nowrap")}>
                      {dec?.ex_date ? (
                        <>
                          {fmtDate(dec.ex_date, { month: "short", day: "numeric" })}{" "}
                          <Badge tone="pos">declared</Badge>
                        </>
                      ) : r.projected ? (
                        <>
                          {fmtDate(r.projected.ex_date, { month: "short", day: "numeric" })}{" "}
                          <Badge>projected</Badge>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {d.dividends?.sources.ex_date_rule} Forward yield is the latest regular payment times its
        yearly frequency over the last close. A projected date adds the usual gap between payments
        to the last ex-date and is replaced once the company declares.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- IPOs
const STATUS_TONE: Record<IpoRow["status"], "pos" | "info" | "muted" | "neg" | "warn"> = {
  priced: "pos",
  effective: "info",
  amended: "warn",
  filed: "muted",
  stalled: "muted",
  withdrawn: "neg",
};
export function IposList({ d, day }: { d: CalData; day?: string }) {
  const o = useOpeners();
  const [status, setStatus] = useState<"active" | "priced" | "stalled" | "all" | "withdrawn">(
    day ? "priced" : "active",
  );
  const [spac, setSpac] = useState(false);
  const all = (d.ipos?.rows ?? []).filter((r) => spac || !r.spac);
  const rows = all
    .filter((r) =>
      status === "all"
        ? true
        : status === "active"
          ? r.status === "filed" || r.status === "amended" || r.status === "effective"
          : r.status === status,
    )
    .filter((r) => !day || r.priced === day || r.effective === day)
    // most recent activity first: an effectiveness notice from months ago with no pricing is not "on deck"
    .sort((a, b) => (b.priced ?? b.last_activity).localeCompare(a.priced ?? a.last_activity));
  const cnt = (s: IpoRow["status"]) => all.filter((r) => r.status === s).length;
  return (
    <Panel
      title="IPO pipeline"
      subtitle={`Registrations, effectiveness notices and final prospectuses on EDGAR over the last ${d.ipos?.window_days ?? 180} days`}
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Pills
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            {
              v: "active",
              l: "In registration",
              n: cnt("filed") + cnt("amended") + cnt("effective"),
            },
            { v: "priced", l: "Priced", n: cnt("priced") },
            { v: "stalled", l: "Stalled", n: cnt("stalled") },
            { v: "withdrawn", l: "Withdrawn", n: cnt("withdrawn") },
            { v: "all", l: "All", n: all.length },
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={spac} onCheckedChange={setSpac} aria-label="Include SPACs" /> Include
          SPACs
        </label>
        {day && <span className="text-xs text-muted-foreground">Showing {DAY(day)}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="border-b">
              <th className={th}>Company</th>
              <th className={th}>Status</th>
              <th className={th}>Symbol</th>
              <th className={cn(th, "text-right")}>Range</th>
              <th className={cn(th, "text-right")}>Price</th>
              <th className={cn(th, "text-right")}>Shares</th>
              <th className={cn(th, "text-right")}>Proceeds</th>
              <th
                className={cn(th, "text-right")}
                title="First session close against the offer price; below it, the return since the offer at the latest close"
              >
                First day
              </th>
              <th className={th}>First filed</th>
              <th className={th}>Filings</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  No registrants in this view.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.cik} className="border-b hover:bg-secondary/50">
                <td className={cn(td, "w-full max-w-0 min-w-[11rem]")}>
                  <p className="truncate font-medium" title={r.name}>
                    {r.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[
                      r.sic_desc,
                      r.country,
                      r.form,
                      r.spac ? "SPAC" : null,
                      r.direct_listing ? "direct listing" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.underwriters && r.underwriters.names.length > 0 && (
                    <button
                      type="button"
                      onClick={() => o.ipoTerm(r, "underwriters", r.underwriters!, 0, "count")}
                      className="block max-w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground"
                      title={r.underwriters.names.join(", ")}
                    >
                      <span className="text-foreground/70">Underwriters:</span>{" "}
                      {r.underwriters.names.slice(0, 3).join(", ")}
                      {r.underwriters.names.length > 3
                        ? ` +${r.underwriters.names.length - 3}`
                        : ""}
                    </button>
                  )}
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">
                    {fmtDate(r.priced ?? r.withdrawn ?? r.effective ?? r.last_activity, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  {r.symbol ? (
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      title={r.symbol_quote ?? undefined}
                      onClick={() =>
                        r.symbol_quote &&
                        o.ipoTerm(
                          r,
                          "proposed symbol",
                          {
                            quote: r.symbol_quote,
                            url: (r.price ?? r.range ?? r.shares)?.url,
                            date: (r.price ?? r.range ?? r.shares)?.date,
                          },
                          0,
                          "count",
                        )
                      }
                    >
                      {r.symbol}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                  {r.exchange && <p className="text-[11px] text-muted-foreground">{r.exchange}</p>}
                </td>
                <td className={cn(td, "num text-right whitespace-nowrap")}>
                  {r.range ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() =>
                        o.ipoTerm(r, "price range", r.range!, r.range!.hi, "USD/share")
                      }
                    >
                      {r.range.lo === r.range.hi
                        ? `$${r.range.lo.toFixed(2)}`
                        : `$${r.range.lo.toFixed(2)}–${r.range.hi.toFixed(2)}`}
                    </button>
                  ) : (
                    "–"
                  )}
                  {r.range && r.range.lo === r.range.hi && (
                    <p className="text-[10.5px] text-muted-foreground">
                      {r.range.fixed ? "fixed price" : "expected"}
                    </p>
                  )}
                </td>
                <td className={cn(td, "num text-right whitespace-nowrap")}>
                  {r.price ? (
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() =>
                        o.ipoTerm(r, "offering price", r.price!, r.price!.value, "USD/share")
                      }
                    >
                      ${r.price.value.toFixed(2)}
                    </button>
                  ) : (
                    "–"
                  )}
                  {r.price && r.range && (
                    <p
                      className={cn(
                        "text-[10.5px]",
                        r.price.value > r.range.hi
                          ? "text-positive"
                          : r.price.value < r.range.lo
                            ? "text-negative"
                            : "text-muted-foreground",
                      )}
                    >
                      {r.price.value > r.range.hi
                        ? "above range"
                        : r.price.value < r.range.lo
                          ? "below range"
                          : "in range"}
                    </p>
                  )}
                </td>
                <td className={cn(td, "num text-right whitespace-nowrap")}>
                  {r.shares ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() =>
                        o.ipoTerm(r, "shares offered", r.shares!, r.shares!.value, "shares")
                      }
                    >
                      {(r.shares.value / 1e6).toFixed(r.shares.value >= 1e7 ? 1 : 2)}M
                    </button>
                  ) : (
                    "–"
                  )}
                </td>
                <td className={cn(td, "num text-right")}>{fmtMoney(r.proceeds)}</td>
                <td className={cn(td, "num text-right whitespace-nowrap")}>
                  {r.first_day ? (
                    <button
                      type="button"
                      onClick={() => o.firstDay(r)}
                      className={cn("hover:underline", toneOf(r.first_day.close_ret))}
                    >
                      {r.first_day.close_ret != null
                        ? signedPct(r.first_day.close_ret)
                        : `$${r.first_day.close.toFixed(2)}`}
                    </button>
                  ) : (
                    "–"
                  )}
                  {r.first_day?.since_ret != null && (
                    <p className={cn("text-[10.5px]", toneOf(r.first_day.since_ret))}>
                      {signedPct(r.first_day.since_ret)} since
                    </p>
                  )}
                </td>
                <td className={cn(td, "num whitespace-nowrap text-muted-foreground")}>
                  {r.first_filed
                    ? fmtDate(r.first_filed, { month: "short", day: "numeric", year: "2-digit" })
                    : "–"}
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  <div className="flex gap-1">
                    {r.filings.slice(-3).map((f) => (
                      <button
                        key={f.accn + f.form}
                        type="button"
                        onClick={() => o.ipoFiling(r, f)}
                        title={`${f.form} filed ${f.date}`}
                        className="rounded border px-1 py-px text-[10.5px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      >
                        {f.form}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {d.ipos?.method} Price ranges appear only once a company amends its registration with one;
        final terms and underwriters come from the 424B prospectus cover. Proceeds are price times
        base shares, before any over-allotment. Stalled: effective for more than 30 days with no
        final prospectus. First day: the first session's close against the offer price (Yahoo
        Finance daily bars).
      </p>
    </Panel>
  );
}
