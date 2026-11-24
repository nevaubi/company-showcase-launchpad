import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCompanyContext } from "@/lib/company/context-query";
import { commonsThumb, type Credit } from "@/lib/company/context";
import { fiscalYearEndLabel, fmtCompact, titleCase } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export function CreditNote({ credit, className }: { credit: Credit; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label="Photo credit" className={cn("grid size-5 place-items-center rounded-full bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground", className)}>
          <Info className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-[12px]" side="top">
        <p className="font-medium">{credit.kind === "wikimedia" ? "Free-licensed photo" : "Company photo"}</p>
        <p className="mt-1 text-muted-foreground">
          {credit.kind === "wikimedia"
            ? `${credit.author ? `By ${credit.author}. ` : ""}${credit.license ?? "Free licence"}, via Wikimedia Commons.`
            : "From the company's own leadership page."}
        </p>
        <a href={credit.page} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11.5px] underline">
          View original <ArrowUpRight className="size-3" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

/** Readable description, key facts and a photo strip. */
export function AboutPanel({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const ctx = useCompanyContext(ticker);
  const [more, setMore] = useState(false);
  const p = data.profile;
  const c = ctx.data;
  const paras = c?.description?.paragraphs ?? [];
  const shown = more ? paras : paras.slice(0, 2);
  const facts: [string, React.ReactNode][] = [
    ["Sector", p.sector],
    ["Industry", p.industry],
    ["Founded", p.founded],
    ...(c?.facts.founders?.length ? ([["Founders", c.facts.founders.join(", ")]] as [string, string][]) : []),
    ["Headquarters", `${titleCase(p.address.city)}, ${p.address.state}`],
    ...(c?.facts.employees ? ([["Employees", `${fmtCompact(c.facts.employees.value, 0)}${c.facts.employees.asOf ? ` (${c.facts.employees.asOf.slice(0, 4)})` : ""}`]] as [string, string][]) : []),
    ...(p.ceo ? ([["Chief executive", p.ceo]] as [string, string][]) : []),
    ["Fiscal year ends", fiscalYearEndLabel(p.fiscalYearEnd)],
    ["Incorporated", p.stateOfIncorporation],
    ["Exchange", `${p.exchange}: ${ticker}`],
    ["SIC", `${p.sic} · ${titleCase(p.sicDescription)}`],
    ["CIK", <span className="num text-xs">{p.cik}</span>],
  ];

  return (
    <Panel title="About" subtitle={c?.description ? "Summary from Wikipedia · facts from SEC EDGAR" : "SEC EDGAR"}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {ctx.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <p className="font-display text-xl leading-snug">{p.description}</p>
              <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-foreground/85">
                {shown.map((t, i) => (
                  <p key={i}>{t}</p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {paras.length > 2 && (
                  <Button size="xs" variant="ghost" onClick={() => setMore((m) => !m)}>
                    {more ? "Show less" : "Read more"}
                  </Button>
                )}
                {c?.description && (
                  <a href={c.description.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    Wikipedia <ArrowUpRight className="size-3" />
                  </a>
                )}
                <Button size="xs" variant="outline" asChild>
                  <a href={p.website} target="_blank" rel="noreferrer">Website <ArrowUpRight /></a>
                </Button>
                <Button size="xs" variant="outline" asChild>
                  <a href={p.investorRelations} target="_blank" rel="noreferrer">Investor relations <ArrowUpRight /></a>
                </Button>
              </div>
            </>
          )}
        </div>
        <dl className="grid h-fit grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-secondary/30 p-4 text-[12.5px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {!!c?.images.length && <Gallery images={c.images} />}
    </Panel>
  );
}

function Gallery({ images }: { images: NonNullable<ReturnType<typeof useCompanyContext>["data"]>["images"] }) {
  const [i, setI] = useState(0);
  const img = images[i];
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <figure className="relative aspect-[16/9] overflow-hidden rounded-lg border bg-secondary md:aspect-auto md:min-h-[340px]">
        <img src={commonsThumb(img.url, 1280)} alt={img.caption} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        <figcaption className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-background/95 to-transparent p-3 pt-10 text-[12px]">
          <span className="line-clamp-2 flex-1">{img.caption}</span>
          <CreditNote credit={img.credit} />
        </figcaption>
        {images.length > 1 && (
          <>
            <button aria-label="Previous photo" onClick={() => setI((i - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-background/80 backdrop-blur">
              <ChevronLeft className="size-4" />
            </button>
            <button aria-label="Next photo" onClick={() => setI((i + 1) % images.length)} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-background/80 backdrop-blur">
              <ChevronRight className="size-4" />
            </button>
          </>
        )}
      </figure>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-2 md:content-start">
        {images.slice(0, 8).map((m, k) => (
          <button key={m.url} onClick={() => setI(k)} className={cn("overflow-hidden rounded-md border", k === i ? "ring-2 ring-foreground" : "opacity-75 hover:opacity-100")}>
            <img src={commonsThumb(m.url, 500)} alt="" referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
