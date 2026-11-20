// Relation filter chips shared by the supply-chain page and its preview: each chip toggles one relation on the map.
import { RELATIONS, type Relation } from "@/lib/supply/core";
import { cn } from "@/lib/utils";
import { RELATION_LABEL } from "./supply-map-meta";
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
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-paper transition-[background-color,color,border-color] duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              on ? "bg-card text-foreground" : "border-dashed bg-transparent text-muted-foreground shadow-none",
            )}
          >
            <RelationMark relation={r} size={9} hollow={!on} />
            {RELATION_LABEL[r]}
            <span className="num text-muted-foreground">{loading ? "…" : counts[r]}</span>
          </button>
        );
      })}
    </div>
  );
}
