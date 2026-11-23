import { ArrowUpRight, Info } from "lucide-react";
import { IrPanel } from "@/components/ir/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCompanyContext } from "@/lib/company/context-query";
import { commonsThumb, type Credit } from "@/lib/company/context";
import { fiscalYearEndLabel, fmtCompact, titleCase } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

/** Photos shown in the strip under the description. */
const PHOTOS = 4;

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

/** The description in full, key facts and a strip of photos. Nothing is cut behind a button. */
export function AboutPanel({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const ctx = useCompanyContext(ticker);
  const p = data.profile;
  const c = ctx.data;
  const paras = c?.description?.paragraphs ?? [];
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
    <IrPanel section="About" title="About" subtitle={c?.description ? "Summary from Wikipedia · facts from SEC EDGAR" : "Facts from SEC EDGAR"} bodyClassName="p-4">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {ctx.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <p className="text-sm font-semibold leading-5 tracking-tight">{p.description}</p>
              <div className="mt-2 space-y-2 text-[13px] leading-5 text-foreground/90">
                {paras.map((t, i) => (
                  <p key={i}>{t}</p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <dl className="grid h-fit grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-secondary/30 px-4 py-3 text-[13px] leading-5">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {!!c?.images.length && <Photos images={c.images} />}
    </IrPanel>
  );
}

function Photos({ images }: { images: NonNullable<ReturnType<typeof useCompanyContext>["data"]>["images"] }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {images.slice(0, PHOTOS).map((m) => (
        <li key={m.url} className="min-w-0">
          <figure className="relative overflow-hidden rounded-md border bg-secondary">
            <img src={commonsThumb(m.url, 500)} alt="" referrerPolicy="no-referrer" loading="lazy" className="aspect-[16/10] w-full object-cover" />
            <CreditNote credit={m.credit} className="absolute right-1 top-1" />
          </figure>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={m.caption}>
            {m.caption}
          </p>
        </li>
      ))}
    </ul>
  );
}
