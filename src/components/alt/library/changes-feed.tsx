import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HrefLink } from "./href-link";
import type { ChangeLine } from "./overview";

/**
 * What changed: publication events grouped by hour, publisher and kind, newest first. A group of one opens its
 * table at the snapshot it names; a larger group opens that publisher's tables, newest first.
 */
export function ChangesFeed({ lines, loading }: { lines: ChangeLine[]; loading?: boolean }) {
  return (
    <section data-section="What changed" className="min-w-0 rounded-md border bg-card shadow-paper">
      <header className="flex items-baseline gap-2 border-b px-3.5 py-2">
        <h2 className="text-[14px] font-semibold tracking-tight">What changed</h2>
        <p className="text-[11px] text-muted-foreground">Publications in this library, newest first, UTC</p>
      </header>
      {loading ? (
        <ul aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex h-[41px] items-center gap-3 border-b px-3.5 last:border-b-0">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 flex-1" />
            </li>
          ))}
        </ul>
      ) : lines.length ? (
        <ul>
          {lines.map((l) => (
            <li key={l.key} className="border-b last:border-b-0">
              <HrefLink
                href={l.href}
                className="group grid min-h-[41px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-1.5 transition-colors duration-150 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @md:grid-cols-[9.5rem_4.5rem_minmax(0,1fr)_auto]"
              >
                <span className="num col-span-1 text-[11px] text-muted-foreground @md:col-span-1">{l.when}</span>
                <span className="hidden truncate text-[13px] font-medium @md:block">{l.publisher}</span>
                <span className={cn("col-start-1 min-w-0 truncate text-[13px] @md:col-start-3", l.kind === "first" && "text-muted-foreground")}>
                  <span className="font-medium @md:hidden">{l.publisher} · </span>
                  {l.text}
                </span>
                <ChevronRight aria-hidden className="col-start-2 row-span-2 row-start-1 size-3.5 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 @md:col-start-4 @md:row-span-1" />
              </HrefLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-3 text-[13px] text-muted-foreground">No publications are recorded yet.</p>
      )}
      <footer className="border-t px-3.5 py-2">
        <Link
          to="/app/alt-data/library"
          search={{ view: "changes" }}
          className="inline-flex min-h-7 items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Every table by its latest publication
          <ChevronRight aria-hidden className="size-3" />
        </Link>
      </footer>
    </section>
  );
}
