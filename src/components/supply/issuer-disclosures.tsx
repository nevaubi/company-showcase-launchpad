import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Factory } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import { quoteLink } from "@/lib/supply/counterparty";
import { disclosureStages, programWatch, type Disclosure } from "@/lib/supply/disclosures";
import { disclosureQuery } from "@/lib/supply/query";

function Release({ row }: { row: Disclosure }) {
  return <a href={quoteLink(row.source_url, row.source_phrase)} target="_blank" rel="noopener noreferrer"
    aria-label={`${row.publisher} source on ${fmtDate(row.source_date)} about ${row.product} (opens in new tab)`}
    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
    {row.publisher} <ExternalLink className="size-3" aria-hidden="true" />
  </a>;
}

function Party({ id, name, focus, onPick }: { id: string; name: string; focus: string; onPick: (ticker: string) => void }) {
  const covered = coverageOf(id);
  const content = <>{!id.startsWith("@") ? <CompanyLogo ticker={id} size="xs" decorative /> : <Factory className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    <span className="min-w-0 break-words font-medium">{name}</span></>;
  return covered && id !== focus
    ? <button type="button" onClick={() => onPick(id)} className="inline-flex items-center gap-1.5 text-left hover:text-primary hover:underline">{content}</button>
    : <span className="inline-flex items-center gap-1.5">{content}</span>;
}

function EvidenceLeg({ row, children }: { row: Disclosure; children: ReactNode }) {
  return <li className="min-w-0 rounded-md border bg-background px-3 py-2">
    <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
      {children}
      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{disclosureStages[row.stage]}</span>
    </div>
    <p className="mt-1 text-xs font-medium">{row.product}</p>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
      <Release row={row} /><time dateTime={row.source_date}>{fmtDate(row.source_date)}</time>
    </div>
  </li>;
}

const featured = [
  { ticker: "GOOGL", label: "Data-center power" }, { ticker: "DELL", label: "Enterprise AI security" },
  { ticker: "AAPL", label: "Semiconductors" },
];

export function IssuerDisclosures({ ticker, onPick }: { ticker: string; onPick: (ticker: string) => void }) {
  const query = useQuery(disclosureQuery(ticker));
  const [activeId, setActiveId] = useState("");
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<"all" | "upstream" | "downstream">("all");
  if (query.isError && !query.data) return <p role="status" className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
    Issuer announcements could not be loaded. <Button variant="outline" size="sm" onClick={() => query.refetch()}>Retry</Button>
  </p>;
  if (!query.data) return null;
  const { direct, paths, sharedInputs = [] } = query.data;
  if (!direct.length) return <div className="mt-4 rounded-md border px-3.5 py-3 text-xs">
    <p className="font-medium">No curated issuer disclosures for {ticker}</p>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
      {featured.map((item) => <button type="button" key={item.ticker} onClick={() => onPick(item.ticker)} className="text-primary hover:underline">
        {item.label} <span aria-hidden="true">→</span>
      </button>)}
    </div>
  </div>;
  const mostRecentReview = direct.reduce((date, row) => row.reviewed_on > date ? row.reviewed_on : date, "");
  const upstreamCount = direct.filter((r) => r.recipient_key === ticker).length;
  const filtered = direct.filter((r) => direction === "all" || (direction === "upstream" ? r.recipient_key : r.provider_key) === ticker);
  const pages = Math.ceil(filtered.length / 6);
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  const firstVisible = currentPage * 6 + 1;
  const lastVisible = Math.min(firstVisible + 5, filtered.length);
  const programs = [
    ...paths.map((path) => ({ id: path.id, label: path.label, path, shared: undefined })),
    ...sharedInputs.map((shared) => ({ id: shared.id, label: shared.label, path: undefined, shared })),
  ];
  const program = programs.find((p) => p.id === activeId) ?? programs[0];
  const path = program?.path;
  const shared = program?.shared;
  return (
    <Panel title="Issuer disclosures" subtitle={`${direct.length} direct relationship${direct.length === 1 ? "" : "s"} · reviewed ${fmtDate(mostRecentReview)} · stages at publication`} collapse={false} className="mt-4" bodyClassName="p-0">
      {program && <div className="border-b bg-muted/30 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[11px] font-medium text-muted-foreground">Documented program</span>
          {programs.length > 1 ? <select aria-label="Documented program" value={program.id} onChange={(e) => setActiveId(e.target.value)}
            className="min-w-0 max-w-full rounded border bg-background px-2 py-1 text-xs">
            {programs.map((p) => <option key={p.id} value={p.id}>{p.label}{p.path ? ` · ${p.path.first.provider_name} → ${p.path.second.recipient_name}` : ""}</option>)}
          </select> : <span className="text-xs font-semibold">{program.label}</span>}
        </div>
        {path && <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Party id={path.first.provider_key} name={path.first.provider_name} focus={ticker} onPick={onPick} />
            <ArrowRight className="size-3.5 text-muted-foreground" aria-label="supplies" />
            <Party id={path.first.recipient_key} name={path.first.recipient_name} focus={ticker} onPick={onPick} />
            <ArrowRight className="size-3.5 text-muted-foreground" aria-label="supplies" />
            <Party id={path.second.recipient_key} name={path.second.recipient_name} focus={ticker} onPick={onPick} />
          </div>
          <ol className="mt-2 grid gap-2 sm:grid-cols-2">
            {[path.first, path.second].map((row) => <EvidenceLeg key={row.id} row={row}>
              <span className="text-muted-foreground">{row.provider_name} → {row.recipient_name}</span>
            </EvidenceLeg>)}
          </ol>
        </>}
        {shared && <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Parallel inputs to</span>
            <Party id={shared.inputs[0].recipient_key} name={shared.recipient} focus={ticker} onPick={onPick} />
          </div>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {shared.inputs.map((row) => <EvidenceLeg key={row.id} row={row}><Party id={row.provider_key} name={row.provider_name} focus={ticker} onPick={onPick} /></EvidenceLeg>)}
          </ul>
        </>}
        {programWatch[program.label] && <p className="mt-2 border-l-2 border-primary/50 pl-2 text-xs leading-relaxed">
          <span className="mr-1.5 font-semibold">Milestone</span>{programWatch[program.label]}
        </p>}
      </div>}
      {upstreamCount > 0 && upstreamCount < direct.length && <div className="flex flex-wrap items-center gap-1.5 border-b px-3.5 py-2" role="group" aria-label="Relationship direction">
        {([["all", "All", direct.length], ["upstream", "Suppliers", upstreamCount], ["downstream", "Recipients", direct.length - upstreamCount]] as const)
          .filter(([, , count]) => count > 0)
          .map(([key, label, count]) => <button key={key} type="button" aria-pressed={direction === key}
            onClick={() => { setDirection(key); setPage(0); }}
            className={`rounded px-2 py-1 text-xs ${direction === key ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {label} <span className="tabular-nums">{count}</span>
          </button>)}
      </div>}
      <ul className="divide-y">
        {filtered.slice(currentPage * 6, (currentPage + 1) * 6).map((row) => {
          const upstream = row.recipient_key === ticker;
          return <li key={row.id} className="grid gap-1.5 px-3.5 py-2.5 text-xs sm:grid-cols-[minmax(125px,0.8fr)_minmax(160px,2fr)_minmax(110px,0.6fr)] sm:gap-4">
            <div>
              <Party id={upstream ? row.provider_key : row.recipient_key} name={upstream ? row.provider_name : row.recipient_name} focus={ticker} onPick={onPick} />
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{upstream ? "Upstream provider" : "Downstream recipient"}</span>
            </div>
            <div><span className="font-semibold">{row.product}</span><span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px]">{disclosureStages[row.stage]}</span>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">{row.detail}</p></div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground sm:flex-col sm:items-start sm:gap-0.5">
              <time dateTime={row.source_date}>{fmtDate(row.source_date)}</time><Release row={row} />
            </div>
          </li>;
        })}
      </ul>
      {pages > 1 && <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5 text-xs">
        <span aria-live="polite" className="mr-auto text-muted-foreground">{firstVisible === lastVisible ? firstVisible : `${firstVisible}–${lastVisible}`} of {filtered.length}</span>
        <Button disabled={!currentPage} variant="ghost" size="sm" onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button disabled={currentPage + 1 >= pages} variant="ghost" size="sm" onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>}
    </Panel>
  );
}
