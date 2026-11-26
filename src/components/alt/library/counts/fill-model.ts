/**
 * How complete the fields are, pure: one cell per field in dictionary order, its shade the band of the share of
 * records with a value (the counts stored with the snapshot; no record is read). Five bands, one hue, darker for
 * fuller; an empty field is an outline, not a pale shade, so "empty" never reads as "a little".
 */
import { fieldCode, fieldTitle } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import { FILL_BANDS } from "../coverage-model";

export type FillCell = {
  position: number;
  title: string;
  code: string | null;
  share: number;
  filled: number;
  blank: number;
  /** Index into `FILL_BANDS`: 0 full, 4 empty. */
  band: number;
  /** Hover and focus text. */
  tip: string;
};

const n = (v: number) => v.toLocaleString("en-US");
export const fillPct = (share: number) => (share === 1 ? "100%" : share >= 0.9995 ? ">99.9%" : share > 0 && share < 0.0005 ? "<0.1%" : `${(share * 100).toFixed(1)}%`);

export function fillCells(fills: readonly SourceFieldFill[], columns: readonly SourceColumn[]): FillCell[] {
  return fills
    .filter((f) => columns[f.position])
    .map((f) => {
      const column = columns[f.position];
      const title = fieldTitle(column);
      const code = fieldCode(column);
      const band = Math.max(0, FILL_BANDS.findIndex((b) => b.test(f.share)));
      return {
        position: f.position,
        title,
        code: code !== title ? code : null,
        share: f.share,
        filled: f.filled,
        blank: f.blank,
        band,
        tip: `${title}${code !== title ? ` (${code})` : ""}: a value in ${n(f.filled)} of ${n(f.filled + f.blank)} records, ${fillPct(f.share)}`,
      };
    });
}

/** Fields per band, in band order, with the band's words. */
export function fillLegend(cells: readonly FillCell[]): { band: number; label: string; fields: number }[] {
  return FILL_BANDS.map((b, band) => ({ band, label: b.label, fields: cells.filter((c) => c.band === band).length }));
}

/** "41 fields; 30 filled in every record, 2 empty in every record." */
export function fillCaption(cells: readonly FillCell[]): string {
  const legend = fillLegend(cells);
  const full = legend[0].fields;
  const empty = legend[4].fields;
  const parts = [`${n(cells.length)} ${cells.length === 1 ? "field" : "fields"}`];
  const notes: string[] = [];
  if (full === cells.length) notes.push("every one filled in every record");
  else {
    if (full) notes.push(`${n(full)} filled in every record`);
    if (empty) notes.push(`${n(empty)} empty in every record`);
    if (!full && !empty) notes.push("none filled in every record");
  }
  return `${parts.join("")}; ${notes.join(", ")}.`;
}
