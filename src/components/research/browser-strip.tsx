import { useState } from "react";
import { AppWindow, ChevronDown, PanelRight } from "lucide-react";
import { BrowserCard, useRunPolling } from "@/components/research/canvas";
import { canvas, useCanvas } from "@/lib/research/views";
import { cn } from "@/lib/utils";

/** Live cloud browsers shown inside the chat panel (assistant and OfficeAI). */
export function BrowserStrip({ canOpenCanvas }: { canOpenCanvas?: boolean }) {
  const { runs } = useCanvas();
  useRunPolling(runs);
  const [open, setOpen] = useState(true);
  const recent = runs.filter((r) => !r.done || Date.now() - r.startedAt < 30 * 60_000).slice(-4).reverse();
  if (!recent.length) return null;
  const live = recent.filter((r) => !r.done).length;
  return (
    <div className="border-t bg-muted/20" data-section="Browsers">
      <div className="flex h-7 items-center gap-1.5 px-2.5 text-[11px]">
        <AppWindow className="size-3 text-muted-foreground" />
        <span className="font-medium">Browsers</span>
        <span className="text-muted-foreground">{live ? `${live} live` : "done"}</span>
        {canOpenCanvas && (
          <button className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => canvas.show("browser")} title="Open in canvas">
            <PanelRight className="size-3" /> Canvas
          </button>
        )}
        <button className={cn("text-muted-foreground hover:text-foreground", !canOpenCanvas && "ml-auto")} onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse browsers" : "Expand browsers"}>
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      {open && (
        <div className={cn("grid max-h-[46vh] grid-cols-1 gap-2 overflow-y-auto px-2 pb-2", recent.length > 1 && "@md:grid-cols-2")}>
          {recent.map((r) => <BrowserCard key={r.id} r={r} single={recent.length === 1} />)}
        </div>
      )}
    </div>
  );
}
