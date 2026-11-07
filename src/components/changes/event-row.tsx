import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { MouseEvent } from "react";
import { fmtBaseRate, TYPE_SHORT } from "@/lib/changes/core";
import type { ChangeEvent, ChangeEvidence, ChangeTier } from "@/lib/changes/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TIER_BAR: Record<ChangeTier, string> = {
  high: "bg-foreground",
  medium: "bg-highlight",
  low: "bg-border",
};
const TIER_TEXT: Record<ChangeTier, string> = {
  high: "text-foreground",
  medium: "text-highlight-foreground",
  low: "text-muted-foreground",
};

function EvidenceLink({ x }: { x: ChangeEvidence }) {
  const navigate = useNavigate();
  const cls =
    "inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] text-muted-foreground underline-offset-2 hover:bg-secondary hover:text-foreground hover:underline";
  if (x.kind === "app")
    return (
      <a
        href={x.url}
        className={cls}
        onClick={(e: MouseEvent) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          navigate({ href: x.url });
        }}
      >
        {x.label}
      </a>
    );
  return (
    <a href={x.url} target="_blank" rel="noreferrer" className={cls}>
      {x.label}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );
}

/** One event: claim, the rule that ranked it, the evidence excerpt and source links. */
export function EventRow({
  e,
  isNew,
  showCompany = true,
  compact = false,
}: {
  e: ChangeEvent;
  isNew?: boolean;
  showCompany?: boolean;
  compact?: boolean;
}) {
  const quote = e.evidence.find((x) => x.excerpt);
  const links = e.evidence.filter((x) => x.url);
  const base = fmtBaseRate(e.base_rate);
  // Technical reasons already carry the base rate in words; show the formatted line instead.
  const reason = e.type === "technical" && base ? "Technical events are low tier." : e.reason;
  return (
    <li className="grid grid-cols-[3px_minmax(0,1fr)] gap-x-3 px-3.5 py-2.5" data-event={e.id}>
      <span aria-hidden className={cn("rounded-full", TIER_BAR[e.tier])} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {showCompany && e.t && (
            <Link
              to="/app/companies/$ticker"
              params={{ ticker: e.t }}
              className="num text-[12px] font-semibold hover:underline"
              title={e.name ?? undefined}
            >
              {e.t}
            </Link>
          )}
          <span className={cn("text-[10px] uppercase tracking-wider", TIER_TEXT[e.tier])}>
            {e.tier} · {TYPE_SHORT[e.type]}
          </span>
          {isNew && (
            <span className="rounded bg-highlight-soft px-1 text-[10px] font-medium text-highlight-foreground">
              New
            </span>
          )}
          <span className="num ml-auto text-[11px] text-muted-foreground">
            {e.upcoming ? "Upcoming " : ""}
            {fmtDate(e.date, { month: "short", day: "numeric" })}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug">{e.title}</p>
        {!compact && e.detail && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{e.detail}</p>
        )}
        {!compact && quote?.excerpt && (
          <blockquote className="mt-1.5 border-l-2 pl-2.5 text-[12px] leading-relaxed text-muted-foreground">
            {quote.excerpt}
          </blockquote>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">Why it ranks: </span>
          {reason}
        </p>
        {!compact && base && <p className="mt-0.5 text-[11px] text-muted-foreground">{base}</p>}
        {!compact && links.length > 0 && (
          <div className="-ml-1 mt-1 flex flex-wrap gap-x-1">
            {links.slice(0, 5).map((x, i) => (
              <EvidenceLink key={i} x={x} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
