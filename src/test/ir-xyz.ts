// Real Block (XYZ) revenue-by-type facts, Q2 2018 to Q2 2020, and their documents: 160 rows of
// ir_kpi_facts and 13 of ir_documents copied on 20 Nov 2026 with the checksum method of
// fu/round2/TRANSFER.md (labels and titles folded: non-ASCII → "?"). They hold the real problems the
// IR guards handle: a quarter printed in thousands next to quarters in dollars, a year printed by a
// newer release and an older supplement with different values, same-day copies that disagree.
// Node-only (tests and the preview harness).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IrFact } from "@/lib/ir/kpis";

const dir = path.resolve(__dirname, "fixtures/ir");
const rows = (f: string) =>
  readFileSync(path.join(dir, f), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
const nul = (s: string) => (s === "" ? null : s);

export interface XyzDoc {
  id: string;
  source: string;
  accn: string | null;
  exhibit: string | null;
  kind: string;
  title: string;
  period: string | null;
  filed: string | null;
  ext: string | null;
  bytes: number | null;
  extract_status: string | null;
  extract_facts: number | null;
  pages: number | null;
}

export const XYZ_DOCS: XyzDoc[] = rows("xyz-docs.folded.txt").map((r) => ({
  id: r[0],
  source: r[1],
  accn: nul(r[2]),
  exhibit: nul(r[3]),
  kind: r[4],
  title: r[5],
  period: nul(r[6]),
  filed: nul(r[7]),
  ext: nul(r[8]),
  bytes: r[9] ? Number(r[9]) : null,
  extract_status: nul(r[10]),
  extract_facts: r[11] ? Number(r[11]) : null,
  pages: r[12] ? Number(r[12]) : null,
}));

const docById = new Map(XYZ_DOCS.map((d) => [d.id, d]));

/** id|document_id|breakdown|parent|label|is_total|period_start|period_end|months|value|method|t,r,c|text */
export const XYZ_FACTS: IrFact[] = rows("xyz-revenue-facts.folded.txt").map((r) => {
  const d = docById.get(r[1])!;
  const [t, rr, c] = r[11].split(",").map(Number);
  return {
    id: r[0],
    document_id: r[1],
    document_kind: d.kind,
    category: "product",
    metric: "revenue",
    breakdown: nul(r[2]),
    parent: nul(r[3]),
    label: r[4],
    is_total: r[5] === "true",
    period_start: nul(r[6]),
    period_end: r[7],
    months: Number(r[8]),
    value: Number(r[9]),
    unit: "usd",
    accn: d.accn,
    doc: null,
    filed: d.filed,
    method: r[10],
    locator: { t, r: rr, c, text: r[12] },
  };
});
