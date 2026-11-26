import type { TileResult } from "@/lib/sources/boards/types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The sentence about map records that are not drawn: those whose place key is blank ("1 record has no state and is
 * not drawn"), and those whose key is not a state or territory, named up to three ("2 records are not a state and not
 * drawn (US, Midwest)"). A blank key is never printed as a name, so no sentence ends in empty parentheses.
 */
export function notDrawnLines(others: readonly string[]): string[] {
  const blank = others.filter((k) => k.trim() === "").length;
  const named = others.filter((k) => k.trim() !== "");
  const lines: string[] = [];
  if (blank > 0) lines.push(`${blank.toLocaleString("en-US")} ${plural(blank, "record has", "records have")} no state and ${plural(blank, "is", "are")} not drawn.`);
  if (named.length > 0) {
    const shown = named.slice(0, 3).join(", ");
    lines.push(
      `${named.length.toLocaleString("en-US")} ${plural(named.length, "record is", "records are")} not a state and not drawn (${shown}${named.length > 3 ? ", …" : ""}).`,
    );
  }
  return lines;
}

/** Gaps, missing states, places that are not states and counts without a period, each in one plain sentence. */
export function caveatLines(result: Extract<TileResult, { ok: true }>): string[] {
  const lines: string[] = [];
  const g = result.gaps;
  if (g.count > 0) lines.push(`${g.count} ${plural(g.count, "period has", "periods have")} no figure in the source and ${plural(g.count, "is", "are")} left out.`);
  if (g.noBase > 0) lines.push(`${g.noBase} ${plural(g.noBase, "figure has", "figures have")} no figure a year earlier.`);
  const shape = result.shape;
  if (shape?.kind === "map") {
    if (shape.missing.length) lines.push(`No figure: ${shape.missing.map((m) => m.name).join(", ")}.`);
    lines.push(...notDrawnLines(shape.others));
    if (shape.territories.length) lines.push(`Territories: ${shape.territories.map((t) => `${t.name} ${t.display}`).join(", ")}.`);
  }
  if (shape?.kind === "mix") lines.push(`Parts and the publisher's total agree within ${shape.largestGap} in every period drawn.`);
  if (shape?.kind === "records" && shape.rest > 0) lines.push(`${shape.rest.toLocaleString("en-US")} records of other values are not drawn.`);
  return lines;
}
