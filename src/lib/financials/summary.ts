import type { CompanyDataset, Statement } from "./types";

/** Compact plain-text table of the latest quarters for prompting (keeps tokens small). */
export function fundamentalsDigest(d: CompanyDataset, quarters = 6): string {
  const q = d.statements.quarterly;
  const pick = (st: Statement, keys: string[]) => {
    const n = st.periods.length;
    const idx = Array.from({ length: Math.min(quarters, n) }, (_, i) => n - Math.min(quarters, n) + i);
    const head = `| Line | ${idx.map((i) => `${st.periods[i].label} (${st.periods[i].end})`).join(" | ")} |`;
    const rows = keys
      .map((k) => st.rows.find((r) => r.key === k))
      .filter(Boolean)
      .map((r) => {
        const vals = idx.map((i) => {
          const c = r!.cells[i];
          if (!c) return "—";
          if (r!.unit === "pct") return `${(c.v * 100).toFixed(1)}%`;
          if (r!.unit === "usdPerShare") return c.v.toFixed(2);
          if (r!.unit === "ratio") return c.v.toFixed(2);
          return `${(c.v / 1e6).toFixed(0)}M`;
        });
        return `| ${r!.label} | ${vals.join(" | ")} |`;
      });
    return [head, ...rows].join("\n");
  };
  return [
    `${d.profile.name} (${d.profile.ticker}) — ${d.profile.industry}. Fiscal year ends ${d.profile.fiscalYearEnd}.`,
    "Income statement ($M unless noted):",
    pick(q.income, ["revenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted"]),
    "Cash flow:",
    pick(q.cashflow, ["cfo", "capex", "fcf", "buybacks"]),
    "KPIs:",
    pick(q.kpis, ["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "fcfMargin"]),
  ].join("\n");
}
