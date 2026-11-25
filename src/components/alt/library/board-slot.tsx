import { Skeleton } from "@/components/ui/skeleton";

/**
 * The place of a "What the data says" board while its tiles load: the board's final height, so the regions
 * under it never move when the charts arrive.
 */
export function BoardSlot({ section, title }: { section: string; title: string }) {
  return (
    <section data-section={section} aria-busy="true" aria-label={title} className="min-w-0">
      <h2 className="mb-2 text-[14px] font-semibold tracking-tight">{title}</h2>
      <div className="grid h-[548px] grid-cols-1 gap-3 overflow-hidden @3xl:h-[528px] @3xl:grid-cols-2 @6xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} aria-hidden className="flex h-[258px] flex-col rounded-md border bg-card p-3 shadow-paper">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
            <Skeleton className="mt-3 flex-1" />
            <Skeleton className="mt-3 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </section>
  );
}
