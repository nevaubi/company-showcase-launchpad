// 5. Margins and expense mix of a non-bank: margin lines only where the company prints them as percentages (none is
// computed here), and an expense section stacked where its lines add up to the printed total.
import { cn } from "@/lib/utils";
import { VizNote } from "./parts";
import { SectionChart } from "./section-chart";
import type { MarginPanelProps } from "./types";

export function MarginPanel({ figures, scale, onOpen, className }: MarginPanelProps) {
  if (!figures) return null;
  return (
    <div className={cn("@container grid min-w-0 grid-cols-1 gap-6 @3xl:grid-cols-2", className)}>
      <section aria-label="Margins" className="min-w-0">
        <h3 className="text-[13px] font-medium leading-5">Margins</h3>
        {figures.margins.length ? (
          <>
            <p className="mb-1 text-[11px] leading-4 text-muted-foreground">As printed, in percent.</p>
            <SectionChart title="Margins" series={figures.margins} scale={scale} onOpen={onOpen} height={170} />
          </>
        ) : (
          <VizNote>The company prints no margin as a percentage, and none is computed here.</VizNote>
        )}
      </section>
      <section aria-label={figures.expenses?.label ?? "Expenses"} className="min-w-0">
        <h3 className="text-[13px] font-medium leading-5">{figures.expenses?.label ?? "Expenses"}</h3>
        {figures.expenses ? (
          <>
            <p className="mb-1 text-[11px] leading-4 text-muted-foreground">The printed lines, stacked where they add up to the printed total.</p>
            <SectionChart title={figures.expenses.label} series={figures.expenses.parts} parts={figures.expenses} view="stacked" scale={scale} onOpen={onOpen} height={170} />
          </>
        ) : (
          <VizNote>No expense section adds up to its printed total.</VizNote>
        )}
      </section>
    </div>
  );
}
