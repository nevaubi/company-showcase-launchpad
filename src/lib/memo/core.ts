import type { Cell, CompanyDataset, Statement } from "@/lib/financials/types";

/** One footnote = one SEC fact (accession + concept + period). Derived cells cite every part. */
export interface MemoNote { n: number; accn: string; concept: string; start?: string; end: string }
export interface MemoCell { v: number; notes: number[] }
export interface MemoLine { key: string; label: string; unit: string; cells: (MemoCell | null)[]; growth: (number | null)[] }

export const MEMO_LINES: { st: "income" | "balance" | "cashflow"; key: string; label: string }[] = [
  { st: "income", key: "revenue", label: "Revenue" },
  { st: "income", key: "grossProfit", label: "Gross profit" },
  { st: "income", key: "operatingIncome", label: "Operating income" },
  { st: "income", key: "netIncome", label: "Net income" },
  { st: "income", key: "epsDiluted", label: "Diluted EPS" },
  { st: "cashflow", key: "cfo", label: "Operating cash flow" },
  { st: "cashflow", key: "fcf", label: "Free cash flow" },
  { st: "cashflow", key: "buybacks", label: "Buybacks" },
  { st: "balance", key: "cash", label: "Cash" },
  { st: "balance", key: "totalDebt", label: "Total debt" },
];

/** Annual tear-sheet: last `years` fiscal years, every value footnoted to its filing. */
export function buildMemo(data: CompanyDataset, years = 5) {
  const a = data.statements.annual;
  const periods = a.income.periods.slice(-years);
  const notes: MemoNote[] = [];
  const index = new Map<string, number>();
  const cite = (s: { accn: string; concept: string; start?: string; end: string }) => {
    const id = `${s.accn}|${s.concept}|${s.start ?? ""}|${s.end}`;
    let n = index.get(id);
    if (!n) { n = notes.length + 1; index.set(id, n); notes.push({ n, accn: s.accn, concept: s.concept, start: s.start, end: s.end }); }
    return n;
  };
  const toCell = (c: Cell | null | undefined): MemoCell | null => {
    if (!c) return null;
    const srcs = c.src ? [c.src] : (c.derived?.parts ?? []);
    if (!srcs.length) return null; // never show an unsourced number
    return { v: c.v, notes: srcs.map(cite) };
  };
  const lines: MemoLine[] = [];
  for (const def of MEMO_LINES) {
    const st: Statement | undefined = a[def.st];
    const row = st?.rows.find((r) => r.key === def.key);
    if (!st || !row) continue;
    const cells = periods.map((p) => toCell(row.cells[st.periods.findIndex((x) => x.key === p.key)]));
    if (cells.every((c) => !c)) continue;
    const growth = cells.map((c, i) => {
      const prev = cells[i - 1];
      return c && prev && prev.v > 0 ? c.v / prev.v - 1 : null;
    });
    lines.push({ key: def.key, label: def.label, unit: row.unit, cells, growth });
  }
  return { periods: periods.map((p) => ({ key: p.key, label: p.label, end: p.end })), lines, notes };
}

/** Margin = numerator / revenue for the same year, null when either side is missing. */
export function margin(memo: ReturnType<typeof buildMemo>, key: string): (number | null)[] {
  const rev = memo.lines.find((l) => l.key === "revenue");
  const num = memo.lines.find((l) => l.key === key);
  return memo.periods.map((_, i) => {
    const r = rev?.cells[i]?.v; const x = num?.cells[i]?.v;
    return r && x != null ? x / r : null;
  });
}
