// Stored figures read before the table reader knew that "(32.5" with ")" or "%)" in the next cell is
// negative (parseRowCell, tables.ts). Pure: run on facts as loaded, before buildPayload.
import { opensParenthesis } from "@/lib/ir/tables";

export interface SignFixFact {
  id?: string;
  value: number;
  method?: string;
  derived?: boolean;
  locator: object;
}

/** A table cell locator {t, r, c} and its printed text. */
const cellText = (locator: object): string | null => {
  const l = locator as { t?: unknown; r?: unknown; c?: unknown; text?: unknown };
  return typeof l.t === "number" && typeof l.r === "number" && typeof l.c === "number" && typeof l.text === "string" ? l.text : null;
};

/**
 * A fact read from a table cell whose own printed text opens a parenthesis around one number and
 * does not close it ("(32.5", "$ (1,234"), stored positive. Measured against the SEC documents on
 * 51 production facts of 12 companies and 1,745 facts in 40 documents of 23 companies: the next
 * non-empty cell closes it (")" or "%)", in 8 cells followed by a footnote number, ") 3"); no
 * counter-example.
 * Derived, text (prose) and page (vision) facts and texts with letters are never touched.
 */
export function needsSignFix(f: SignFixFact): boolean {
  if (f.derived || (f.method != null && f.method !== "table")) return false;
  if (!(f.value > 0)) return false;
  const text = cellText(f.locator);
  return text != null && opensParenthesis(text);
}

/** The facts with those values made negative (new objects; others returned as they are) and the corrected ids. */
export function fixPrintedSigns<F extends SignFixFact>(facts: F[]): { facts: F[]; fixed: string[] } {
  const fixed: string[] = [];
  const out = facts.map((f) => {
    if (!needsSignFix(f)) return f;
    if (f.id) fixed.push(f.id);
    return { ...f, value: -f.value };
  });
  return { facts: out, fixed };
}
