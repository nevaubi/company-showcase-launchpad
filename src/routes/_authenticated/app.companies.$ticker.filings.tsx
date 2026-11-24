import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2, Search, X } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CommentLetters } from "@/components/filings/comment-letters";
import { FilingRows, KeyDocStrip } from "@/components/filings/company-filings";
import { IrDocRows, scopeIrDocs, useIrDocs } from "@/components/filings/ir-docs";
import { FormChip, Pager, QuietLine } from "@/components/filings/parts";
import { useSearchText } from "@/components/filings/use-search-text";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { searchFilings } from "@/lib/sec.functions";
import { commentsQuery } from "@/lib/filings/review";
import { FAMILIES } from "@/lib/filings/kinds";
import { countByFamily, dedupeFilings, insiderFilings, latestKeyDocs, LIST_KINDS, paginate, scopeFilings, yearsOf, type ListKind } from "@/lib/filings/list";
import { fmtDate } from "@/lib/format";

const searchSchema = z.object({
  kind: z.enum(LIST_KINDS as [ListKind, ...ListKind[]]).optional(),
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/filings")({
  validateSearch: searchSchema,
  head: ({ params }) => ({ meta: [
    { title: `${params.ticker.toUpperCase()} Filings and IR documents · FiledUnder` },
    { name: "description", content: `Latest annual, quarterly, earnings and proxy documents, every SEC filing grouped by kind, and stored IR documents. Company: ${params.ticker.toUpperCase()}.` },
    { property: "og:title", content: `${params.ticker.toUpperCase()} Filings and IR documents · FiledUnder` },
    { property: "og:description", content: "SEC filings grouped by kind, with the latest key documents and stored IR documents." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Filings,
});

function Filings() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const ir = useIrDocs(ticker);
  const letters = useQuery(commentsQuery(ticker));
  const kind: ListKind = search.kind ?? "key";
  const year = search.year ?? null;
  const page = search.page ?? 1;
  // The words box types into local state; the address follows a moment later so typing stays smooth.
  const set = (s: Partial<z.infer<typeof searchSchema>>, keepPage = false) =>
    navigate({ search: (prev) => ({ ...prev, ...(keepPage ? {} : { page: undefined }), ...s }), replace: true, resetScroll: false });
  const [text, setText] = useSearchText(search.q, (q) => set({ q }));

  const rows = useMemo(() => dedupeFilings([...(company.data?.filings ?? []), ...insiderFilings(company.data?.insiders ?? [])]), [company.data]);
  const counts = useMemo(() => countByFamily(rows), [rows]);
  const years = useMemo(() => yearsOf([...rows, ...(ir.data ?? []).filter((d): d is typeof d & { filed: string } => !!d.filed)]), [rows, ir.data]);
  const keys = useMemo(() => latestKeyDocs(rows, company.data?.earningsReleases ?? []), [rows, company.data]);
  const releases = useMemo(() => new Map((company.data?.earningsReleases ?? []).map((r) => [r.accn, r])), [company.data]);
  const scoped = useMemo(() => scopeFilings(rows, { kind, year, q: search.q ?? "" }), [rows, kind, year, search.q]);
  const irCount = useMemo(() => (ir.data ? scopeIrDocs(ir.data, null, "").length : null), [ir.data]);
  const letterCount = letters.data?.n_threads ?? letters.data?.threads.length ?? 0;

  if (!company.data) return <Skeleton className="h-[600px]" />;
  const cik = String(Number(company.data.profile.cik));
  const p = paginate(scoped, page);
  const filtered = year != null || !!search.q;
  const kindOptions = [
    { v: "key" as ListKind, l: `Key filings · ${(rows.length - counts.ownership).toLocaleString()}`, title: "Every SEC filing except insider and holder forms" },
    { v: "all" as ListKind, l: `All · ${rows.length.toLocaleString()}` },
    ...FAMILIES.filter((f) => f.id !== "correspondence" && counts[f.id] > 0).map((f) => ({ v: f.id as ListKind, l: `${f.short} · ${counts[f.id].toLocaleString()}`, title: f.note })),
    ...(letterCount || counts.correspondence ? [{ v: "correspondence" as ListKind, l: `SEC letters · ${letterCount || counts.correspondence}`, title: "SEC staff comment letters and company responses" }] : []),
    { v: "ir" as ListKind, l: `IR documents${irCount != null ? ` · ${irCount.toLocaleString()}` : ""}`, title: "Releases, presentations, supplements and data files stored from EDGAR exhibits and the company's IR site" },
  ];
  const family = FAMILIES.find((f) => f.id === kind);
  const scopeLabel = kind === "key" ? "Key filings (all but insider and holder forms)" : kind === "all" ? "All SEC filings" : kind === "ir" ? "IR documents" : (family?.label ?? "Filings");

  return (
    <div className="grid grid-cols-1 gap-4">
      <KeyDocStrip ticker={ticker} cik={cik} keys={keys} rows={rows} />

      <div data-section="Filing list" className="min-w-0">
        <Panel
          collapse={false}
          bodyClassName="p-0"
          title="Filings and IR documents"
          subtitle={`${scopeLabel}${year ? ` · ${year}` : ""}${search.q ? ` · matching “${search.q}”` : ""} · newest first · click a row to read it in the source panel`}
        >
          <div className="grid grid-cols-1 gap-2 border-b px-3.5 py-2">
            <Segmented label="Filing kind" size="xs" value={kind} onChange={(v) => set({ kind: v === "key" ? undefined : v })} options={kindOptions} />
            {kind !== "correspondence" && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={year == null ? "all" : String(year)} onValueChange={(v) => set({ year: v === "all" ? undefined : Number(v) })}>
                  <SelectTrigger aria-label="Year" className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All years
                    </SelectItem>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)} className="text-xs">
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative min-w-0 flex-1 sm:max-w-72">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter, e.g. earnings 2025 or officer" aria-label="Filter filings by words" className="h-7 pl-7 text-xs" />
                </div>
                {filtered && (
                  <button type="button" onClick={() => (setText(""), set({ year: undefined, q: undefined }))} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
                    <X className="size-3.5" /> Clear
                  </button>
                )}
                {kind !== "ir" && <Pager p={p} onPage={(n) => set({ page: n }, true)} label="Filing pages, top" className="ml-auto" />}
              </div>
            )}
          </div>

          {kind === "correspondence" ? (
            <CommentLetters ticker={ticker} embedded />
          ) : kind === "ir" ? (
            <IrDocRows ticker={ticker} docs={ir.data ?? []} loading={ir.isLoading} error={ir.isError} year={year} q={search.q ?? ""} page={page} onPage={(n) => set({ page: n }, true)} />
          ) : (
            <>
              {kind === "ownership" && (
                <QuietLine className="border-b">
                  Form 4s come from the insider trade record; Forms 3, 144, 13D and 13G are listed for the last 60 days. Trade sizes, prices and holdings are on{" "}
                  <Link to="/app/companies/$ticker/insiders" params={{ ticker }} className="text-foreground underline-offset-2 hover:underline">
                    Insiders &amp; influence
                  </Link>
                  .
                </QuietLine>
              )}
              {p.rows.length ? <FilingRows ticker={ticker} cik={cik} rows={p.rows} all={rows} releases={releases} /> : <QuietLine>No filings match these filters.</QuietLine>}
              {p.pages > 1 && (
                <div className="flex justify-end border-t px-3.5 py-2">
                  <Pager p={p} onPage={(n) => set({ page: n }, true)} label="Filing pages, bottom" />
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <FullTextSearch ticker={ticker} cik={cik} />
    </div>
  );
}

/** EDGAR full-text search inside this company's documents (words in the filing text, not the list above). */
function FullTextSearch({ ticker, cik }: { ticker: string; cik: string }) {
  const { open } = useSource();
  const [q, setQ] = useState("");
  const fts = useMutation({ mutationFn: (query: string) => searchFilings({ data: { q: query, ciks: [cik] } }) });
  return (
    <div data-section="Search inside filings" className="min-w-0">
      <Panel collapse={false} title="Search inside filings" subtitle="EDGAR full-text search across this company's filings and exhibits since 2001">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length > 1) fts.mutate(q.trim());
          }}
          className="flex max-w-xl gap-2"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. "supply constraints" or tariffs' aria-label="Words to find inside filings" className="h-8 text-[13px]" />
          <Button type="submit" size="sm" disabled={fts.isPending} aria-label="Search">
            {fts.isPending ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </form>
        {fts.isError && <p className="mt-2 text-[12px] text-negative">{(fts.error as Error).message}</p>}
        {fts.data && (
          <div className="mt-3">
            <p className="text-[11px] text-muted-foreground">{fts.data.total.toLocaleString()} matching documents{fts.data.total > fts.data.hits.length ? ` · first ${fts.data.hits.length} shown` : ""}</p>
            <ul className="mt-1 divide-y border-y">
              {fts.data.hits.map((h) => (
                <li key={`${h.accn}-${h.doc}`}>
                  <button
                    type="button"
                    onClick={() => open({ ticker, label: `Search: ${q}`, periodLabel: fmtDate(h.filed), unit: "usd", value: 0, doc: { accn: h.accn, doc: h.doc, title: `${h.form} · ${h.description ?? h.doc}`, search: q.replace(/^"|"$/g, "") } })}
                    className="grid min-h-8 w-full grid-cols-[6rem_5.5rem_minmax(0,1fr)] items-center gap-3 px-1 text-left text-[13px] transition-colors duration-150 hover:bg-secondary/50"
                  >
                    <span className="num text-[12px] text-muted-foreground">{fmtDate(h.filed)}</span>
                    <FormChip form={h.form} />
                    <span className="truncate">{h.description ?? h.doc}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
