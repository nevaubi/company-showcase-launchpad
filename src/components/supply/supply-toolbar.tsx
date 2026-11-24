// Controls of the supply-chain map: the one row above the canvas (view, what to show, depth, flags), the relation
// chips that hide or show a kind of counterparty, and the line that says what is isolated. Every control is a real
// button with a pressed or checked state, so the keyboard and the assistant can use it; none of them moves the page.
import type { ReactNode } from "react";
import { DollarSign, Globe2, Lock, Percent, X, type LucideIcon } from "lucide-react";
import { Segmented, type SegOption } from "@/components/app/segmented";
import { RELATIONS, type Relation } from "@/lib/supply/core";
import type { SupplyView } from "@/lib/supply/url-state";
import { cn } from "@/lib/utils";
import { RELATION_LABEL, type Overlay } from "./supply-map-meta";
import { RelationMark } from "./supply-marks";

export function RelationFilters({ counts, visible, onToggle, loading }: { counts: Record<Relation, number>; visible: Set<Relation>; onToggle: (r: Relation) => void; loading?: boolean }) {
  return (
    <div role="group" aria-label="Relations shown on the map" data-agent-controls className="flex flex-wrap items-center gap-1.5">
      {RELATIONS.map((r) => {
        const on = visible.has(r);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            aria-label={`${RELATION_LABEL[r]}: ${loading ? "loading" : counts[r]}. ${on ? "Shown, press to hide" : "Hidden, press to show"}.`}
            onClick={() => onToggle(r)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-[background-color,color,border-color] duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              on ? "bg-card text-foreground shadow-paper" : "border-dashed bg-transparent text-muted-foreground",
            )}
          >
            <RelationMark relation={r} size={9} hollow={!on} />
            {RELATION_LABEL[r]}
            <span className="num font-normal text-muted-foreground">{loading ? "…" : counts[r]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What the "Show" control isolates: everything, one side of the company, or (other) a name or pathway picked on the map. */
export type ShowChoice = "all" | "supplier" | "customer" | "other";
const VIEW_OPTIONS: SegOption<SupplyView>[] = [
  { v: "network", l: "Network", title: "What flows in and out, sized by stated figures" },
  { v: "globe", l: "Globe", title: "Where each name is based" },
  { v: "chain", l: "Chain", title: "Suppliers' suppliers through to customers' customers" },
];
const SHOW_OPTIONS: SegOption<ShowChoice>[] = [
  { v: "all", l: "All links" },
  { v: "supplier", l: "Suppliers only", title: "Keep the supply side lit and dim the rest" },
  { v: "customer", l: "Customers only", title: "Keep the customer side lit and dim the rest" },
];
const DEPTH_OPTIONS: SegOption<"1" | "2">[] = [{ v: "1", l: "Direct" }, { v: "2", l: "2nd order", title: "Add the suppliers of suppliers and the customers of customers" }];
const TIER_OPTIONS: SegOption<"1" | "2" | "3">[] = [{ v: "1", l: "1 tier" }, { v: "2", l: "2 tiers" }, { v: "3", l: "3 tiers" }];
const SIZE_OPTIONS: SegOption<"share" | "dollars">[] = [{ v: "share", l: "Share", title: "Line width shows the stated share" }, { v: "dollars", l: "Dollars", title: "Line width shows stated dollars, or a stated share of the seller's revenue" }];

/** The four things a name can be flagged for; the same icons mark the cards. */
export const FLAGS: { v: Exclude<Overlay, "none">; label: string; icon: LucideIcon; title: string }[] = [
  { v: "single", label: "Single source", icon: Lock, title: "Ring the names a filing calls a sole, single or exclusive source" },
  { v: "concentration", label: "10%+ share", icon: Percent, title: "Ring the names with a stated share of 10% or more" },
  { v: "geo", label: "Hotspot", icon: Globe2, title: "Ring the names whose sentence ties them to a geopolitical hotspot" },
  { v: "dollars", label: "Dollar figure", icon: DollarSign, title: "Ring the names with a stated flow, or a stated share of SEC revenue" },
];

export interface MapToolbarProps {
  view: SupplyView;
  onView: (v: SupplyView) => void;
  show: ShowChoice;
  onShow: (s: ShowChoice) => void;
  depth: 1 | 2;
  onDepth: (d: 1 | 2) => void;
  overlay: Overlay;
  onOverlay: (o: Overlay) => void;
  chainDepth: number;
  onChainDepth: (d: number) => void;
  chainSize: "share" | "dollars";
  onChainSize: (s: "share" | "dollars") => void;
}

/** One row of map controls. Chain swaps depth for tiers and flags for what line width shows; the rest stays in place. */
export function MapToolbar(p: MapToolbarProps) {
  const chain = p.view === "chain";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div data-tour="supply-views" data-agent-controls>
        <Segmented label="View" value={p.view} options={VIEW_OPTIONS} onChange={p.onView} />
      </div>
      {chain
        ? <Segmented label="Chain depth" value={String(Math.max(1, Math.min(3, p.chainDepth))) as "1" | "2" | "3"} options={TIER_OPTIONS} onChange={(v) => p.onChainDepth(Number(v))} />
        : <Segmented label="Depth" value={String(p.depth) as "1" | "2"} options={DEPTH_OPTIONS} onChange={(v) => p.onDepth(v === "2" ? 2 : 1)} />}
      <Segmented label="Show" value={p.show} options={SHOW_OPTIONS} onChange={p.onShow} />
      <div className="lg:ml-auto">
        {chain ? (
          <Segmented label="Size lines by" value={p.chainSize} options={SIZE_OPTIONS} onChange={p.onChainSize} />
        ) : (
          <div role="group" aria-label="Flag names on the map" data-agent-controls className="inline-flex max-w-full flex-wrap rounded-md border bg-secondary/50 p-0.5">
            {FLAGS.map((f) => {
              const on = p.overlay === f.v;
              return (
                <button key={f.v} type="button" aria-pressed={on} title={f.title} onClick={() => p.onOverlay(on ? "none" : f.v)}
                  className={cn("inline-flex min-h-7 items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    on ? "bg-card font-medium text-foreground shadow-paper" : "text-muted-foreground hover:text-foreground")}>
                  <f.icon className={cn("size-3 shrink-0", on && f.v !== "dollars" && f.v !== "concentration" && "text-negative")} aria-hidden="true" />{f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** The control that ends an isolation. Esc does the same; the key is shown where there is room. */
export function ClearIsolation({ label, onClear, className }: { label: string; onClear: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClear} aria-label={`Clear isolation: ${label}`}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded border bg-card px-2 text-xs shadow-paper transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", className)}>
      <X className="size-3" aria-hidden="true" />Clear<kbd className="num ml-0.5 hidden rounded border px-1 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
    </button>
  );
}

/** The right end of the canvas header: what is isolated and how to clear it, or a one-line hint when nothing is. */
export function IsolationStatus({ label, note, hint, onClear, action }: { label: string | null; note?: string | null; hint: ReactNode; onClear: () => void; action?: { label: string; onClick: () => void } | null }) {
  if (!label) return <p className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</p>;
  return (
    <p data-section="Isolation" className="flex min-w-0 items-center gap-2 text-xs">
      <span className="eyebrow shrink-0">Isolated</span>
      <span className="min-w-0 truncate font-medium" title={note ? `${label}. ${note}` : label}>{label}{note && <span className="font-normal text-muted-foreground"> · {note}</span>}</span>
      {action && (
        <button type="button" onClick={action.onClick}
          className="h-7 shrink-0 rounded px-1.5 text-[11px] font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {action.label}
        </button>
      )}
      <ClearIsolation label={label} onClear={onClear} />
    </p>
  );
}
