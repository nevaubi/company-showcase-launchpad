import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { useCompanyAlt } from "@/components/alt/alt-company";
import { snapshotFigures } from "@/lib/alt/company";
import { cn } from "@/lib/utils";

/** Tiles the snapshot always lays out, so it keeps one height from the first paint to the last. */
const SLOTS = 6;
const tileBorder = (i: number) => cn("border-b", i % 3 !== 0 && "xl:border-l", i % 2 === 1 && "sm:max-xl:border-l");

function Frame({ ticker, note, children }: { ticker: string; note: string; children: ReactNode }) {
  return (
    <section data-section="Alt data snapshot" className="min-w-0 rounded-md border bg-card shadow-paper">
      <header className="flex h-[52px] items-center gap-3 border-b px-3.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">Alternative data</h2>
          <p className="truncate text-[11px] text-muted-foreground">{note}</p>
        </div>
        <Link to="/app/companies/$ticker/alt-data" params={{ ticker }} className="ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[4px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
          All alt data <ArrowUpRight className="size-3" />
        </Link>
      </header>
      <div className="-mb-px grid grid-cols-1 overflow-hidden rounded-b-md sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * The company's most telling alt-data figures for the Overview (up to six, each with its period and
 * a click to its source), with unusual readings first: a flagged dataset's tile is the flagged
 * reading itself. It reserves its full height while loading (six tiles), so nothing below it moves
 * when the figures arrive; it renders nothing on error or when the company has no alt data.
 */
export function AltSnapshot({ ticker }: { ticker: string }) {
  const t = ticker.toUpperCase();
  const { q, alt } = useCompanyAlt(t);
  const { open } = useSource();
  if (q.isLoading) {
    return (
      <Frame ticker={t} note="Reading public datasets">
        {Array.from({ length: SLOTS }, (_, i) => (
          <div key={i} className={cn("h-[62px] px-3.5 py-2", tileBorder(i))}>
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
    <Frame ticker={t} note={`${alt.flags.length ? `${alt.flags.length} unusual against its own history · ` : ""}${alt.views.length} public datasets on file`}>
      {Array.from({ length: SLOTS }, (_, i) => {
        const it = items[i];
        if (!it) return <div key={`empty${i}`} aria-hidden className={cn("h-[62px]", tileBorder(i))} />;
        const { view, figure, flag } = it;
        const src = figure.rows.find((r) => r.source_url);
        return (
          <button
            key={view.dataset}
            type="button"
            disabled={!src}
            onClick={() => src?.source_url && open({ ticker: t, label: `${view.label}: ${figure.label}`, unit: src.unit ?? "", value: src.value ?? 0, external: { url: src.source_url, date: src.date ?? undefined } })}
            title={flag ? `${flag.text}. ${flag.rule}` : `Source: ${figure.label}`}
            className={cn("h-[62px] min-w-0 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent", tileBorder(i))}
          >
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate" title={view.label}>{figure.label}</span>
              {flag && <span className={cn("shrink-0 rounded-[3px] px-1 text-[10px] leading-4", flag.direction === "up" ? "bg-warning/15 text-warning" : "bg-secondary")}>{flag.kind === "rise" ? "Unusual rise" : flag.direction === "up" ? "Above its range" : "Below its range"}</span>}
            </span>
            <span className="num block truncate text-lg font-semibold leading-tight">{figure.value}</span>
            <span className={cn("num block truncate text-[11px]", figure.tone === "positive" ? "text-positive" : figure.tone === "negative" ? "text-negative" : "text-muted-foreground")}>{figure.sub ?? view.label}</span>
          </button>
        );
      })}
    </Frame>
  );
}
