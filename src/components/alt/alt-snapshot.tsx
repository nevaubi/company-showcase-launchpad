import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { useCompanyAlt } from "@/components/alt/alt-company";
import { snapshotFigures } from "@/lib/alt/company";
import { cn } from "@/lib/utils";

/**
 * The company's most telling alt-data figures for the Overview (three to six, each with its period
 * and a click to its source), with unusual readings first and a link to the Alt data tab. Renders
 * nothing while loading, on error, or when the company has no alt data.
 */
export function AltSnapshot({ ticker }: { ticker: string }) {
  const t = ticker.toUpperCase();
  const { alt } = useCompanyAlt(t);
  const { open } = useSource();
  if (!alt?.views.length) return null;
  const items = snapshotFigures(alt, 6);
  if (!items.length) return null;
  return (
    <section data-section="Alt data snapshot" className="min-w-0 rounded-md border bg-card shadow-paper">
      <header className="flex items-center gap-3 border-b px-3.5 py-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">Alternative data</h2>
          <p className="truncate text-[11px] text-muted-foreground">{alt.flags.length ? `${alt.flags.length} unusual against its own history · ` : ""}{alt.views.length} public datasets on file</p>
        </div>
        <Link to="/app/companies/$ticker/alt-data" params={{ ticker: t }} className="ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[4px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
          All alt data <ArrowUpRight className="size-3" />
        </Link>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ view, figure, flag }, i) => {
          const src = figure.rows.find((r) => r.source_url);
          return (
            <button
              key={view.dataset}
              type="button"
              disabled={!src}
              onClick={() => src?.source_url && open({ ticker: t, label: `${view.label}: ${figure.label}`, unit: src.unit ?? "", value: src.value ?? 0, external: { url: src.source_url, date: src.date ?? undefined, quote: figure.formula } })}
              title={flag ? flag.text : `Source: ${figure.label}`}
              className={cn("min-w-0 border-b px-3.5 py-2 text-left transition-colors duration-150 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent", i % 3 !== 0 && "xl:border-l", i % 2 === 1 && "sm:max-xl:border-l")}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate" title={view.label}>{figure.label}</span>
                {flag && <span className={cn("shrink-0 rounded-[3px] px-1 text-[10px] leading-4", flag.direction === "up" ? "bg-warning/15 text-warning" : "bg-secondary")}>{flag.direction === "up" ? "Unusually high" : "Unusually low"}</span>}
              </span>
              <span className="num block truncate text-lg font-semibold leading-tight">{figure.value}</span>
              <span className={cn("num block truncate text-[11px]", figure.tone === "positive" ? "text-positive" : figure.tone === "negative" ? "text-negative" : "text-muted-foreground")}>{figure.sub ?? view.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
