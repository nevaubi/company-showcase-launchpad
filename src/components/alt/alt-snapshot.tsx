import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { useCompanyAlt } from "@/components/alt/alt-company";
import { snapshotFigures, snapshotNote } from "@/lib/alt/company";
import { useKeepReaderBelow } from "@/components/company/hold-height";
import { cn } from "@/lib/utils";

/** Most tiles the snapshot shows; the skeleton lays out this many. */
const SLOTS = 6;
/**
 * Tiles share rows of two (phone), three (tablet) and six (wide), and the tiles of a short last row grow to fill it,
 * so no empty cell is drawn. At the wide width every count from one to six is one row, the skeleton's height.
 * Hairlines between tiles are the 1 px gaps over the border colour.
 */
const tile = "h-[62px] min-w-0 grow basis-[calc(50%-1px)] bg-card px-3.5 py-2 sm:basis-[calc(33.333%-1px)] xl:basis-[calc(16.666%-1px)]";

function Frame({ ticker, note, children }: { ticker: string; note: string; children: ReactNode }) {
  // where the phone or tablet layout ends up shorter than the skeleton, a reader below the section stays put
  const ref = useKeepReaderBelow<HTMLElement>();
  return (
    <section ref={ref} data-section="Alt data snapshot" className="min-w-0 overflow-hidden rounded-md border bg-card shadow-paper">
      <header className="flex h-[52px] items-center gap-3 border-b px-3.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">Alternative data</h2>
          <p className="truncate text-[11px] text-muted-foreground">{note}</p>
        </div>
        <Link to="/app/companies/$ticker/alt-data" params={{ ticker }} className="ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[4px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
          All alt data <ArrowUpRight className="size-3" />
        </Link>
      </header>
      <div className="flex flex-wrap gap-px bg-border">{children}</div>
    </section>
  );
}

/**
 * The company's most telling alt-data figures for the Overview (up to six, each with its period and
 * a click to its source), with unusual readings first: a flagged dataset's tile is the flagged
 * reading itself. Only the tiles it has are drawn. While loading it lays out six skeleton tiles; at the
 * wide width any count is one row of that height, and below it a reader under the section is kept in
 * place when the section ends up shorter. It renders nothing on error or when the company has no alt data.
 */
export function AltSnapshot({ ticker }: { ticker: string }) {
  const t = ticker.toUpperCase();
  const { q, alt } = useCompanyAlt(t);
  const { open } = useSource();
  if (q.isLoading) {
    return (
      <Frame ticker={t} note="Reading public datasets">
        {Array.from({ length: SLOTS }, (_, i) => (
          <div key={i} className={tile}>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-1.5 h-5 w-20" />
            <Skeleton className="mt-1 h-3 w-28" />
          </div>
        ))}
      </Frame>
    );
  }
  if (!alt?.views.length) return null;
  const items = snapshotFigures(alt, SLOTS);
  if (!items.length) return null;
  return (
    <Frame ticker={t} note={snapshotNote(alt.flags.length, alt.views.length)}>
      {items.map(({ view, figure, flag }) => {
        const src = figure.rows.find((r) => r.source_url);
        return (
          <button
            key={view.dataset}
            type="button"
            disabled={!src}
            onClick={() => src?.source_url && open({ ticker: t, label: `${view.label}: ${figure.label}`, unit: src.unit ?? "", value: src.value ?? 0, external: { url: src.source_url, date: src.date ?? undefined } })}
            title={flag ? `${flag.text}. ${flag.rule}` : `Source: ${figure.label}`}
            className={cn(tile, "text-left transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-card")}
          >
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate" title={view.label}>{figure.label}</span>
              {flag && <span className={cn("shrink-0 rounded-[3px] px-1 text-[10px] leading-4", flag.direction === "up" ? "bg-warning/15 text-warning" : "bg-secondary")}>{flag.kind === "rise" ? "Unusual rise" : flag.direction === "up" ? "Above its range" : "Below its range"}</span>}
            </span>
            <span className="num block truncate text-lg font-semibold leading-tight">{figure.value}</span>
            <span title={figure.sub ?? undefined} className={cn("num block truncate text-[11px]", figure.tone === "positive" ? "text-positive" : figure.tone === "negative" ? "text-negative" : "text-muted-foreground")}>{figure.sub ?? view.label}</span>
          </button>
        );
      })}
    </Frame>
  );
}
