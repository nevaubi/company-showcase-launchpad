import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHECKLIST } from "@/lib/onboarding/core";
import { startTour, useOnboarding } from "@/lib/onboarding/use-onboarding";
import { cn } from "@/lib/utils";

/** Dismissible quick-start card; items tick off automatically as the user does them. */
export function QuickStart() {
  const { data, patch } = useOnboarding();
  if (!data || data.dismissed) return null;
  const done = CHECKLIST.filter((c) => data.checklist?.[c.id]).length;
  if (done === CHECKLIST.length) return null;
  return (
    <section data-section="Quick start" className="mb-5 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Quick start</p>
          <p className="text-xs text-muted-foreground">{done} of {CHECKLIST.length} done · four things worth trying first</p>
        </div>
        <Button size="xs" variant="outline" className="ml-auto" onClick={startTour}>Take the tour</Button>
        <button aria-label="Dismiss quick start" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => patch({ dismissed: true })}><X className="size-4" /></button>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {CHECKLIST.map((c) => {
          const ok = !!data.checklist?.[c.id];
          return (
            <li key={c.id} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs", ok && "text-muted-foreground line-through")}>
              <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", ok && "border-foreground bg-foreground text-background")}>{ok && <Check className="size-3" />}</span>
              {c.label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
