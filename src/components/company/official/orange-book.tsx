import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getCompanyPatents } from "@/lib/sources/company/official.functions";
import { lastListed, OB_CAVEAT, obAsks, type CompanyPatents, type ObApplication } from "@/lib/sources/company/orange-book";
import { dayLabel } from "@/lib/sources/company/present";
import type { RecordPointer } from "@/lib/sources/company/types";
import { cn } from "@/lib/utils";
import { ObTimelineView } from "./ob-timeline";
import { DatasetLink, RecordLink } from "./record-link";

/** Exclusivity codes in the FDA's own words (Orange Book legend); a code it does not list is shown bare. */
const EXCLUSIVITY_WORDS: Record<string, string> = {
  NCE: "New chemical entity",
  NP: "New product",
  NPP: "New patient population",
  NS: "New strength",
  NC: "New combination",
  ODE: "Orphan drug exclusivity",
  PED: "Pediatric exclusivity",
  I: "New indication",
  D: "New dosing schedule",
  M: "Miscellaneous",
  GAIN: "Generating Antibiotic Incentives Now",
  CGT: "Competitive generic therapy",
};
const codeWords = (code: string) => EXCLUSIVITY_WORDS[code.split("-")[0]] ?? undefined;
/** Patents an application lists: a number printed with *PED is the same patent with pediatric exclusivity, counted once. */
const patentCount = (a: ObApplication) => new Set(a.patents.filter(p => !p.delisted).map(p => p.patent.replace(/\*PED$/, ""))).size;

/** The query of a company's Orange Book rows, keyed by the applications its FDA panel shows. */
export const companyPatentsQuery = (ticker: string, asks: { appl: string; sponsor: string }[]) => ({
  queryKey: ["company-patents", ticker.toUpperCase(), asks.map(a => `${a.appl}:${a.sponsor}`).join(",")] as const,
  queryFn: () => getCompanyPatents({ data: { ticker, asks } }),
  staleTime: 10 * 60_000,
});

/** A line's stored rows: the link opens the first, the title lists them all. */
function Rows({ refs }: { refs: RecordPointer[] }) {
  const title = `Stored ${refs.length === 1 ? "row" : "rows"} ${refs.map(r => r.row.toLocaleString("en-US")).join(", ")}`;
  return (
    <RecordLink at={refs[0]} title={title} className="text-muted-foreground">
      row {refs[0].row.toLocaleString("en-US")}
      {refs.length > 1 ? ` +${refs.length - 1}` : ""}
    </RecordLink>
  );
}

/**
 * Orange Book patents and exclusivity inside the company's "FDA approvals and recalls" panel: one line per new
 * drug application that has Orange Book rows, and the listed patents and exclusivity of the selected one, all as
 * the FDA prints them. Renders nothing for a company whose panel shows no new drug application.
 */
export function OrangeBook({ ticker, rows }: { ticker: string; rows: { dataset: string; meta?: unknown }[] }) {
  const asks = useMemo(() => obAsks(rows), [rows]);
  const q = useQuery({ ...companyPatentsQuery(ticker, asks), enabled: asks.length > 0 });
  const [selected, setSelected] = useState<string | null>(null);
  if (!asks.length) return null;
  if (q.isPending) {
    return (
      <div data-section="Patents and exclusivity" className="border-t px-3.5 py-2" aria-busy="true">
        <Skeleton className="h-24 rounded-md" />
      </div>
    );
  }
  const result = q.data;
  if (!result || !result.ok) {
    return (
      <p data-section="Patents and exclusivity" className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
        Orange Book patents and exclusivity are not available right now{result && !result.ok ? `: ${result.reason}` : "."}
      </p>
    );
  }
  return <OrangeBookView data={result.data} selected={selected} onSelect={setSelected} />;
}

export function OrangeBookView({ data, selected, onSelect }: { data: CompanyPatents; selected: string | null; onSelect: (appl: string) => void }) {
  const retrieved = dayLabel(data.sources.patents.retrievedAt);
  const notes = (
    <>
      {data.withheld.length > 0 && ` ${data.withheld.length} ${data.withheld.length === 1 ? "application with Orange Book rows is" : "applications with Orange Book rows are"} not shown: ${data.withheld.map(w => w.why).filter((x, i, a) => a.indexOf(x) === i).join(" ")}`}
      {data.partial && " The Orange Book answered with as many rows as one read returns; some rows may be missing."}
    </>
  );
  if (!data.applications.length) {
    return (
      <p data-section="Patents and exclusivity" className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
        The Orange Book lists no patent or exclusivity for the new drug applications on this panel (file retrieved {retrieved}).{notes}
      </p>
    );
  }
  const current = data.applications.find(a => a.appl === selected) ?? data.applications[0];
  return (
    <div id="fda-patents" data-section="Patents and exclusivity" className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] border-t">
      <div className="flex items-baseline justify-between gap-3 px-3.5 pt-2.5">
        <h3 className="text-[13px] font-semibold">Patents and exclusivity</h3>
        <DatasetLink dataset={data.sources.patents.dataset} snapshot={data.sources.patents.snapshot} className="shrink-0 text-[11px] text-muted-foreground">
          Orange Book
        </DatasetLink>
      </div>
      <p className="px-3.5 pb-2 pt-0.5 text-[11px] text-muted-foreground">{OB_CAVEAT}</p>
      <ObTimelineView data={data} />
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[600px] text-[13px]">
          <thead>
            <tr className="h-7 border-y text-left text-[11px] text-muted-foreground">
              <th className="pl-3.5 font-normal">Product, as the Orange Book names it</th>
              <th className="font-normal">Application</th>
              <th className="text-right font-normal">Patents listed</th>
              <th className="pl-3 font-normal">Last listed expiry</th>
              <th className="pr-3.5 font-normal">Exclusivity to</th>
            </tr>
          </thead>
          <tbody>
            {data.applications.map(a => {
              const on = a.appl === current.appl;
              const last = lastListed(a);
              return (
                <tr key={a.appl} className={cn("h-7 border-b last:border-0", on && "bg-secondary/60")}>
                  <td className="py-1 pl-3.5 pr-2">
                    <button type="button" aria-pressed={on} onClick={() => onSelect(a.appl)} className={cn("min-h-6 rounded-[3px] text-left transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "font-medium")}>
                      {a.trade.join(", ")}
                    </button>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{a.ingredient.join(", ").toLowerCase()}</span>
                  </td>
                  <td className="num whitespace-nowrap py-1 pr-2 text-[11px] text-muted-foreground">NDA {a.appl}</td>
                  <td className="num py-1 text-right">{patentCount(a)}</td>
                  <td className="num whitespace-nowrap py-1 pl-3 text-[11px]">{last.patent ? last.patent.expiry : <span className="text-muted-foreground">{"–"}</span>}</td>
                  <td className="num whitespace-nowrap py-1 pr-3.5 text-[11px]">
                    {last.exclusivity ? (
                      <span title={codeWords(last.exclusivity.code)}>
                        {last.exclusivity.date} <span className="text-muted-foreground">{last.exclusivity.code}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{"–"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ApplicationDetail app={current} />
      <p className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
        Dates as the FDA prints them; a patent number ending in *PED carries pediatric exclusivity. Orange Book files retrieved {retrieved}.{notes}
      </p>
    </div>
  );
}

function ApplicationDetail({ app }: { app: ObApplication }) {
  return (
    <div data-section="Listed patents" className="min-w-0 border-t">
      <div className="flex flex-wrap items-baseline gap-x-2 px-3.5 py-1.5 text-[11px] text-muted-foreground">
        <span className="text-[13px] font-medium text-foreground">{app.trade.join(", ")}</span>
        <span>NDA {app.appl}</span>
        <span title={app.applicantFull.join("; ") || undefined}>applicant {app.applicant}</span>
        <span>
          {app.products.length} {app.products.length === 1 ? "product" : "products"}: {app.products.map(p => p.strength).join(", ")}
        </span>
      </div>
      {app.patents.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="h-7 border-y text-left text-[11px] text-muted-foreground">
                <th className="pl-3.5 font-normal">Patent</th>
                <th className="font-normal">Expires, as listed</th>
                <th className="font-normal">Claims</th>
                <th className="font-normal">Use codes</th>
                <th className="font-normal">Products</th>
                <th className="pr-3.5 text-right font-normal">Stored record</th>
              </tr>
            </thead>
            <tbody>
              {app.patents.map(p => (
                <tr key={`${p.patent}|${p.expiry}|${p.substance}|${p.drugProduct}|${p.delisted}`} className="h-7 border-b last:border-0">
                  <td className="num whitespace-nowrap py-1 pl-3.5 pr-2">{p.patent}</td>
                  <td className="num whitespace-nowrap py-1 pr-2">
                    {p.expiry || <span className="text-muted-foreground">{"–"}</span>}
                    {p.delisted && <span className="ml-1.5 text-[11px] text-muted-foreground">delisting requested</span>}
                  </td>
                  <td className="py-1 pr-2 text-[11px] text-muted-foreground">{[p.substance && "drug substance", p.drugProduct && "drug product"].filter(Boolean).join(", ") || "–"}</td>
                  <td className="py-1 pr-2 text-[11px] text-muted-foreground">{p.useCodes.join(", ") || "–"}</td>
                  <td className="num whitespace-nowrap py-1 pr-2 text-[11px] text-muted-foreground">{p.products.join(", ")}</td>
                  <td className="whitespace-nowrap py-1 pr-3.5 text-right text-[11px]">
                    <Rows refs={p.refs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {app.exclusivity.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="h-7 border-y text-left text-[11px] text-muted-foreground">
                <th className="pl-3.5 font-normal">Exclusivity</th>
                <th className="font-normal">Until, as listed</th>
                <th className="font-normal">Products</th>
                <th className="pr-3.5 text-right font-normal">Stored record</th>
              </tr>
            </thead>
            <tbody>
              {app.exclusivity.map(e => (
                <tr key={`${e.code}|${e.date}`} className="h-7 border-b last:border-0">
                  <td className="py-1 pl-3.5 pr-2">
                    <span className="num">{e.code}</span>
                    {codeWords(e.code) && <span className="ml-1.5 text-[11px] text-muted-foreground">{codeWords(e.code)}</span>}
                  </td>
                  <td className="num whitespace-nowrap py-1 pr-2">{e.date}</td>
                  <td className="num whitespace-nowrap py-1 pr-2 text-[11px] text-muted-foreground">{e.products.join(", ")}</td>
                  <td className="whitespace-nowrap py-1 pr-3.5 text-right text-[11px]">
                    <Rows refs={e.refs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
