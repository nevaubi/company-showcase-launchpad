// IR documents as their own group on the Filings tab: releases, presentations, supplements and data
// files stored in `ir_documents`, with type and date, opening the stored copy in the source panel.
// The IR data tab keeps the full library with its parsed tables and full-text search.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSource } from "@/components/source/source-context";
import { Pager, QuietLine } from "@/components/filings/parts";
import { Skeleton } from "@/components/ui/skeleton";
import { collapseDocCopies } from "@/lib/ir/dedupe";
import { libraryTitle } from "@/lib/ir/display";
import { groupByYear, matchesQuery, paginate } from "@/lib/filings/list";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface IrListDoc {
  id: string;
  kind: string;
  title: string;
  period: string | null;
  filed: string | null;
  ext: string | null;
  accn: string | null;
  extract_status: string | null;
  viewable: boolean;
}

/** Stored kinds shown here; images belong to the IR library and SEC copies are already in the filing list. */
export const IR_KIND: Record<string, string> = {
  "press-release": "Release",
  presentation: "Presentation",
  supplement: "Supplement",
  data: "Data file",
  transcript: "Transcript",
  report: "Report",
  "annual-report": "Annual report",
  proxy: "Proxy",
  other: "Exhibit",
};

export function useIrDocs(ticker: string) {
  return useQuery({
    queryKey: ["filings-ir-docs", ticker],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<IrListDoc[]> => {
      const out: IrListDoc[] = [];
      for (let from = 0; from < 10_000; from += 1000) {
        const { data, error } = await supabase
          .from("ir_documents")
          .select("id, kind, title, period, filed, ext, accn, extract_status, rendition_path")
          .eq("ticker", ticker)
          .in("kind", Object.keys(IR_KIND))
          .order("filed", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        for (const d of data ?? []) out.push({ id: d.id, kind: d.kind, title: d.title, period: d.period, filed: d.filed, ext: d.ext, accn: d.accn, extract_status: d.extract_status, viewable: !!d.rendition_path || /^html?$/.test(d.ext ?? "") });
        if (!data || data.length < 1000) break;
      }
      return collapseDocCopies(out).docs;
    },
  });
}

const yearOfDoc = (d: IrListDoc) => d.filed?.slice(0, 4) ?? (/^\d{4}-/.test(d.period ?? "") ? d.period!.slice(0, 4) : (/FY(\d{2})\b/.exec(d.period ?? "")?.[1] ? `20${/FY(\d{2})\b/.exec(d.period!)![1]}` : null));

/** Titles scraped from IR sites carry a site suffix ("… // Middlesex Water") or a storage note in brackets; neither is part of the title. */
export const cleanTitle = (t: string) => t.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+\/\/.*$/, "").trim() || t;

/** Dated documents newest first, undated ones last, scoped by year and words. */
export function scopeIrDocs(docs: IrListDoc[], year: number | null, q: string): (IrListDoc & { title2: string; year: string | null })[] {
  return docs
    .map((d) => ({ ...d, title2: cleanTitle(libraryTitle(d, IR_KIND[d.kind] ?? "Document")), year: yearOfDoc(d) }))
    .filter((d) => (year == null || d.year === String(year)) && (!q.trim() || matchesQuery(`${d.title2} ${IR_KIND[d.kind] ?? ""} ${d.period ?? ""} ${d.filed ?? ""}`.toLowerCase(), q)))
    .sort((a, b) => Number(!a.filed) - Number(!b.filed) || (b.filed ?? "").localeCompare(a.filed ?? "") || (b.year ?? "").localeCompare(a.year ?? "") || a.title2.localeCompare(b.title2));
}

function Icon({ ext, kind }: { ext: string | null; kind: string }) {
  if (/^(xlsx?|xlsm|csv)$/.test(ext ?? "") || kind === "data") return <FileSpreadsheet className="size-3.5 shrink-0 text-muted-foreground" />;
  if (/^pptx?$/.test(ext ?? "") || kind === "presentation") return <Presentation className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
}

const GRID = "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2 sm:gap-x-3 sm:grid-cols-[4rem_5.5rem_minmax(0,1fr)_6.5rem]";

export function IrDocRows({ ticker, docs, loading, error, year, q, page, onPage }: { ticker: string; docs: IrListDoc[]; loading: boolean; error: boolean; year: number | null; q: string; page: number; onPage: (p: number) => void }) {
  const { open } = useSource();
  const scoped = useMemo(() => scopeIrDocs(docs, year, q), [docs, year, q]);
  const p = paginate(scoped, page);
  if (loading) return <Skeleton className="m-3.5 h-40" />;
  if (error) return <QuietLine>Stored IR documents could not be loaded right now.</QuietLine>;
  if (!docs.length) return <QuietLine>No IR documents stored for this company yet.</QuietLine>;
  return (
    <>
      <div role="table" aria-label="IR documents" className="text-[13px]">
        <div role="row" className={cn(GRID, "border-b px-3.5 py-1.5 text-[11px] text-muted-foreground")}>
          <span role="columnheader">Date</span>
          <span role="columnheader" className="hidden sm:block">
            Type
          </span>
          <span role="columnheader">Document</span>
          <span role="columnheader" className="hidden text-right sm:block">
            Period
          </span>
        </div>
        {!p.rows.length && <QuietLine>No IR documents match these filters.</QuietLine>}
        {groupByYear(p.rows).map((g) => (
          <div role="rowgroup" key={g.year}>
            <div role="row" className="border-b bg-secondary/40 px-3.5 py-1">
              <span role="cell" className="eyebrow">
                {g.year === "Undated" ? "Undated (stored from IR sites without a date)" : g.year} · {g.rows.length}
              </span>
            </div>
            {g.rows.map((d) => (
              <div role="row" key={d.id} className={cn(GRID, "group min-h-8 border-b px-3.5 py-1 transition-colors duration-150 last:border-0 hover:bg-secondary/50")}>
                <span role="cell" className="num text-[12px] text-muted-foreground">
                  {d.filed ? fmtDate(d.filed, { month: "short", day: "numeric" }) : "–"}
                </span>
                <span role="cell" className="hidden text-[12px] text-muted-foreground sm:block">
                  {IR_KIND[d.kind] ?? "Document"}
                </span>
                <span role="cell" className="min-w-0">
                  {d.viewable ? (
                    <button
                      type="button"
                      onClick={() => open({ ticker, label: d.title2, unit: "usd", value: 0, doc: { accn: d.accn ?? "", doc: "", filed: d.filed ?? undefined, title: d.title2, irDoc: d.id } })}
                      className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon ext={d.ext} kind={d.kind} />
                      <span className="truncate underline-offset-2 group-hover:underline">{d.title2}</span>
                    </button>
                  ) : (
                    <span className="flex min-w-0 items-center gap-2" title="Stored without a readable copy; download it from IR data">
                      <Icon ext={d.ext} kind={d.kind} />
                      <span className="truncate text-muted-foreground">{d.title2}</span>
                    </span>
                  )}
                </span>
                <span role="cell" className="num hidden truncate text-right text-[12px] text-muted-foreground sm:block">
                  {d.period && !/^\d{4}-\d{2}-\d{2}$/.test(d.period) ? d.period : d.period ? fmtDate(d.period, { month: "short", year: "numeric" }) : "–"}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2">
        <p className="text-[11px] text-muted-foreground">
          Parsed tables, downloads and search inside these documents:{" "}
          <Link to="/app/companies/$ticker/ir" params={{ ticker }} className="text-foreground underline-offset-2 hover:underline">
            IR data
          </Link>
        </p>
        <Pager p={p} onPage={onPage} label="IR document pages" />
      </div>
    </>
  );
}
