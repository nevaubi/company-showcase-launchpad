import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Factory } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import { quoteLink } from "@/lib/supply/counterparty";
import { disclosureStages, type Disclosure } from "@/lib/supply/disclosures";
import { disclosureQuery } from "@/lib/supply/query";

function Release({ row }: { row: Disclosure }) {
  return <a href={quoteLink(row.source_url, row.source_phrase)} target="_blank" rel="noopener noreferrer"
    aria-label={`${row.publisher} release on ${fmtDate(row.source_date)} about ${row.product} (opens in new tab)`}
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

export function IssuerDisclosures({ ticker, onPick }: { ticker: string; onPick: (ticker: string) => void }) {
  const query = useQuery(disclosureQuery(ticker));
  const [activeId, setActiveId] = useState("");
  const [page, setPage] = useState(0);
  if (query.isError && !query.data) return <p role="status" className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
    Issuer announcements could not be loaded. <Button variant="outline" size="sm" onClick={() => query.refetch()}>Retry</Button>
  </p>;
  if (!query.data?.direct.length) return null;
  const { direct, paths } = query.data;
  const mostRecentReview = direct.reduce((date, row) => row.reviewed_on > date ? row.reviewed_on : date, "");
  const pages = Math.ceil(direct.length / 6);
  const currentPage = Math.min(page, pages - 1);
  const path = paths.find((p) => p.id === activeId) ?? paths[0];
  return (
    <Panel title="Issuer disclosures" subtitle={`${direct.length} curated relationships · last review ${fmtDate(mostRecentReview)} · stages at announcement`} collapse={false} className="mt-4" bodyClassName="p-0">
      {path && <div className="border-b bg-muted/30 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[11px] font-medium text-muted-foreground">Product pathway</span>
          {paths.length > 1 ? <select aria-label="Product pathway" value={path.id} onChange={(e) => setActiveId(e.target.value)}
            className="max-w-full rounded border bg-background px-2 py-1 text-xs">
            {paths.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.first.provider_name} → {p.second.recipient_name}</option>)}
          </select> : <span className="text-xs font-semibold">{path.label}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Party id={path.first.provider_key} name={path.first.provider_name} focus={ticker} onPick={onPick} />
          <ArrowRight className="size-3.5 text-muted-foreground" aria-label="supplies" />
          <Party id={path.first.recipient_key} name={path.first.recipient_name} focus={ticker} onPick={onPick} />
          <ArrowRight className="size-3.5 text-muted-foreground" aria-label="supplies" />
          <Party id={path.second.recipient_key} name={path.second.recipient_name} focus={ticker} onPick={onPick} />
        </div>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2">
          {[path.first, path.second].map((row) => <li key={row.id} className="border-l-2 pl-2 text-xs">
            <p>{row.product} <span className="text-muted-foreground">· {disclosureStages[row.stage]}</span></p>
            <p className="mt-0.5 flex items-center gap-2 text-muted-foreground"><Release row={row} /><time dateTime={row.source_date}>{fmtDate(row.source_date)}</time></p>
          </li>)}
        </ol>
      </div>}
      <ul className="divide-y">
        {direct.slice(currentPage * 6, (currentPage + 1) * 6).map((row) => {
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
        <span aria-live="polite" className="mr-auto text-muted-foreground">{currentPage * 6 + 1}–{Math.min((currentPage + 1) * 6, direct.length)} of {direct.length}</span>
        <Button disabled={!currentPage} variant="ghost" size="sm" onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button disabled={currentPage + 1 >= pages} variant="ghost" size="sm" onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>}
    </Panel>
  );
}
