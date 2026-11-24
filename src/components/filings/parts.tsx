// Small pieces shared by the Filings tab and the feed: the form chip, the pager and a quiet note.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formChip, familyOf, type FilingFamily } from "@/lib/filings/kinds";
import type { Page } from "@/lib/filings/list";
import { cn } from "@/lib/utils";

/** Family tint for the form chip: hue marks the family so a column of chips reads at a glance. */
const TINT: Record<FilingFamily, string> = {
  periodic: "border-chart-1/40 text-chart-1",
  current: "border-foreground/25 text-foreground",
  ownership: "border-border text-muted-foreground",
  proxy: "border-chart-6/40 text-chart-6",
  offerings: "border-border text-foreground/80",
  correspondence: "border-chart-5/40 text-chart-5",
  other: "border-border text-muted-foreground",
};

export function FormChip({ form, className }: { form: string; className?: string }) {
  return (
    <span title={form} className={cn("num inline-flex h-5 max-w-full shrink-0 items-center truncate rounded-[4px] border px-1.5 text-[11px] font-medium leading-none", TINT[familyOf(form)], className)}>
      {formChip(form)}
    </span>
  );
}

/** "1–50 of 471" with previous and next buttons; renders nothing when everything fits on one page. */
export function Pager<T>({ p, onPage, label, className }: { p: Page<T>; onPage: (page: number) => void; label: string; className?: string }) {
  if (p.pages <= 1) return null;
  const btn = "inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label={label} className={cn("flex items-center gap-1 text-[12px] text-muted-foreground", className)}>
      <span className="num mr-1">
        {p.from.toLocaleString()}–{p.to.toLocaleString()} of {p.total.toLocaleString()}
      </span>
      <button type="button" className={btn} disabled={p.page <= 1} onClick={() => onPage(p.page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-3.5" /> Previous
      </button>
      <span className="num px-1">
        {p.page} / {p.pages}
      </span>
      <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => onPage(p.page + 1)} aria-label="Next page">
        Next <ChevronRight className="size-3.5" />
      </button>
    </nav>
  );
}

export function QuietLine({ children, className, section }: { children: ReactNode; className?: string; section?: string }) {
  return <p data-section={section} className={cn("px-3.5 py-3 text-[12px] text-muted-foreground", className)}>{children}</p>;
}
