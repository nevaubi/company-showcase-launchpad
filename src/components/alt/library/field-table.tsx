import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { statedUnit, type FieldRole } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { useWindowRange } from "@/lib/screener/window";
import { cn } from "@/lib/utils";
import { columnHead, dimensionOf, matchField, searchWords } from "./columns-model";
import { count } from "./dataset-model";
import { definitionText, FieldSheet } from "./field-sheet";
import { FillMeter, LibrarySection, PANEL } from "./ui/primitives";

const ROW_H = 29;
const WINDOW_FROM = 200;
const NO_UNIT = "No stated unit";

/** Unit chips for the summary line: every stated unit with its field count, largest first, then the rest. */
export function unitCounts(columns: SourceSnapshot["columns"]): { unit: string; n: number }[] {
  const by = new Map<string, number>();
  for (const c of columns) {
    const u = statedUnit(c) ?? NO_UNIT;
    by.set(u, (by.get(u) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([unit, n]) => ({ unit, n }))
    .sort((a, b) => (a.unit === NO_UNIT ? 1 : b.unit === NO_UNIT ? -1 : b.n - a.n || a.unit.localeCompare(b.unit)));
}

/**
 * The dictionary as a section: searchable by every word, filterable by unit, windowed against the page scroll so
 * a 2,379-field table keeps its sticky head on the page. A row opens the field's full description.
 */
export function FieldsSection({
  snapshot,
  roles,
  fills,
  shown,
  onAdd,
}: {
  snapshot: SourceSnapshot;
  roles: FieldRole[];
  fills: SourceFieldFill[] | null;
  shown: number[];
  onAdd: (position: number) => void;
}) {
  const [find, setFind] = useState("");
  const [unit, setUnit] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const dims = useMemo(() => dimensionOf(snapshot.ingest), [snapshot.ingest]);
  const units = useMemo(() => unitCounts(snapshot.columns), [snapshot.columns]);
  const words = searchWords(find);
  const list = useMemo(
    () =>
      snapshot.columns
        .map((column, position) => ({ column, position }))
        .filter(({ column }) => (unit === null || (statedUnit(column) ?? NO_UNIT) === unit) && matchField(column, words)),
    [snapshot.columns, unit, words],
  );
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  // up to WINDOW_FROM fields are all in the page; a longer dictionary is windowed against the page scroll
  const windowed = useWindowRange(body, list.length, ROW_H);
  const [from, to] = list.length <= WINDOW_FROM ? [0, list.length] : windowed;
  const showUnits = units.length > 1 || units[0]?.unit !== NO_UNIT;
  return (
    <LibrarySection
      id="fields"
      name="Fields"
      title={`Fields (${count(snapshot.columns.length)})`}
      meta={fills ? "Filled share from the counts stored with this version" : "Filled share not counted for this version"}
    >
      <div className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Search code, title, unit or definition"
              aria-label="Search fields"
              className="h-8 w-72 max-w-full pl-7 text-[13px]"
            />
          </div>
          {showUnits && (
            <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filter fields by unit">
              {units.slice(0, 8).map((u) => (
                <button
                  key={u.unit}
                  type="button"
                  aria-pressed={unit === u.unit}
                  onClick={() => setUnit((cur) => (cur === u.unit ? null : u.unit))}
                  className={cn(
                    "inline-flex min-h-7 max-w-[16rem] items-center gap-1.5 rounded-md border px-2 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    unit === u.unit ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">{u.unit}</span>
                  <span className="num text-[11px]">{count(u.n)}</span>
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {words.length || unit ? `${count(list.length)} of ${count(snapshot.columns.length)} fields` : ""}
          </span>
        </div>
        <div className={PANEL} data-section="Field dictionary">
          {/* wide screens: no scroll container, so the head sticks to the page; phones: sideways inside this wrapper */}
          <div className="max-md:overflow-x-auto">
            <table className="w-full min-w-[54rem] table-fixed border-separate border-spacing-0 text-[13px] md:min-w-0">
              <colgroup>
                <col style={{ width: 56 }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 132 }} />
                <col />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  {["#", "Field", "Code", "Unit", "Type", "Filled", "Definition"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "sticky top-[var(--library-top,6.125rem)] z-[2] h-8 border-b bg-card px-3 font-normal",
                        i === 0 && "text-right",
                        i === 0 && "rounded-tl-md",
                        i === 6 && "rounded-tr-md",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={setBody}>
                {from > 0 && (
                  <tr aria-hidden style={{ height: from * ROW_H }}>
                    <td colSpan={7} />
                  </tr>
                )}
                {list.slice(from, to).map(({ column, position }) => {
                  const head = columnHead(column);
                  const fill = fills?.[position] ?? null;
                  const def = definitionText(column.description).replace(/\n+/g, " ");
                  return (
                    <tr
                      key={position}
                      style={{ height: ROW_H }}
                      className={cn("cursor-pointer hover:bg-secondary/60", shown.includes(position) && "bg-secondary/30")}
                      onClick={() => setOpen(position)}
                    >
                      <td className="num border-b px-3 text-right text-muted-foreground">{position + 1}</td>
                      <td className="truncate border-b px-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(position);
                          }}
                          className="max-w-full truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={head.title}
                        >
                          {head.title}
                        </button>
                      </td>
                      <td className="num truncate border-b px-3 text-muted-foreground" title={head.code}>
                        {head.code}
                      </td>
                      <td className="truncate border-b px-3" title={column.unit || undefined}>
                        {statedUnit(column) ?? <span className="text-muted-foreground">–</span>}
                      </td>
                      <td className="truncate border-b px-3 text-muted-foreground" title={column.native_type ? "as the publisher types it" : "as the store types it"}>
                        {column.native_type || column.type}
                      </td>
                      <td className="border-b px-3">{fill ? <FillMeter share={fill.share} title={`${count(fill.filled)} filled, ${count(fill.blank)} empty`} /> : <span className="text-muted-foreground">–</span>}</td>
                      <td className="truncate border-b px-3 text-muted-foreground" title={def || undefined}>
                        {def || "–"}
                      </td>
                    </tr>
                  );
                })}
                {to < list.length && (
                  <tr aria-hidden style={{ height: (list.length - to) * ROW_H }}>
                    <td colSpan={7} />
                  </tr>
                )}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={7} className="h-16 px-3 text-muted-foreground">
                      No field matches{find ? ` "${find}"` : ""}
                      {unit ? ` with the unit ${unit}` : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <FieldSheet
        column={open === null ? null : snapshot.columns[open]}
        position={open ?? 0}
        role={open === null ? "unknown" : roles[open]}
        fill={open === null ? null : (fills?.[open] ?? null)}
        dimension={open === null ? null : (dims.get(open) ?? null)}
        inTable={open !== null && shown.includes(open)}
        tableCount={shown.length}
        onAdd={() => {
          if (open !== null) onAdd(open);
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
    </LibrarySection>
  );
}
