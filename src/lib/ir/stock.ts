// Which IR lines are balances or averages rather than flows. Shared by the series build (kpis.ts),
// which must never add such lines up over a year, and the payload tidy pass (tidy.ts), which removes
// years and fourth quarters that older builds derived for them.

const AVERAGE_WORDS = /\b(average|avg)\b/i;
const STOCK_WORDS = /\b(period[- ]end|end of (the )?(period|quarter|year)|ending|balances?|outstanding|as of|backlog|headcount|employees|book value)\b/i;
/** Lines that move money or units during the period even when their metric is a balance ("net new assets"). */
const FLOW_WORDS = /\b(new|net adds?|additions?|inflows?|outflows?|flows?|originations?|charge-?offs?|sold|delivered|shipped|added)\b/i;
const STOCK_METRICS = new Set(["backlog", "assets", "deposits", "loans", "aum", "headcount", "stores", "users"]);

/** Formulas that only hold for flows (a year as four quarters, a quarter as year minus quarters or YTD). */
export const FLOW_FORMULAS = /^(Q1 \+ Q2 \+ Q3 \+ Q4|Full year −|Six months YTD −|Nine months YTD −)/;

/**
 * Balances and averages don't add up over a year: four quarter-end deposit balances are not a year's
 * deposits, and four quarterly averages are not an annual average. "point" lines take the year-end
 * quarter as the year; "average" lines (and prices) get no derived year at all; flows return null.
 */
export function stockKind(s: { pit?: boolean; category: string; metric: string; label: string; parent?: string | null; breakdown?: string | null }): "point" | "average" | null {
  const text = `${s.label} ${s.parent ?? ""} ${s.breakdown ?? ""}`;
  if (s.pit) return "point";
  if (AVERAGE_WORDS.test(text) || s.metric === "price") return "average";
  if (s.category === "balance") return "point";
  if (FLOW_WORDS.test(s.label)) return null;
  if (STOCK_METRICS.has(s.metric) || STOCK_WORDS.test(text)) return "point";
  return null;
}
