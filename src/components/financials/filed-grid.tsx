import { useEffect, useRef, type ReactNode } from "react";
import { MISSING } from "./missing";
import { cn } from "@/lib/utils";
import { BLANK, levelClass, labelStyle, splitMark, stripes } from "@/components/ir/table-style";
import "@/components/ir/table.css";

export interface GridColumn {
  key: string;
  top: string;
  bottom?: string;
  /** The newest period: its head is set bold and its column carries a faint tint. */
  latest?: boolean;
}
export interface GridCell {
  text: string;
  title?: string;
  negative?: boolean;
  /** Small marker before the value: derived quarter, calculated, restated */
  mark?: "derived" | "calc" | "restated";
  italic?: boolean;
  onClick?: () => void;
  active?: boolean;
}
export interface GridRow {
  key: string;
  label: string;
  title?: string;
  /**
   * total  a subtotal: semibold, hairline rule over the figures
   * grand  a statement's closing line: bold, firm rule above and a double rule under the figures
   * sub    a breakdown of the line above it (a segment or other member): one level deeper, quieter
   * group  a printed heading with no figures: a banded row
   * spacer a printed gap
   */
  kind?: "total" | "grand" | "sub" | "group" | "spacer";
  /** Printed indent level (0 = flush left). A breakdown sits one level under it. */
  depth?: number;
  /** The view's headline line (not a total): semibold, no rule. */
  emph?: boolean;
  /** A per-share, percentage or ratio line: its figures are set a shade quieter. */
  ratio?: boolean;
  /** A small outlined label after the name (restated, older basis). */
  tag?: string;
  /**
   * What an empty cell means. blank: the table prints the period but nothing on this line (an em space);
   * missing: no document gives a figure for the period (a quiet en dash). Default missing.
   */
  empty?: "blank" | "missing";
  cells: (GridCell | null)[];
}

const MARK: Record<NonNullable<GridCell["mark"]>, string> = { derived: "bg-chart-3", calc: "bg-chart-4", restated: "bg-chart-5" };
const MARK_WORD: Record<NonNullable<GridCell["mark"]>, string> = { derived: "derived quarter", calc: "calculated", restated: "restated" };

/** The kind word a row is set as (data-kind), for tests and the assistant. */
export function gridRowKind(r: GridRow): "head" | "gap" | "line" | "sub" | "grand" | "breakdown" {
  if (r.kind === "group") return "head";
  if (r.kind === "spacer") return "gap";
  if (r.kind === "total") return "sub";
  if (r.kind === "grand") return "grand";
  if (r.kind === "sub") return "breakdown";
  return "line";
}

/**
 * Dense statement grid in the shared statement style (`@/components/ir/table-style`): a quiet head strip
 * with period over date and the newest column marked, banded headings, indents with hairline guides,
 * subtotals and grand totals ruled as printed, faint alternate rows with hover over them, a sticky first
 * column with an edge shadow once scrolled, tabular right-aligned figures, every value clickable to its source.
 */
export function FiledGrid({ head, columns, rows, scrollTo = "end", maxHeight = "70vh", footer }: {
  head: string;
  columns: GridColumn[];
  rows: GridRow[];
  scrollTo?: "start" | "end";
  maxHeight?: string;
  footer?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = scrollTo === "end" ? el.scrollWidth : 0;
    root.current?.toggleAttribute("data-scrolled", el.scrollLeft > 1);
  }, [columns, scrollTo]);
  const banded = stripes(rows.map((r) => ({ kind: r.kind === "group" ? "head" : r.kind === "spacer" ? "gap" : "line" })));
  return (
    <div ref={root} className="irt-root min-w-0 overflow-hidden rounded-lg border bg-card shadow-paper">
      <div
        ref={scroller}
        onScroll={(e) => root.current?.toggleAttribute("data-scrolled", e.currentTarget.scrollLeft > 1)}
        className="overflow-auto overscroll-x-contain scrollbar-thin"
        style={{ maxHeight }}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead className="irt-colhead">
            <tr>
              <th className="irt-fc sticky left-0 top-0 z-30 w-44 min-w-44 max-w-44 px-4 py-2 text-left align-bottom font-medium sm:w-auto sm:min-w-72 sm:max-w-80">{head}</th>
              {columns.map((c) => (
                <th key={c.key} className={cn("sticky top-0 z-20 min-w-24 px-3 py-2 text-right align-bottom font-normal sm:min-w-28", c.latest && "irt-latest")}>
                  <span className="irt-period block text-[11px]">{c.top}</span>
                  {c.bottom && <span className="irt-date num block text-xs">{c.bottom}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="irt-body">
            {rows.map((r, ri) => {
              const kind = gridRowKind(r);
              if (r.kind === "spacer")
                return (
                  <tr key={r.key} aria-hidden data-kind={kind} className="irt-gap">
                    <td colSpan={columns.length + 1} className="h-2 p-0" />
                  </tr>
                );
              const depth = Math.max(0, (r.depth ?? 0) + (r.kind === "sub" ? 1 : 0));
              if (r.kind === "group")
                return (
                  <tr key={r.key} data-kind={kind} className="irt-group">
                    <th scope="rowgroup" colSpan={1} className="irt-fc sticky left-0 z-10 py-1 pr-3 text-left leading-5" style={labelStyle(depth)}>
                      {r.label}
                    </th>
                    <th colSpan={columns.length} aria-hidden className="p-0" />
                  </tr>
                );
              return (
                <tr
                  key={r.key}
                  data-kind={kind}
                  className={cn(
                    "irt-line",
                    levelClass(depth),
                    banded[ri] && "irt-stripe",
                    r.kind === "total" && "irt-sub",
                    r.kind === "grand" && "irt-grand",
                    r.ratio && "irt-ratio",
                  )}
                >
                  <th
                    scope="row"
                    title={r.title}
                    className={cn(
                      "irt-fc sticky left-0 z-10 max-w-44 py-1 pr-3 text-left [overflow-wrap:anywhere] sm:max-w-80 sm:truncate",
                      r.emph ? "font-semibold" : "font-normal",
                      r.kind === "sub" && "text-muted-foreground",
                    )}
                    style={labelStyle(depth)}
                  >
                    {r.label}
                    {r.tag && <span className="irt-tag">{r.tag}</span>}
                  </th>
                  {r.cells.map((c, i) => {
                    const latest = columns[i]?.latest;
                    if (!c) {
                      const blank = r.empty === "blank";
                      return (
                        <td
                          key={i}
                          title={blank ? "The filing prints no figure here" : "No figure for this period"}
                          className={cn("num irt-missing px-3 py-1 text-right", latest && "irt-latest")}
                          style={MISSING}
                        >
                          {blank ? BLANK : "–"}
                        </td>
                      );
                    }
                    const [figure, unit] = splitMark(c.text, c.text.endsWith("%") ? "%" : c.text.endsWith("×") ? "×" : "");
                    return (
                      <td
                        key={i}
                        title={c.title}
                        tabIndex={c.onClick ? 0 : undefined}
                        onClick={c.onClick}
                        onKeyDown={(e) => e.key === "Enter" && c.onClick?.()}
                        className={cn(
                          "num relative px-3 py-1 text-right tabular-nums",
                          r.emph && "font-semibold",
                          latest && "irt-latest",
                          c.negative && "text-negative",
                          c.italic && "italic",
                          c.onClick && "cursor-pointer hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        )}
                        style={c.active ? { backgroundColor: "var(--highlight-soft)" } : undefined}
                      >
                        {c.mark && (
                          <>
                            <span aria-hidden className={cn("absolute left-1 top-2 size-1 rounded-full", MARK[c.mark])} />
                            <span className="sr-only">({MARK_WORD[c.mark]}) </span>
                          </>
                        )}
                        {figure}
                        {unit && <span className="irt-mark">{unit}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
