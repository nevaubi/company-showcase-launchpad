import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import {
  filterHighlights,
  insightIndexQuery,
  redlineDoc,
  redlineIndexQuery,
  resolveDoc,
  searchPhrase,
  type FeedFilter,
  type InsightIndexRow,
  type RedlineHighlight,
} from "@/lib/filings/feed";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/filings")({
  head: () => ({
    meta: [
      { title: "Filings — Filed Under" },
      {
        name: "description",
        content:
          "Recent 10-K and 10-Q filings across coverage: the largest disclosure changes against the prior-year filing and the top verified insights, each opening the filing at the passage.",
      },
      { property: "og:title", content: "Filings — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Filings,
});

const CHANGE_LABEL: Record<RedlineHighlight["change"], string> = {
  added: "new text",
  removed: "removed",
  modified: "reworded",
};
const today = () => new Date().toISOString().slice(0, 10);

function Filings() {
  const idx = useQuery(redlineIndexQuery);
  const ins = useQuery(insightIndexQuery);
  const uni = useUniverse();
  const { open } = useSource();
  const [f, setF] = useState<FeedFilter>({
    form: "all",
    sector: "all",
    signal: "all",
    days: 30,
    q: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const uniMap = useMemo(
    () => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])),
    [uni.data],
  );
  const sectorOf = (t: string) => uniMap.get(t)?.sector;
  const all = useMemo(() => idx.data?.recent ?? [], [idx.data]);
  const sectors = useMemo(
    () => [...new Set(all.map((r) => sectorOf(r.ticker)).filter((s): s is string => !!s))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, uniMap],
  );
  const signals = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of all) for (const s of r.signals) n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [all]);
  const rows = filterHighlights(all, f, sectorOf, today());
  const byDay = useMemo(() => {
    const m = new Map<string, RedlineHighlight[]>();
    for (const r of rows) {
      if (!m.has(r.filed)) m.set(r.filed, []);
      m.get(r.filed)!.push(r);
    }
    return [...m.entries()];
  }, [rows]);
  const insights = useMemo(() => {
    const since = new Date(Date.now() - f.days * 864e5).toISOString().slice(0, 10);
    return Object.values(ins.data?.companies ?? {})
      .filter(
        (r) =>
          r.filed >= since &&
          r.top.length > 0 &&
          (f.form === "all" || r.form === f.form) &&
          (f.sector === "all" || sectorOf(r.ticker) === f.sector),
      )
      .sort(
        (a, b) => b.filed.localeCompare(a.filed) || (b.top[0]?.score ?? 0) - (a.top[0]?.score ?? 0),
      )
      .slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ins.data, f, uniMap]);

  const openHighlight = async (h: RedlineHighlight) => {
    const key = `${h.ticker}${h.section_id}${h.score}`;
    setBusy(key);
    try {
      const d = resolveDoc(h, h.accn ? null : await redlineDoc(h.ticker).catch(() => null));
      if (!d) return;
      open({
        ticker: h.ticker,
        label: `${h.section}: ${CHANGE_LABEL[h.change]}`,
        periodLabel: `${h.form} filed ${h.filed}`,
        unit: "count",
        value: h.score,
        doc: {
          accn: d.accn,
          doc: d.doc,
          form: h.form,
          filed: d.filed,
          title: `${h.form} filed ${fmtDate(d.filed)}${h.change === "removed" ? " (the prior-year filing; this passage was dropped)" : ""}`,
          search: h.search ?? searchPhrase(h.excerpt),
        },
      });
    } finally {
      setBusy(null);
    }
  };
  const openInsight = (r: InsightIndexRow, i: InsightIndexRow["top"][number]) =>
    open({
      ticker: r.ticker,
      label: i.title,
      periodLabel: `${r.form} filed ${r.filed}`,
      unit: "count",
      value: i.score,
      doc: {
        accn: r.accn,
        doc: r.doc,
        form: r.form,
        filed: r.filed,
        title: `${r.form} filed ${fmtDate(r.filed)}`,
        search: searchPhrase(i.quote),
      },
    });

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Research"
        title="Filings"
        description={
          idx.data
            ? `What changed in recent 10-K and 10-Q filings against the same filing a year earlier · ${idx.data.count.toLocaleString()} companies compared · updated ${fmtRelative(idx.data.generated)}`
            : "What changed in recent 10-K and 10-Q filings against the same filing a year earlier"
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Form"
          size="xs"
          value={f.form}
          onChange={(v) => setF({ ...f, form: v })}
          options={[
            { v: "all", l: "All forms" },
            { v: "10-K", l: "10-K" },
            { v: "10-Q", l: "10-Q" },
          ]}
        />
        <Segmented
          label="Window"
          size="xs"
          value={String(f.days) as "7" | "30" | "90"}
          onChange={(v) => setF({ ...f, days: Number(v) })}
          options={[
            { v: "7", l: "7 days" },
            { v: "30", l: "30 days" },
            { v: "90", l: "90 days" },
          ]}
        />
        <Select value={f.sector} onValueChange={(v) => setF({ ...f, sector: v })}>
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
        <Select value={f.signal} onValueChange={(v) => setF({ ...f, signal: v })}>
          <SelectTrigger aria-label="Signal" className="h-7 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All signals</SelectItem>
            {signals.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
          placeholder="Ticker, company or words"
          className="h-7 w-52 text-xs"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="Largest disclosure changes"
          subtitle={`${rows.length} passages · ranked by the size of the wording change and the analyst signal words in it`}
          collapse={false}
          bodyClassName="p-0"
        >
          {idx.isLoading ? (
            <Skeleton className="m-3 h-96" />
          ) : idx.isError ? (
            <p className="p-4 text-sm text-muted-foreground">
              The redline index is not available right now.
            </p>
          ) : byDay.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No changed passages match these filters.
            </p>
          ) : (
            byDay.map(([day, xs]) => (
              <div key={day}>
                <p className="border-b bg-secondary/40 px-3.5 py-1 text-[11.5px] font-semibold">
                  {fmtDate(day, { weekday: "short", month: "short", day: "numeric" })}
                  <span className="ml-2 font-normal text-muted-foreground">{xs.length}</span>
                </p>
                <ul className="divide-y">
                  {xs.map((h, n) => {
                    const key = `${h.ticker}${h.section_id}${h.score}`;
                    const u = uniMap.get(h.ticker);
                    return (
                      <li key={`${key}-${n}`}>
                        <button
                          type="button"
                          onClick={() => void openHighlight(h)}
                          className={cn(
                            "grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 px-3.5 py-2 text-left hover:bg-secondary/60",
                            busy === key && "opacity-60",
                          )}
                        >
                          <span className="flex min-w-0 items-start gap-2">
                            <CompanyLogo ticker={h.ticker} src={u?.logo} size="xs" />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium">{h.ticker}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {h.form}
                              </span>
                            </span>
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground">{h.section}</span>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-px text-[10.5px]",
                                  h.change === "added" && "bg-chart-1/10 text-chart-1",
                                  h.change === "removed" && "bg-negative/10 text-negative",
                                  h.change === "modified" && "bg-secondary",
                                )}
                              >
                                {CHANGE_LABEL[h.change]}
                              </span>
                              {h.signals.slice(0, 3).map((s) => (
                                <span key={s} className="rounded border px-1 py-px text-[10px]">
                                  {s}
                                </span>
                              ))}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-[12px] text-foreground/85">
                              {h.excerpt}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
            Passages are aligned paragraph by paragraph against the prior-year filing, with no AI
            involved. Click a row to open the filing at the passage; removed passages open the
            earlier filing.
          </p>
        </Panel>

        <Panel
          title="Verified filing insights"
          subtitle="Top items per company from the filing-insights loop, ranked by materiality"
          collapse={false}
          bodyClassName="p-0"
        >
          {ins.isLoading ? (
            <Skeleton className="m-3 h-72" />
          ) : !insights.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              No verified insights in this window yet. They are written every two hours, newest
              filings first.
            </p>
          ) : (
            <ul className="divide-y">
              {insights.map((r) => (
                <li key={r.ticker} className="px-3.5 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/app/companies/$ticker"
                      params={{ ticker: r.ticker }}
                      className="text-[12.5px] font-medium hover:underline"
                    >
                      {r.ticker}
                    </Link>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {r.form} filed {fmtDate(r.filed, { month: "short", day: "numeric" })} · {r.n}{" "}
                      items
                    </span>
                  </div>
                  <ol className="mt-1 grid gap-0.5">
                    {r.top.map((i, k) => (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => openInsight(r, i)}
                          className="flex w-full items-start gap-1.5 text-left text-[12px] hover:underline"
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-1.5 shrink-0 rounded-full",
                              i.direction === "positive"
                                ? "bg-positive"
                                : i.direction === "negative"
                                  ? "bg-negative"
                                  : "bg-muted-foreground/50",
                            )}
                            aria-label={i.direction}
                          />
                          <span>{i.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
