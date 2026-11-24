import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { legalNameAdds, legalNameLabel, type HeadOffice } from "./model";

/**
 * Short facts on one line, separated by middle dots. The dot belongs to the gap before an item and the
 * line clips its own left edge, so a wrapped line never starts or ends with a separator.
 */
export function MetaLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-clip", className)}>
      <ul className="-ml-4 flex flex-wrap items-center">{children}</ul>
    </div>
  );
}

export function MetaItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "relative ml-4 min-w-0 before:absolute before:-left-[0.625rem] before:text-muted-foreground/70 before:content-['·']",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** The company's name as the page title, with its ticker and exchange beside it. */
export function CompanyName({
  ticker,
  name,
  legalName,
  exchange,
  className,
}: {
  ticker: string;
  name: string;
  /** SEC registrant name, for the tooltip */
  legalName?: string;
  exchange: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2.5", className)}>
      <h1
        className="line-clamp-2 min-w-0 font-display text-xl leading-7 tracking-tight [text-wrap:balance] sm:text-2xl sm:leading-8"
        title={legalName ? `SEC registrant: ${legalName}` : undefined}
      >
        {name}
      </h1>
      <p className="whitespace-nowrap text-[13px] leading-5 text-muted-foreground">
        <span className="num font-medium text-foreground">{ticker}</span>
        {exchange && (
          <>
            <span aria-hidden className="mx-1.5 text-muted-foreground/70">
              ·
            </span>
            <span>
              <span className="sr-only">listed on </span>
              {exchange}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * One quiet line of context: sector (a link to its page), industry and head office. The registrant's
 * legal name leads the line only when it says more than the display name; otherwise it stays in the
 * title's tooltip.
 */
export function CompanyContext({
  name,
  legalName,
  sector,
  industry,
  office,
  className,
}: {
  name: string;
  legalName?: string;
  sector?: string;
  industry?: string;
  office: HeadOffice | null;
  className?: string;
}) {
  const showLegal = !!legalName && legalNameAdds(name, legalName);
  return (
    <MetaLine className={cn("text-[13px] leading-5 text-muted-foreground", className)}>
      {showLegal && (
        <MetaItem>
          <span title={`SEC registrant: ${legalName}`}>{legalNameLabel(legalName!)}</span>
        </MetaItem>
      )}
      {sector && (
        <MetaItem>
          <Link
            to="/app/sectors/$sector"
            params={{ sector }}
            title={`${sector} sector`}
            className="rounded-sm underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sector}
          </Link>
        </MetaItem>
      )}
      {industry && <MetaItem>{industry}</MetaItem>}
      {office && (
        // the head office is the first thing to go on a phone-width header
        <MetaItem className="hidden @min-[30rem]/hdr:block">
          {/* align-top: an inline flex box that starts with an icon would otherwise sit on the icon's bottom edge and make the line 2 px taller */}
          <span className="inline-flex items-center gap-1 align-top" title={`Head office: ${office.place} (${office.basis})`}>
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only">Head office: </span>
            {office.place}
          </span>
        </MetaItem>
      )}
    </MetaLine>
  );
}
