import type { ReactNode } from "react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompanyProfile } from "@/lib/financials/types";
import { fmtCompact, fmtCompactUsd, fmtDate, fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { awaiting, changeTone, marketCap, partState, priceStatus, range52, type QuoteLike } from "./model";

const TONE = { positive: "text-positive", negative: "text-negative", flat: "text-muted-foreground" } as const;
const CAPTION = "text-[11px] leading-4 text-muted-foreground";

/**
 * A caption over a value. The value row is as tall as the price line and carries an invisible figure
 * at the price's size, so small values share the price's baseline wherever the blocks sit side by side.
 */
function Fact({ label, title, children, className }: { label: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)} title={title}>
      <dt className={CAPTION}>{label}</dt>
      <dd className="flex h-8 items-baseline whitespace-nowrap max-sm:h-6">
        <span aria-hidden className="invisible w-0 text-2xl leading-8 max-sm:hidden">
          0
        </span>
        {children}
      </dd>
    </div>
  );
}

/** Last price, the day's change with its sign in colour, and what the price is (close, intraday, stored). */
export function PriceBlock({
  ticker,
  quote,
  pending,
  className,
}: {
  ticker: string;
  quote: QuoteLike | undefined;
  /** the quote request has not answered yet */
  pending: boolean;
  className?: string;
}) {
  if (!quote) {
    return (
      <div data-section="Price" className={cn("min-w-0", className)} aria-busy={pending || undefined}>
        {pending ? (
          <>
            <div className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-24" />
            </div>
            <div className="flex h-8 items-center gap-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
            <span className="sr-only">Loading the price of {ticker}</span>
          </>
        ) : (
          <>
            <p className={CAPTION}>Price unavailable</p>
            <p className="flex h-8 items-baseline gap-2 whitespace-nowrap">
              <span aria-hidden className="num text-2xl leading-8 text-muted-foreground/70">–</span>
              <span className="text-[13px] text-muted-foreground">No quote or stored close right now</span>
            </p>
          </>
        )}
      </div>
    );
  }
  const status = priceStatus(quote, new Date());
  const tone = changeTone(quote.change);
  return (
    <div data-section="Price" className={cn("min-w-0", className)}>
      <p className={cn(CAPTION, "flex items-center gap-1.5")} title={status.title}>
        {status.stale && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
        <span>
          {status.label}
          {status.stale && <span className="sr-only"> (older than four days)</span>}
        </span>
      </p>
      <p className="flex h-8 items-baseline gap-2 whitespace-nowrap">
        <span className="num text-2xl font-semibold leading-8">{fmtPrice(quote.price)}</span>
        <span className={cn("num text-sm font-medium", TONE[tone])}>
          <span className="sr-only">{tone === "positive" ? "up " : tone === "negative" ? "down " : "unchanged "}</span>
          {fmtSigned(quote.change)} ({fmtPct(quote.changePct, 2, true)})
        </span>
      </p>
    </div>
  );
}

/** Low, track with the last price marked, high. */
function RangeMeter({ low, high, position, price }: { low: number; high: number; position: number; price: number }) {
  const pct = Math.round(position * 100);
  return (
    <span
      role="img"
      aria-label={`52-week range ${fmtPrice(low)} to ${fmtPrice(high)}. The last price ${fmtPrice(price)} is ${pct}% of the way from the low to the high.`}
      className="num flex items-center gap-2 text-[13px]"
    >
      <span aria-hidden>{low.toFixed(2)}</span>
      <span aria-hidden className="relative h-1 w-20 shrink-0 rounded-full bg-foreground/15 sm:w-24">
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
          style={{ left: `${Math.min(98, Math.max(2, position * 100))}%` }}
        />
      </span>
      <span aria-hidden>{high.toFixed(2)}</span>
    </span>
  );
}

/**
 * Price-centred facts from what the header has already loaded: market value (last price times the
 * cover-page share count, opening that count's filing) and where the price sits in its 52-week range.
 * Fundamentals stay on the Overview.
 *
 * A fact whose inputs are still on their way holds its place with a skeleton, so the row keeps its
 * shape while the quote and the dataset arrive; a fact that cannot be shown is left out.
 */
export function QuoteFacts({
  ticker,
  quote,
  profile,
  quotePending = false,
  profilePending = false,
  className,
}: {
  ticker: string;
  quote: QuoteLike | undefined;
  profile: CompanyProfile | undefined;
  /** the quote request has not answered yet */
  quotePending?: boolean;
  /** the company dataset has not answered yet */
  profilePending?: boolean;
  className?: string;
}) {
  const { open } = useSource();
  const shares = profile?.sharesOutstanding ?? null;
  const cap = marketCap(quote?.price, shares);
  const range = range52(quote?.price, quote?.low52, quote?.high52);
  const quoteState = partState(!!quote, quotePending);
  const capWaiting = awaiting(cap, [quoteState, partState(shares != null, profilePending)]);
  const rangeWaiting = awaiting(range, [quoteState]);
  if (!quote || (cap == null && !range)) {
    if (!capWaiting && !rangeWaiting) return null;
    return (
      <dl data-section="Price facts" aria-busy className={cn("flex min-w-0 flex-wrap gap-x-6 gap-y-1", className)}>
        {capWaiting && (
          <Fact label="Market cap">
            <Skeleton className="h-3 w-12" />
          </Fact>
        )}
        {rangeWaiting && (
          <Fact label="52-week range">
            <Skeleton className="h-3 w-[11.875rem] sm:w-[12.875rem]" />
          </Fact>
        )}
      </dl>
    );
  }
  const asOf = profile?.sharesOutstandingAsOf ? fmtDate(profile.sharesOutstandingAsOf) : null;
  const capTarget: SourceTarget | null =
    cap != null && shares && profile?.sharesOutstandingAccn
      ? {
          ticker,
          label: "Market cap",
          periodLabel: `${fmtPrice(quote.price)} × shares outstanding${asOf ? ` as of ${asOf}` : ""}`,
          unit: "usd",
          value: cap,
          approx: true,
          derived: {
            formula: "Last price × shares outstanding on the latest filing cover page",
            parts: [
              {
                label: "Shares outstanding (cover page)",
                sign: 1,
                accn: profile.sharesOutstandingAccn,
                concept: "dei:EntityCommonStockSharesOutstanding",
                end: profile.sharesOutstandingAsOf ?? "",
                value: shares,
              },
            ],
          },
        }
      : null;
  const capTitle = `Last price × ${shares ? fmtCompact(shares, 2) : ""} shares on the latest filing cover page${asOf ? ` (${asOf})` : ""}`;
  return (
    <dl data-section="Price facts" aria-busy={capWaiting || undefined} className={cn("flex min-w-0 flex-wrap gap-x-6 gap-y-1", className)}>
      {capWaiting && (
        <Fact label="Market cap">
          <Skeleton className="h-3 w-12" />
        </Fact>
      )}
      {cap != null && (
        <Fact label="Market cap" title={capTitle}>
          {capTarget ? (
            <button
              type="button"
              onClick={() => open(capTarget)}
              aria-label={`Market cap ${fmtCompactUsd(cap)}. Open the source of the share count.`}
              className="num -mx-1 rounded-sm px-1 text-[13px] font-medium leading-5 underline decoration-transparent decoration-dotted underline-offset-[3px] transition-colors duration-150 hover:bg-highlight-soft/60 hover:decoration-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fmtCompactUsd(cap)}
            </button>
          ) : (
            <span className="num text-[13px] font-medium leading-5">{fmtCompactUsd(cap)}</span>
          )}
        </Fact>
      )}
      {range && (
        <Fact
          label="52-week range"
          title={`52-week low ${fmtPrice(range.low)}, high ${fmtPrice(range.high)}. The last price is ${Math.round(range.position * 100)}% of the way up. From the quote provider.`}
        >
          <RangeMeter low={range.low} high={range.high} position={range.position} price={quote.price} />
        </Fact>
      )}
    </dl>
  );
}
