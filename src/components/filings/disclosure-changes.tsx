// The feed's second view: the largest disclosure changes in recent 10-K and 10-Q filings against the
// prior-year filing (partner redline index) and the top verified filing insights per company.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/app/page-header";
import { TickerMark } from "@/components/app/ticker";
import { QuietLine } from "@/components/filings/parts";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { filterHighlights, insightIndexQuery, redlineDoc, redlineIndexQuery, resolveDoc, searchPhrase, type InsightIndexRow, type RedlineHighlight } from "@/lib/filings/feed";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANGE_LABEL: Record<RedlineHighlight["change"], string> = { added: "new text", removed: "removed", modified: "reworded" };

export interface ChangeScope {
  form: "all" | "10-K" | "10-Q";
  sector: string;
  watch: boolean;
  q: string;
  days: number;
  /** A signal word ("all" for any), as the old feed's Signal select offered. */
  signal: string;
}

export function DisclosureChanges({ scope, sectorOf, watched }: { scope: ChangeScope; sectorOf: (t: string) => string | undefined; watched: Set<string> }) {
  const idx = useQuery(redlineIndexQuery);
  const ins = useQuery(insightIndexQuery);
  const { open } = useSource();
  const [busy, setBusy] = useState<string | null>(null);
  const since = useMemo(() => new Date(Date.now() - scope.days * 864e5).toISOString().slice(0, 10), [scope.days]);
  const q = scope.q.trim().toLowerCase();
  const keep = (t: string, form: string, filed: string, words: string) =>
    filed >= since && (scope.form === "all" || form === scope.form) && (scope.sector === "all" || sectorOf(t) === scope.sector) && (!scope.watch || watched.has(t)) && (!q || t.toLowerCase() === q || words.toLowerCase().includes(q));
  const rows = useMemo(
    () => filterHighlights(idx.data?.recent ?? [], { form: scope.form, sector: scope.sector, signal: scope.signal, days: scope.days, q: scope.q }, sectorOf, new Date().toISOString().slice(0, 10)).filter((h) => !scope.watch || watched.has(h.ticker)),
    [idx.data, scope, sectorOf, watched],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, RedlineHighlight[]>();
    for (const r of rows) m.set(r.filed, [...(m.get(r.filed) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const insights = useMemo(
    () => Object.values(ins.data?.companies ?? {}).filter((r) => r.top.length > 0 && keep(r.ticker, r.form, r.filed, `${r.name ?? ""} ${r.top.map((t) => t.title).join(" ")}`)).sort((a, b) => b.filed.localeCompare(a.filed) || (b.top[0]?.score ?? 0) - (a.top[0]?.score ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ins.data, scope, since],
  );

  const openHighlight = async (h: RedlineHighlight) => {
    const key = `${h.ticker}${h.section_id}${h.score}`;
    setBusy(key);
    try {
      const d = resolveDoc(h, h.accn ? null : await redlineDoc(h.ticker).catch(() => null));
      if (!d) return;
      open({ ticker: h.ticker, label: `${h.section}: ${CHANGE_LABEL[h.change]}`, periodLabel: `${h.form} filed ${h.filed}`, unit: "count", value: h.score, doc: { accn: d.accn, doc: d.doc, form: h.form, filed: d.filed, title: `${h.form} filed ${fmtDate(d.filed)}${h.change === "removed" ? " (the prior-year filing; this passage was dropped)" : ""}`, search: h.search ?? searchPhrase(h.excerpt) } });
    } finally {
      setBusy(null);
    }
  };
  const openInsight = (r: InsightIndexRow, i: InsightIndexRow["top"][number]) =>
    open({ ticker: r.ticker, label: i.title, periodLabel: `${r.form} filed ${r.filed}`, unit: "count", value: i.score, doc: { accn: r.accn, doc: r.doc, form: r.form, filed: r.filed, title: `${r.form} filed ${fmtDate(r.filed)}`, search: searchPhrase(i.quote) } });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div data-section="Largest disclosure changes" className="min-w-0">
        <Panel
          collapse={false}
          bodyClassName="p-0"
          title="Largest disclosure changes"
          subtitle={idx.data ? `${rows.length} passages · against the same filing a year earlier · index updated ${fmtRelative(idx.data.generated)}` : "Against the same filing a year earlier"}
        >
          {idx.isLoading ? (
            <Skeleton className="m-3.5 h-72" />
          ) : idx.isError ? (
            <QuietLine>The redline index is not available right now.</QuietLine>
          ) : !byDay.length ? (
            <QuietLine>No changed passages match these filters.</QuietLine>
          ) : (
            byDay.map(([day, xs]) => (
              <div key={day} role="rowgroup">
                <p className="border-b bg-secondary/40 px-3.5 py-1">
                  <span className="eyebrow">
                    {fmtDate(day, { weekday: "short", month: "short", day: "numeric" })} · {xs.length}
                  </span>
                </p>
                <ul className="divide-y">
                  {xs.map((h, n) => {
                    const key = `${h.ticker}${h.section_id}${h.score}`;
                    return (
                      <li key={`${key}-${n}`} className={cn("grid grid-cols-1 gap-1 px-3.5 py-2 transition-colors duration-150 hover:bg-secondary/50 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3", busy === key && "opacity-60")}>
                        <span className="flex min-w-0 items-center gap-2">
                          <TickerMark ticker={h.ticker} size="xs" className="min-h-7" />
                          <span className="text-[11px] text-muted-foreground">{h.form}</span>
                        </span>
                        <button type="button" onClick={() => void openHighlight(h)} className="min-h-7 min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">{h.section}</span>
                            <span className={cn("rounded px-1.5 py-px", h.change === "added" && "bg-positive/10 text-positive", h.change === "removed" && "bg-negative/10 text-negative", h.change === "modified" && "bg-secondary")}>{CHANGE_LABEL[h.change]}</span>
                            {h.signals.slice(0, 3).map((s) => (
                              <span key={s} className="rounded border px-1 py-px">
                                {s}
                              </span>
                            ))}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[13px] text-foreground/85">{h.excerpt}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">Passages are aligned paragraph by paragraph against the prior-year filing, with no AI involved. Click a passage to open the filing there; removed passages open the earlier filing.</p>
        </Panel>
      </div>

      <div data-section="Verified filing insights" className="min-w-0">
        <Panel collapse={false} bodyClassName="p-0" title="Verified filing insights" subtitle="Top items per company from the filing-insights loop, ranked by materiality">
          {ins.isLoading ? (
            <Skeleton className="m-3.5 h-60" />
          ) : !insights.length ? (
            <QuietLine>No verified insights in this window. They are written every two hours, newest filings first.</QuietLine>
          ) : (
            <ul className="divide-y">
              {insights.map((r) => (
                <li key={r.ticker} className="px-3.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TickerMark ticker={r.ticker} size="xs" className="min-h-7" />
                    <span className="truncate text-[11px] text-muted-foreground">
                      {r.form} filed {fmtDate(r.filed, { month: "short", day: "numeric" })} · {r.n} items
                    </span>
                  </div>
                  <ol className="mt-1 grid gap-0.5">
                    {r.top.map((i, k) => (
                      <li key={k}>
                        <button type="button" onClick={() => openInsight(r, i)} className="flex w-full items-start gap-1.5 rounded-sm text-left text-[13px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", i.direction === "positive" ? "bg-positive" : i.direction === "negative" ? "bg-negative" : "bg-muted-foreground/50")} aria-label={i.direction} />
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
