// Key relationships on the Overview: the customers and suppliers that filings name, with the share a filing states
// and whose total it is a share of, sole-source wording, and the concentration the company tags in its own report.
// Rows come through the supply-chain reader (verified against their own sentence) and open that sentence.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CompanyLogo } from "@/components/app/company-logo";
import { TickerMark } from "@/components/app/ticker";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { externalLogo } from "@/components/supply/supply-map-meta";
import { supabase } from "@/integrations/supabase/client";
import { keyRelationships, shareOfWords, taggedConcentration, type Relationship, type TaggedConcentration } from "@/lib/company/relationships";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import type { RiskLink } from "@/lib/supply/core";
import { dedupeCurrent } from "@/lib/supply/identity";
import { pageSupplyLinks } from "@/lib/supply/read";
import { cn } from "@/lib/utils";

const nameOf = (t: string) => coverageOf(t)?.shortName ?? t;
const sharePct = (pct: number) => `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;

/** Links this company states and links other covered companies state about it, as the supply-chain page reads them. */
const focusLinksQuery = (ticker: string) => ({
  queryKey: ["supply-links", "focus", ticker],
  staleTime: 10 * 60_000,
  retry: 1,
  queryFn: async (): Promise<RiskLink[]> => {
    const [own, named] = await Promise.all([
      pageSupplyLinks<RiskLink>(supabase, "*", (q) => q.eq("is_current", true).eq("ticker", ticker).order("id")),
      pageSupplyLinks<RiskLink>(supabase, "*", (q) => q.eq("is_current", true).eq("counterparty_ticker", ticker).order("id")),
    ]);
    const seen = new Set<string>();
    return dedupeCurrent([...own, ...named].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))) as RiskLink[];
  },
});

const ownConcentrationQuery = (ticker: string) => ({
  queryKey: ["xbrl_concentration", "own", ticker],
  staleTime: 6 * 3_600_000,
  retry: 1,
  queryFn: async () => {
    const { data, error } = await supabase.from("xbrl_concentration").select("label, pct, kind, benchmark, benchmark_label, form, period_end, accn, element_id").eq("ticker", ticker).order("period_end", { ascending: false }).limit(80);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});

function Side({ ticker, title, rows, total, empty }: { ticker: string; title: string; rows: Relationship[]; total: number; empty: string }) {
  const { open } = useSource();
  return (
    <div className="min-w-0">
      <p className={cn("flex items-baseline justify-between px-4 pb-1 pt-3", IR.group)}>
        {title}
        <span className={cn("font-normal", IR.caption)}>{total > rows.length ? `${rows.length} of ${total} named` : total ? `${total} named` : ""}</span>
      </p>
      {rows.length === 0 ? (
        <p className={cn("px-4 pb-3", IR.caption)}>{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {rows.map((r) => {
            const s = r.source;
            return (
              <li key={r.key} className="flex items-start gap-2 px-4 py-1.5 text-[13px] leading-5">
                <span className="min-w-0 flex-1">
                  {r.ticker && coverageOf(r.ticker) ? (
                    <TickerMark ticker={r.ticker} name nameFirst />
                  ) : (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle">
                      <CompanyLogo ticker={r.ticker ?? r.name.slice(0, 4).toUpperCase()} src={externalLogo(r.domain, r.ticker)} size="xs" decorative />
                      <span className="truncate font-medium">{r.name}</span>
                    </span>
                  )}
                  {r.singleSource && (
                    <Badge variant="outline" className="ml-1.5 align-middle text-[10px]" title="The filing sentence says sole, single or only source">
                      sole source
                    </Badge>
                  )}
                  {r.summary && (
                    <span className={cn("block truncate", IR.caption)} title={r.summary}>
                      {r.summary}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => open({ ticker: s.ticker, label: `${nameOf(s.ticker)} on ${r.name}`, periodLabel: s.filed, unit: "pct", value: r.share?.pct ?? 0, doc: { accn: s.accn, doc: s.doc, form: s.form, filed: s.filed, title: `${s.ticker} ${s.form}`, search: s.quote } })}
                  title={`Open the sentence in ${s.ticker}'s ${s.form} filed ${fmtDate(s.filed)}`}
                  className="shrink-0 rounded-sm px-1 text-right transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {r.share ? <span className="num block font-medium">{sharePct(r.share.pct)}</span> : <span className="block text-muted-foreground">named</span>}
                  <span className={cn("block", IR.caption)}>
                    {r.share ? shareOfWords(r.share, nameOf) : `in ${s.ticker === ticker ? "its own" : `${nameOf(s.ticker)}'s`} ${s.form}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Tagged({ ticker, rows }: { ticker: string; rows: TaggedConcentration[] }) {
  const { open } = useSource();
  if (!rows.length) return null;
  // "revenue" as the filing's own caption words it is often "Sales revenue net": say revenue; other totals keep the caption
  const basis = (r: TaggedConcentration) => (r.benchmark === "revenue" ? "revenue" : (r.benchmarkLabel?.toLowerCase() ?? r.benchmark));
  return (
    <div className="border-t px-4 py-3" data-section="Stated concentration">
      <p className={IR.group}>Concentration the company states</p>
      <p className={IR.caption}>
        Shares tagged in the {rows[0].form} for the period to {fmtDate(rows[0].periodEnd)}. A report may name these parties only as "Customer A".
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] leading-5">
        {rows.map((r) => (
          <li key={`${r.label}-${r.benchmark}-${r.kind}`}>
            {r.label}{" "}
            <button
              type="button"
              onClick={() => open({ ticker, label: `${r.label}, share of ${basis(r)}`, periodLabel: fmtDate(r.periodEnd), unit: "pct", value: r.pct, src: { accn: r.accn, concept: "us-gaap:ConcentrationRiskPercentage1", end: r.periodEnd, value: r.pct }, elementId: r.elementId ?? undefined })}
              title="Open the tagged figure in the filing"
              className="num rounded-sm px-1 font-medium transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sharePct(r.pct * 100)}
            </button>{" "}
            <span className={IR.caption}>of {basis(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KeyRelationshipsPanel({ ticker }: { ticker: string }) {
  const links = useQuery(focusLinksQuery(ticker));
  const own = useQuery(ownConcentrationQuery(ticker));
  const rel = useMemo(() => {
    const rows = links.data ?? [];
    const names: Record<string, string> = {};
    for (const l of rows) for (const t of [l.ticker, l.counterparty_ticker]) if (t && !names[t]) names[t] = nameOf(t);
    return keyRelationships(ticker, rows, names);
  }, [links.data, ticker]);
  const tagged = useMemo(() => taggedConcentration(own.data ?? []), [own.data]);
  const none = !links.isLoading && rel.totals.customers + rel.totals.suppliers === 0;
  const others = [rel.totals.partners ? `${rel.totals.partners} partner${rel.totals.partners === 1 ? "" : "s"}` : null, rel.totals.competitors ? `${rel.totals.competitors} competitor${rel.totals.competitors === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
  return (
    <IrPanel
      section="Key relationships"
      title="Key relationships"
      subtitle={`Customers and suppliers named in current 10-K and 10-Q filings, largest stated share first · each row opens its sentence${others ? ` · ${others} also named` : ""}`}
      bodyClassName="p-0"
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/supply-chain" search={{ t: ticker }}>
            Supply chain map
          </Link>
        </Button>
      }
    >
      {links.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      ) : links.isError ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">The filing links could not be read just now.</p>
      ) : none ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">No current filing names a customer or supplier of {nameOf(ticker)} that could be verified against its sentence.</p>
      ) : (
        <div className="grid grid-cols-1 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <Side ticker={ticker} title="Suppliers" rows={rel.suppliers} total={rel.totals.suppliers} empty="No supplier is named." />
          <Side ticker={ticker} title="Customers" rows={rel.customers} total={rel.totals.customers} empty="No customer is named." />
        </div>
      )}
      <Tagged ticker={ticker} rows={tagged} />
    </IrPanel>
  );
}
