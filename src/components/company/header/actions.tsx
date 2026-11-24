import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, Columns3, Ellipsis, FileText, Globe, Sparkles, Star } from "lucide-react";
import { CoverageChip } from "@/components/firm/coverage-chip";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CompanyProfile, Filing } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { requestResearch } from "@/lib/research/request";
import { cn } from "@/lib/utils";
import { useToggleFollow } from "@/lib/workspace";
import { edgarUrl, irUrl, latestReports } from "./model";

const researchPrompt = (ticker: string) =>
  `Build a sourced investment brief for ${ticker}: latest results, valuation, estimates, supply-chain risks and upcoming catalysts. Read the company pages and distinguish reported facts from estimates.`;

const reportLabel = (f: Filing) =>
  f.form === "10-Q" ? `Quarterly report (${f.report ?? f.filed})` : `Annual report (${(f.report ?? f.filed).slice(0, 4)})`;

/** Menu rows shared by the desktop "Filings" menu and the phone "More" menu. */
function FilingItems({ ticker, cik, filings, pending }: { ticker: string; cik: string; filings: Filing[] | undefined; pending: boolean }) {
  const { open } = useSource();
  const { annual, quarterly } = latestReports(filings);
  const openReport = (f: Filing) =>
    open({
      ticker,
      label: reportLabel(f),
      unit: "usd",
      value: 0,
      doc: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, title: `Latest Form ${f.form}` },
    });
  return (
    <>
      {[annual, quarterly].map(
        (f) =>
          f && (
            <DropdownMenuItem key={f.accn} onSelect={() => openReport(f)}>
              <FileText />
              <span>Latest {f.form}</span>
              <span className="num ml-auto pl-4 text-xs text-muted-foreground">filed {fmtDate(f.filed)}</span>
            </DropdownMenuItem>
          ),
      )}
      {!annual && !quarterly && (
        <DropdownMenuItem disabled>
          <FileText /> {filings ? "No annual or quarterly report on file" : pending ? "Loading filings" : "Filing list unavailable right now"}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link to="/app/companies/$ticker/filings" params={{ ticker }}>
          <FileText className="opacity-0" /> All filings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <a href={edgarUrl(cik)} target="_blank" rel="noreferrer">
          <ArrowUpRight /> EDGAR filing index
          <span className="sr-only"> (opens sec.gov in a new tab)</span>
        </a>
      </DropdownMenuItem>
    </>
  );
}

/**
 * What can be done with the company, in order of weight: Research (primary), Follow (toggle), the
 * firm's coverage when there is one, then a quiet group: Compare, a Filings menu (latest annual and
 * quarterly report, the filings tab, EDGAR) and the investor-relations site. On phones the quiet group
 * folds into one "More" menu, placed before the coverage chip so a long chip wraps, not the menu button.
 *
 * The IR address comes with the dataset (the curated list knows it at once): until the dataset answers
 * its place is held, so the row does not shuffle sideways when the link arrives.
 */
export function CompanyActions({
  ticker,
  cik,
  profile,
  filings,
  pending,
  irHint,
  price,
  className,
}: {
  ticker: string;
  cik: string;
  profile: CompanyProfile | undefined;
  filings: Filing[] | undefined;
  /** the company dataset has not answered yet */
  pending: boolean;
  /** IR address from the coverage list, when it has one */
  irHint?: string;
  price: number | null;
  className?: string;
}) {
  const follow = useToggleFollow();
  const followed = follow.isFollowed(ticker);
  const ir = irUrl(profile) ?? irUrl({ investorRelations: irHint ?? "" });
  const irHeld = !ir && pending;
  const more = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" className="sm:hidden" aria-label="More actions">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuItem asChild>
          <Link to="/app/compare" search={{ t: ticker }}>
            <Columns3 /> Compare
          </Link>
        </DropdownMenuItem>
        {ir && (
          <DropdownMenuItem asChild>
            <a href={ir} target="_blank" rel="noreferrer">
              <Globe /> Investor relations site
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <FilingItems ticker={ticker} cik={cik} filings={filings} pending={pending} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div
      role="group"
      aria-label={`${ticker} actions`}
      data-section="Company actions"
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      <Button size="xs" onClick={() => requestResearch(researchPrompt(ticker))} title="Ask the assistant for a sourced brief">
        <Sparkles /> Research
      </Button>
      <Button
        size="xs"
        variant={followed ? "secondary" : "outline"}
        aria-pressed={followed}
        onClick={() => follow.toggle(ticker)}
        disabled={follow.pending}
        title={followed ? "Remove from your watchlist" : "Add to your watchlist"}
      >
        <Star className={cn(followed && "fill-current")} />
        {followed ? "Following" : "Follow"}
      </Button>
      {more}
      <CoverageChip ticker={ticker} price={price} />

      <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />

      <Button size="xs" variant="ghost" asChild className="hidden sm:inline-flex">
        <Link to="/app/compare" search={{ t: ticker }} title="Compare with other companies">
          <Columns3 /> Compare
        </Link>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost" className="hidden sm:inline-flex" title="Latest reports and the SEC filing index">
            <FileText /> Filings <ChevronDown className="-ml-0.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <FilingItems ticker={ticker} cik={cik} filings={filings} pending={pending} />
        </DropdownMenuContent>
      </DropdownMenu>
      {ir ? (
        <Button size="xs" variant="ghost" asChild className="hidden sm:inline-flex">
          <a href={ir} target="_blank" rel="noreferrer" title="Investor relations site (opens in a new tab)">
            <Globe /> IR site <ArrowUpRight className="-ml-0.5 opacity-60" />
          </a>
        </Button>
      ) : irHeld ? (
        <Button size="xs" variant="ghost" disabled aria-hidden className="hidden sm:inline-flex">
          <Globe /> IR site <ArrowUpRight className="-ml-0.5 opacity-60" />
        </Button>
      ) : null}
    </div>
  );
}
