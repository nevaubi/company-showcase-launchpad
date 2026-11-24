// The company's dated events, newest first: filings, earnings releases, open-market insider trades, ownership and
// contract records, and supply-chain statements. The Overview shows it only when the pipeline's ranked "What
// changed" list is not available for the company, so the two never repeat each other. Every row opens its source.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSource } from "@/components/source/source-context";
import { supabase } from "@/integrations/supabase/client";
import { fmtAlt, readAlt, type AltRow } from "@/lib/alt/query";
import { buildTimeline, type EventKind, type TimelineEvent } from "@/lib/company/catalysts";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<EventKind, string> = {
  earnings: "Earnings",
  annual: "10-K",
  quarterly: "10-Q",
  "8k": "8-K",
  proxy: "Proxy",
  insider_buy: "Insider buy",
  insider_sell: "Insider sale",
  pattern: "Signal",
  alt: "Record",
  intel: "Supply chain",
};
/** Records filed about the company itself. Federal Register notices are left out: they are matched by name and mostly concern other parties. */
const ALT_LABEL: Record<string, string> = { ownership: "Ownership", contracts: "Government contract", fda: "FDA", recalls: "Recall" };
type FilterId = "all" | "filings" | "insiders" | "records";
const FILTERS: { v: FilterId; l: string; kinds: EventKind[] }[] = [
  { v: "all", l: "All", kinds: [] },
  { v: "filings", l: "Filings", kinds: ["earnings", "annual", "quarterly", "8k", "proxy"] },
  { v: "insiders", l: "Insiders", kinds: ["insider_buy", "insider_sell"] },
  { v: "records", l: "Records", kinds: ["alt", "intel"] },
];
/** Rows shown: the list is a summary of recent events, and the Filings tab holds every filing. */
const ROWS = 20;

export function EventsTimeline({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const [filter, setFilter] = useState<FilterId>("all");
  const extra = useQuery({
    queryKey: ["timeline-extra", ticker],
    staleTime: 10 * 60_000,
    queryFn: async ({ client }) => {
      const [alt, sig] = await Promise.all([
        // readAlt screens out rows filed under the wrong company (src/lib/alt/screen.ts)
        readAlt<Pick<AltRow, "ticker" | "dataset" | "kind" | "date" | "title" | "value" | "unit" | "meta" | "source_url">>(
          "ticker,dataset,kind,date,title,value,unit,meta,source_url",
          (q) => q.eq("ticker", ticker).eq("kind", "event").in("dataset", Object.keys(ALT_LABEL)).not("date", "is", null).order("date", { ascending: false }).limit(40),
          client,
        ),
        supabase.from("supply_signals").select("kind,title,detail,impact,filed,accn,doc,url").eq("ticker", ticker).not("filed", "is", null).order("filed", { ascending: false }).limit(30),
      ]);
      return { alt, sig: sig.data ?? [] };
    },
  });

  const events = useMemo(() => {
    const ev: TimelineEvent[] = [];
    for (const r of extra.data?.alt ?? []) ev.push({ date: r.date!, kind: "alt", title: `${ALT_LABEL[r.dataset] ?? r.dataset}: ${r.title}`, detail: r.value != null ? fmtAlt(r.value, r.unit) : undefined, url: r.source_url ?? undefined, tone: r.dataset === "recalls" ? "negative" : "neutral" });
    for (const s of extra.data?.sig ?? [])
      ev.push({ date: s.filed!.slice(0, 10), kind: "intel", title: s.title, detail: s.detail ?? undefined, accn: s.accn ?? undefined, doc: s.doc ?? undefined, url: s.accn ? undefined : (s.url ?? undefined), tone: s.impact === "positive" ? "positive" : s.impact === "negative" ? "negative" : "neutral" });
    for (const r of data.earningsReleases) ev.push({ date: r.filed, kind: "earnings", title: r.title || "Earnings release", accn: r.accn, doc: r.doc });
    for (const f of data.filings) {
      const kind: EventKind | null = f.form === "10-K" ? "annual" : f.form === "10-Q" ? "quarterly" : f.form === "8-K" ? "8k" : f.form === "DEF 14A" ? "proxy" : null;
      if (!kind) continue;
      ev.push({ date: f.filed, kind, title: f.desc || f.form, detail: f.items ? `Items ${f.items}` : f.report ? `Period ${fmtDate(f.report)}` : undefined, accn: f.accn, doc: f.doc });
    }
    // open-market insider trades, one row per filing
    const byAccn = new Map<string, { t: (typeof data.insiders)[number]; usd: number }>();
    for (const t of data.insiders) {
      if (t.code !== "S" && t.code !== "P") continue;
      byAccn.set(t.accn, { t, usd: (byAccn.get(t.accn)?.usd ?? 0) + t.shares * (t.price ?? 0) });
    }
    for (const { t, usd } of byAccn.values()) {
      const buy = t.code === "P";
      ev.push({ date: t.date, kind: buy ? "insider_buy" : "insider_sell", title: `${t.owner} ${buy ? "bought" : "sold"} ${fmtCompactUsd(usd)}`, detail: `${t.role}${t.plan10b5 ? " · 10b5-1 plan" : ""}`, tone: buy ? "positive" : "negative", accn: t.accn, doc: t.doc });
    }
    const kinds = FILTERS.find((f) => f.v === filter)?.kinds ?? [];
    return buildTimeline(kinds.length ? ev.filter((e) => kinds.includes(e.kind)) : ev, ROWS);
  }, [data, filter, extra.data]);

  return (
    <IrPanel
      section="Recent events"
      title="Recent events"
      subtitle={`The ${ROWS} latest: filings, earnings releases, insider trades, ownership and contract records, supply-chain statements · every row opens its source`}
      bodyClassName="p-0"
      actions={
        <>
          <Segmented label="Event kind" size="xs" value={filter} onChange={setFilter} options={FILTERS.map(({ v, l }) => ({ v, l }))} />
          <Button size="xs" variant="ghost" asChild>
            <Link to="/app/companies/$ticker/filings" params={{ ticker }}>
              All filings
            </Link>
          </Button>
        </>
      }
    >
      <ol className="divide-y divide-border/60">
        {events.map((e, i) => {
          const body = (
            <>
              <span className={cn("num w-[4.5rem] shrink-0", IR.caption)}>{fmtDate(e.date)}</span>
              <Badge variant="outline" className="w-[5.75rem] shrink-0 justify-center text-[10px]">
                {KIND_LABEL[e.kind]}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13px] leading-5", e.tone === "positive" && "text-positive", e.tone === "negative" && "text-negative")} title={e.title}>
                  {e.title}
                </span>
                {e.detail && (
                  <span className={cn("block truncate", IR.caption)} title={e.detail}>
                    {e.detail}
                  </span>
                )}
              </span>
              {e.accn && <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            </>
          );
          const row = "flex w-full items-start gap-3 px-4 py-1.5 text-left transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
          return (
            <li key={`${e.kind}-${e.accn ?? e.title}-${e.date}-${i}`}>
              {e.accn ? (
                <button type="button" onClick={() => open({ ticker, label: KIND_LABEL[e.kind], periodLabel: e.date, unit: "usd", value: 0, doc: { accn: e.accn!, doc: e.doc ?? "", title: e.title } })} className={row}>
                  {body}
                </button>
              ) : e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className={row}>
                  {body}
                </a>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
        {events.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">Nothing of this kind on file.</li>}
      </ol>
    </IrPanel>
  );
}
