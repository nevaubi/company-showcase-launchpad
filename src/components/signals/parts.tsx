// Small pieces shared by the signals pages: table cell classes (28 px rows, tabular figures), side
// and grade tags, a sortable column head and a labelled select for the filter row.
import type { ReactNode } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Grade } from "@/lib/signals/evidence";
import { GRADE_LABEL, sideLabel } from "@/lib/signals/format";
import { cn } from "@/lib/utils";

/** Column head: 11 px caption, bottom-aligned so two-line heads share a baseline. */
export const TH = "px-2 py-1.5 text-left align-bottom text-[11px] font-normal leading-4 text-muted-foreground";
/** Body cell: 13 px on a 20 px line with 4 px above and below, so a row is 28 px. */
export const TD = "px-2 py-1 align-middle text-[13px] leading-5";
/** Numeric cell: tabular figures, right-aligned, never wrapped. */
export const NUM = "num whitespace-nowrap text-right";
/** Caption under or beside a value. */
export const CAPTION = "text-[11px] leading-4 text-muted-foreground";

export function SideTag({ side, className }: { side: 1 | -1; className?: string }) {
  const Icon = side > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap align-top font-medium", side > 0 ? "text-positive" : "text-negative", className)}>
      <Icon className="size-3.5" aria-hidden />
      {sideLabel(side)}
    </span>
  );
}

const GRADE_TONE: Record<Grade, string> = {
  proven: "border-positive/50 text-positive",
  candidate: "border-foreground/40 text-foreground",
  watch: "border-border text-foreground",
  probation: "border-negative/50 text-negative",
  unproven: "border-border text-muted-foreground",
};

const GRADE_HELP: Record<Grade, string> = {
  proven: "Passes all eight checks of the strict gate and stands out from every rule tried on its monthly record",
  candidate: "Stands out from every rule tried at a 5% false-discovery rate",
  watch: "Stands out from every rule tried at a 10% false-discovery rate",
  probation: "Would be listed, but its live record is well below its backtest",
  unproven: "Cannot be told apart from luck, so its signals are not on the short list",
};

export function GradeTag({ grade, className }: { grade: Grade; className?: string }) {
  return (
    <span title={GRADE_HELP[grade]} className={cn("inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-[11px] leading-none", GRADE_TONE[grade], className)}>
      {GRADE_LABEL[grade]}
    </span>
  );
}

export interface SortState<K extends string> {
  key: K;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}

/** A column head that sorts the table; the arrow shows on the active column only. */
export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  align = "right",
  title,
  className,
}: {
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  children: ReactNode;
  align?: "left" | "right";
  title?: string;
  className?: string;
}) {
  const active = sort.key === k;
  const Arrow = sort.dir > 0 ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir > 0 ? "ascending" : "descending") : "none"} className={cn(TH, align === "right" && "text-right", className)}>
      <button
        type="button"
        data-agent-click
        title={title}
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex min-h-7 items-end gap-0.5 rounded-sm text-inherit transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse text-right",
          active && "font-medium text-foreground",
        )}
      >
        <span className="whitespace-nowrap">{children}</span>
        <Arrow className={cn("mb-0.5 size-3 shrink-0", !active && "invisible")} aria-hidden />
      </button>
    </th>
  );
}

/** A select with its label in front, for the one row of filters. */
export function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { v: T; l: string }[];
  className?: string;
}) {
  return (
    <label className={cn("inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span className="shrink-0">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger aria-label={label} className="h-7 min-w-[7.5rem] gap-1 rounded-md px-2 text-xs text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v} className="text-xs">
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** One figure with its label: the unit of the compact strips in row details. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className={CAPTION}>{label}</div>
      <div className="num text-[13px] leading-5">{children}</div>
    </div>
  );
}
