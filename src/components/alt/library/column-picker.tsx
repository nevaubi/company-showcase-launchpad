import { useEffect, useMemo, useState } from "react";
import { Columns3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { SourceColumn, SourceIngest } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { MAX_COLUMNS } from "./dataset-search";
import { columnHead, fieldGroups, pickerRows, toggle } from "./columns-model";

const ROW = 36;
const OVERSCAN = 12;

/**
 * Which fields the records table shows. Ticks are a draft until Apply, so ticking reads nothing (rev-app S10) and
 * a search inside the list never loses them. Up to 24 fields; the list is windowed inside the sheet.
 */
export function ColumnPicker({
  columns,
  ingest,
  selected,
  defaults,
  onApply,
}: {
  columns: SourceColumn[];
  ingest: SourceIngest;
  selected: number[];
  defaults: number[];
  onApply: (positions: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(selected);
  const [find, setFind] = useState("");
  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);
  const rows = useMemo(() => pickerRows(fieldGroups(columns, ingest, draft, find)), [columns, ingest, draft, find]);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 40]);
  useEffect(() => {
    if (!scroller) return;
    const calc = () => {
      const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
      const last = Math.min(rows.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW) + OVERSCAN);
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    calc();
    scroller.addEventListener("scroll", calc, { passive: true });
    const ro = new ResizeObserver(calc);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", calc);
      ro.disconnect();
    };
  }, [scroller, rows.length]);
  const full = draft.length >= MAX_COLUMNS;
  const changed = draft.join(",") !== selected.join(",");

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Columns3 className="size-3.5" aria-hidden />
        Fields <span className="num">{selected.length}</span> of <span className="num">{columns.length.toLocaleString("en-US")}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[30rem]" data-section="Field picker">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-sm font-semibold">Fields in the table</SheetTitle>
            <SheetDescription className="text-[11px]">
              Tick up to {MAX_COLUMNS}. Nothing is read until you apply. Every field stays in the record sheet.
            </SheetDescription>
          </SheetHeader>
          <div className="border-b px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={`Search ${columns.length.toLocaleString("en-US")} fields by code, title, unit or definition`}
                aria-label="Search fields"
                className="h-8 pl-7 text-[13px]"
              />
            </div>
          </div>
          <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto" role="group" aria-label="Fields">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-muted-foreground">No field matches "{find}".</p>
            ) : (
              <div style={{ height: rows.length * ROW, position: "relative" }}>
                {rows.slice(range[0], range[1]).map((r, i) => {
                  const top = (range[0] + i) * ROW;
                  if (r.kind === "head")
                    return (
                      <div key={`h-${r.group.id}`} style={{ top, height: ROW }} className="absolute inset-x-0 flex items-end px-4 pb-1.5">
                        <span className="eyebrow truncate text-muted-foreground">
                          {r.group.label} · {r.group.items.length.toLocaleString("en-US")}
                        </span>
                      </div>
                    );
                  const p = r.item.position;
                  const checked = draft.includes(p);
                  const head = columnHead(r.item.column);
                  const id = `pick-${p}`;
                  return (
                    <label
                      key={`i-${r.group}-${p}`}
                      htmlFor={id}
                      style={{ top, height: ROW }}
                      className={cn(
                        "absolute inset-x-0 flex cursor-pointer items-center gap-2.5 px-4 text-[13px] hover:bg-secondary/60",
                        !checked && full && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={!checked && full}
                        onCheckedChange={() => setDraft((d) => toggle(d, p, MAX_COLUMNS))}
                      />
                      <span className="min-w-0 flex-1 truncate" title={r.item.column.description || head.title}>
                        {head.title}
                      </span>
                      {head.code !== head.title && <span className="num shrink-0 text-[11px] text-muted-foreground">{head.code}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {draft.length} of {MAX_COLUMNS} chosen{full ? ": untick one to add another" : ""}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto h-8 text-[13px]" onClick={() => setDraft(defaults)}>
              Default fields
            </Button>
            <Button
              size="sm"
              className="h-8 text-[13px]"
              disabled={!draft.length || !changed}
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
