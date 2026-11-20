// Small shared pieces of the supply-chain views: relation marks (shape + colour), line samples for legends,
// and the hover card both views show for a counterparty.
import { memo, type CSSProperties } from "react";
import { AlertTriangle, Globe2, Lock } from "lucide-react";
import type { Relation } from "@/lib/supply/core";
import type { NodeFacts } from "@/lib/supply/describe";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RELATION_COLOR, RELATION_DASH, RELATION_ONE, RELATION_SHAPE, type MarkShape } from "./supply-map-meta";

const SHAPE_PATH: Record<MarkShape, string> = {
  circle: "M5 0.75a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 1 1 0-8.5Z",
  square: "M1.25 1.25h7.5v7.5h-7.5Z",
  diamond: "M5 0.4L9.6 5L5 9.6L0.4 5Z",
  triangle: "M5 0.8L9.4 8.9H0.6Z",
};

/** The relation's marker: its shape filled with its colour. Decorative; the label next to it says the relation. */
export const RelationMark = memo(function RelationMark({ relation, size = 10, className, hollow }: { relation: Relation; size?: number; className?: string; hollow?: boolean }) {
  const color = RELATION_COLOR[relation];
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width={size} height={size} className={cn("shrink-0 overflow-visible", className)}>
      <path d={SHAPE_PATH[RELATION_SHAPE[relation]]} fill={hollow ? "none" : color} stroke={color} strokeWidth={hollow ? 1.6 : 0} strokeLinejoin="round" />
    </svg>
  );
});

/** A short sample of the relation's line style, for legends. */
export function LineSample({ relation, width = 22 }: { relation: Relation; width?: number }) {
  const dash = RELATION_DASH[relation];
  const flow = relation === "supplier" || relation === "customer";
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${width} 8`} width={width} height={8} className="shrink-0 overflow-visible">
      <path d={`M1 4H${width - (flow ? 4 : 1)}`} stroke={RELATION_COLOR[relation]} strokeWidth={1.75} strokeDasharray={dash.length ? dash.join(" ") : undefined} strokeLinecap={relation === "competitor" ? "round" : "butt"} fill="none" />
      {flow && <path d={`M${width - 5} 1.2L${width - 0.5} 4L${width - 5} 6.8Z`} fill={RELATION_COLOR[relation]} />}
      {relation === "partner" && <path d="M5 1.2L0.5 4L5 6.8Z" fill={RELATION_COLOR[relation]} />}
    </svg>
  );
}

/** "16.3% share" or "$2.0B stated": the figure a card shows, with what kind of figure it is. Amounts are as stated, never called sales. */
export function figure(f: Pick<NodeFacts, "share" | "amount">): { value: string; unit: string } | null {
  if (f.share != null) return { value: `${f.share}%`, unit: "share" };
  if (f.amount != null) return { value: fmtCompactUsd(f.amount), unit: "stated" };
  return null;
}

export interface HoverCardProps {
  name: string;
  facts: NodeFacts;
  /** where the name sits on the globe and on what basis */
  place?: string;
  basis?: string;
  /** shock simulation line, when the shock tab is open */
  shock?: string | null;
  /** what a click does */
  action?: string;
  className?: string;
  style?: CSSProperties;
}

/** The hover card both views show for a counterparty: relation, figures, product, flags, the start of the newest quoted sentence and its filing. */
export function NodeHoverCard({ name, facts, place, basis, shock, action = "Click for the sentence", className, style }: HoverCardProps) {
  const fig = figure(facts);
  const both = facts.share != null && facts.amount != null;
  return (
    <div aria-hidden="true" data-supply-tip="" style={style}
      className={cn("pointer-events-none z-20 w-[288px] rounded-md border bg-popover p-3 text-popover-foreground shadow-lift", className)}>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <RelationMark relation={facts.relation} size={9} />
        <span>{RELATION_ONE[facts.relation]}{facts.hop === 2 ? " of a direct link" : ""}</span>
        <span aria-hidden="true">·</span>
        <span className="num">{facts.statements}</span> filing statement{facts.statements === 1 ? "" : "s"}
      </p>
      <p className="mt-1 text-[13px] font-semibold leading-snug">{name}</p>
      {place && <p className="mt-0.5 text-[11px] text-muted-foreground">{place}{basis ? ` · ${basis}` : ""}</p>}
      {(fig || facts.product) && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          {fig && <><dt className="text-muted-foreground">{fig.unit === "share" ? "Stated share" : "Stated amount"}</dt><dd className="num font-medium">{fig.value}{both ? ` · ${fmtCompactUsd(facts.amount)} stated` : ""}</dd></>}
          {facts.product && <><dt className="text-muted-foreground">Product</dt><dd className="truncate">{facts.product}</dd></>}
        </dl>
      )}
      {(facts.singleSource || facts.hotspots.length > 0 || shock) && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {facts.singleSource && <li className="inline-flex items-center gap-1"><Lock className="size-3 text-negative" aria-hidden="true" />Single source</li>}
          {facts.hotspots.length > 0 && <li className="inline-flex items-center gap-1"><Globe2 className="size-3 text-warning" aria-hidden="true" />{facts.hotspots.join(", ")}</li>}
          {shock && <li className="inline-flex items-center gap-1"><AlertTriangle className="size-3 text-negative" aria-hidden="true" />{shock}</li>}
        </ul>
      )}
      {facts.excerpt && <p className="mt-2 border-l-2 border-highlight pl-2 text-xs leading-relaxed text-muted-foreground">“{facts.excerpt}”</p>}
      <p className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
        <span className="num whitespace-nowrap">{facts.form} · {fmtDate(facts.filed)}</span>
        <span className="whitespace-nowrap text-right text-foreground">{action}</span>
      </p>
      {facts.amount != null && <p className="mt-1 text-[11px] text-muted-foreground">Amount as written in the filing: it may be a commitment, an investment or a programme size.</p>}
    </div>
  );
}
