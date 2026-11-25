import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { statedUnit, type FieldRole } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import { columnHead } from "./columns-model";
import { count } from "./dataset-model";
import { MAX_COLUMNS } from "./dataset-search";
import { FactList, FillMeter } from "./ui/primitives";

/** A definition as a reader can read it: spreadsheet line-break codes become line breaks. */
export function definitionText(text: string | undefined): string {
  return (text ?? "").replace(/_x000D_/gi, "\n").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const ROLE_WORDS: Record<FieldRole, string> = {
  quantity: "A quantity: numbers are grouped, never rescaled",
  identifier: "An identifier: shown exactly as stored",
  date: "A date or period: shown exactly as stored",
  code: "A code: shown exactly as stored",
  text: "Text: shown exactly as stored",
  unknown: "Not stated: shown exactly as stored",
};

export function FieldSheet({
  column,
  position,
  role,
  fill,
  dimension,
  inTable,
  tableCount,
  onAdd,
  onClose,
}: {
  column: SourceColumn | null;
  position: number;
  role: FieldRole;
  fill: SourceFieldFill | null;
  dimension: string | null;
  inTable: boolean;
  tableCount: number;
  onAdd: () => void;
  onClose: () => void;
}) {
  const open = column !== null;
  const head = column ? columnHead(column) : null;
  const unit = column ? statedUnit(column) : null;
  const items = column
    ? [
        { label: "Position", value: <span className="num">{position + 1}</span> },
        { label: "Code (header)", value: <span className="num">{head!.code}</span> },
        ...(column.key !== head!.code ? [{ label: "Key in the store", value: <span className="num">{column.key}</span> }] : []),
        { label: "Unit", value: unit ?? (column.unit ? `${column.unit} (states no unit)` : "Not stated") },
        ...(column.unit_evidence ? [{ label: "Unit evidence", value: column.unit_evidence }] : []),
        ...(column.basis ? [{ label: "Basis", value: column.basis }] : []),
        ...(column.period_basis ? [{ label: "Period basis", value: column.period_basis }] : []),
        { label: "Type", value: column.native_type ? `${column.native_type} (publisher)` : `${column.type} (as stored)` },
        { label: "Read as", value: ROLE_WORDS[role] },
        ...(dimension ? [{ label: "Index", value: `This field is the table's ${dimension}` }] : []),
        {
          label: "Filled",
          value: fill ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <FillMeter share={fill.share} />
              <span className="text-[11px] text-muted-foreground">
                {count(fill.filled)} filled, {count(fill.blank)} empty
              </span>
            </span>
          ) : (
            "Not counted for this version"
          ),
        },
      ]
    : [];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[30rem]" data-section="Field">
        {column && head && (
          <>
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="pr-8 text-sm font-semibold leading-5">{head.title}</SheetTitle>
              <SheetDescription className="text-[11px]">Field {position + 1} of the dictionary, as the publisher describes it.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <FactList items={items} />
              <h3 className="mt-4 text-[13px] font-semibold">Definition</h3>
              <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-muted-foreground">
                {definitionText(column.description) || "The dictionary gives no definition."}
              </p>
            </div>
            <div className="flex items-center gap-2 border-t px-4 py-2.5">
              <span className="text-[11px] text-muted-foreground">
                {inTable ? "Shown in the records table." : tableCount >= MAX_COLUMNS ? `The table already shows ${MAX_COLUMNS} fields.` : ""}
              </span>
              {!inTable && (
                <Button size="sm" className="ml-auto h-8 text-[13px]" disabled={tableCount >= MAX_COLUMNS} onClick={onAdd}>
                  Add to the table
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
