/** Starter companies for a new user's watchlist. */
export const STARTER_TICKERS = ["NVDA", "MSFT", "COST"] as const;

export type OnboardingRow = { seeded_at: string | null; tour_done_at: string | null; checklist: Record<string, boolean>; dismissed: boolean };

export const CHECKLIST = [
  { id: "search", label: "Open a company from search" },
  { id: "source", label: "Click a number to see its SEC source" },
  { id: "assistant", label: "Ask the assistant a question" },
  { id: "office", label: "Open a file in Office Studio" },
] as const;

/** Seeding happens once: never again after seeded_at is set, and the watchlist is filled only if it is empty. */
export function seedPlan(row: Pick<OnboardingRow, "seeded_at"> | null, watchCount: number) {
  if (row?.seeded_at) return { seed: false, tickers: [] as string[], workbook: false };
  return { seed: true, tickers: watchCount === 0 ? [...STARTER_TICKERS] : [], workbook: true };
}

/** Starter model: live FU() formulas, so every value comes from SEC filings and stays clickable to its source. */
export function starterCells(): Record<string, string> {
  const yrs = ["FY2024", "FY2025", "FY2026"];
  const cols = ["B", "C", "D"];
  const c: Record<string, string> = { A1: "NVIDIA — starter model (SEC-sourced)", A3: "Metric" };
  yrs.forEach((y, i) => (c[`${cols[i]}3`] = y));
  const rows: [string, string][] = [["Revenue", "revenue"], ["Gross profit", "grossProfit"], ["Operating income", "operatingIncome"], ["Net income", "netIncome"]];
  rows.forEach(([label, key], r) => {
    c[`A${4 + r}`] = label;
    yrs.forEach((y, i) => (c[`${cols[i]}${4 + r}`] = `=FU("NVDA","${key}","${y}")`));
  });
  c.A9 = "Gross margin";
  c.A10 = "Net margin";
  cols.forEach((k) => { c[`${k}9`] = `=${k}5/${k}4`; c[`${k}10`] = `=${k}7/${k}4`; });
  c.A12 = "Source: NVIDIA 10-K filings via Filed Under. Ask OfficeAI to extend this model.";
  return c;
}
