import type { SourceTarget } from "@/components/source/source-context";
import { partsFrom } from "./build";
import type { Cell, DerivedPart, Statement } from "./types";

/** Build a source-panel target for a single statement cell. */
export function cellTarget(ticker: string, st: Statement, rowKey: string, index: number, label?: string): SourceTarget | null {
  const row = st.rows.find((r) => r.key === rowKey);
  const cell = row?.cells[index];
  if (!row || !cell) return null;
  return {
    ticker,
    label: label ?? row.label,
    periodLabel: st.periods[index]?.label,
    unit: row.unit,
    value: cell.v,
    src: cell.src,
    alts: cell.alts,
    derived: cell.derived,
    approx: cell.approx,
  };
}

/** Trailing-twelve-month target: the sum of the last four quarters with each quarter's sources as parts. */
export function ttmTarget(ticker: string, q: Statement, rowKey: string, label: string): SourceTarget | null {
  const row = q.rows.find((r) => r.key === rowKey);
  if (!row) return null;
  let end = row.cells.length - 1;
  while (end >= 0 && !row.cells[end]) end--;
  if (end < 3) return null;
  const idx = [end - 3, end - 2, end - 1, end];
  const cells = idx.map((i) => row.cells[i]);
  if (cells.some((c) => !c)) return null;
  const parts: DerivedPart[] = idx.flatMap((i) => partsFrom(row.cells[i] as Cell, q.periods[i].label, 1));
  return {
    ticker,
    label: `${label} (TTM)`,
    periodLabel: `${q.periods[idx[0]].label} – ${q.periods[end].label}`,
    unit: row.unit,
    value: cells.reduce((s, c) => s + c!.v, 0),
    derived: { formula: `Sum of ${idx.map((i) => q.periods[i].label).join(" + ")}`, parts },
  };
}

export function ratioTarget(
  ticker: string,
  label: string,
  periodLabel: string,
  num: SourceTarget | null,
  den: SourceTarget | null,
  unit: "pct" | "ratio" = "pct",
): SourceTarget | null {
  if (!num || !den || !den.value) return null;
  const parts = (t: SourceTarget, l: string): DerivedPart[] =>
    t.src ? [{ ...t.src, label: l, sign: 1 }] : (t.derived?.parts ?? []).map((p) => ({ ...p, label: `${l} · ${p.label}` }));
  return {
    ticker,
    label,
    periodLabel,
    unit,
    value: num.value / den.value,
    derived: { formula: `${num.label} ÷ ${den.label}`, parts: [...parts(num, num.label), ...parts(den, den.label)] },
  };
}
