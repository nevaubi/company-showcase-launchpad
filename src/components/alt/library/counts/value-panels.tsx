import { fieldTitle } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import { BarList } from "../ui/bar-list";
import type { CategoryChart } from "./category-model";
import { fillCaption, fillCells, fillPct } from "./fill-model";
import { FillStrip } from "./fill-strip";
import { CountPanel, CountTable, PanelNote } from "./panel";

/**
 * Records by one category: its ten most common stored values and all other values, most first. A value opens the
 * first record that holds it (the records table filters by entity, place and period only).
 */
export function CategoryPanel({ chart, view, onOpen }: { chart: CategoryChart; view: "chart" | "table"; onOpen?: (row: number) => void }) {
  const bars = chart.bars.map((b) => ({ ...b, quiet: b.row === null, inert: b.row === null }));
  return (
    <CountPanel name="Records by category" title={`Records by ${chart.title}`} code={chart.code} caption={chart.caption}>
      {view === "chart" ? (
        <BarList
          bars={bars}
          label={`Records by ${chart.title}`}
          labelWidth="minmax(0,8rem)"
          valueWidth="4.75rem"
          onSelect={onOpen ? (b) => {
            const row = chart.bars.find((x) => x.key === b.key)?.row;
            if (row) onOpen(row);
          } : undefined}
        />
      ) : (
        <CountTable head={["Value", "Records"]} rows={chart.bars.map((b) => ({ key: b.key, label: b.label, sub: b.sub, text: b.text }))} />
      )}
    </CountPanel>
  );
}

/** How complete the fields are: the heat strip, or its table of every field with its share. */
export function FillPanel({ fills, columns, view }: { fills: SourceFieldFill[] | null; columns: SourceColumn[]; view: "chart" | "table" }) {
  const name = "Filled share";
  const title = "How complete the fields are";
  if (!fills) return <PanelNote name={name} title={title}>This version stores no counts of empty cells.</PanelNote>;
  const cells = fillCells(fills, columns);
  return (
    <CountPanel name={name} title={title} caption={`${fillCaption(cells)} From the counts stored with this version; no record is read.`}>
      {view === "chart" ? (
        <FillStrip cells={cells} label="Share of records with a value, one cell per field in file order" />
      ) : (
        <CountTable
          head={["Field", "Filled"]}
          rows={cells.map((c) => ({ key: String(c.position), label: fieldTitle(columns[c.position]), sub: c.code ?? undefined, text: fillPct(c.share) }))}
        />
      )}
    </CountPanel>
  );
}
