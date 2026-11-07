// Datawrapper-style frame for canvas views: title, subtitle, chart, source line, and an accessible
// toggle that swaps the graphic for the data table behind it.
import { useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtValue, type Unit } from "./format";

export interface FigureTable {
  columns: string[];
  rows: (string | number | null)[][];
}

export function Figure({
  title,
  subtitle,
  source,
  unit,
  table,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  source?: string;
  unit?: Unit;
  table?: FigureTable | null;
  children: ReactNode;
  className?: string;
}) {
  const [showData, setShowData] = useState(false);
  return (
    <figure className={cn("min-w-0", className)} aria-label={title}>
      {(title || subtitle || table) && (
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {title && <figcaption className="text-[13px] font-semibold leading-snug text-foreground">{title}</figcaption>}
            {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{subtitle}</p>}
          </div>
          {table && (
            <button
              type="button"
              onClick={() => setShowData((s) => !s)}
              aria-pressed={showData}
              className={cn("flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", showData && "bg-muted text-foreground")}
            >
              <Table2 className="size-3" /> {showData ? "Chart" : "Data"}
            </button>
          )}
        </div>
      )}
      {showData && table ? <DataTable table={table} unit={unit} caption={title} /> : children}
      {source && <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">Source: {source}</p>}
    </figure>
  );
}

export function DataTable({ table, unit, caption }: { table: FigureTable; unit?: Unit; caption?: string }) {
  const numeric = table.columns.map((_, i) => table.rows.every((r) => r[i] == null || typeof r[i] === "number"));
  return (
    <div className="max-h-80 overflow-auto rounded-md border scrollbar-thin">
      <table className="w-full border-collapse text-[11.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-muted/90 backdrop-blur">
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={cn("whitespace-nowrap border-b px-2 py-1 text-left text-[10.5px] font-medium text-muted-foreground", numeric[i] && "text-right")}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((v, j) => (
                <td key={j} className={cn("px-2 py-1", numeric[j] && "num text-right tabular-nums")}>{typeof v === "number" ? fmtValue(v, j === 0 ? "" : unit, { digits: 2 }) : (v ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small swatch legend, Datawrapper style (above the plot). */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-[3px] w-3 rounded-full", it.dashed && "h-0 border-t-2 border-dashed")} style={it.dashed ? { borderColor: it.color } : { background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
