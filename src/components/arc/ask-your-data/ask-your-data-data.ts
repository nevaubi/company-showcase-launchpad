import type { AskYourDataResult } from "./ask-your-data-types";

/** One canned answer for the simulated preview: the SQL a model would write, what the query scans, and the result. */
export interface AskYourDataSample {
  /** Words that route a typed question to this sample. */
  match: RegExp;
  question: string;
  sql: string;
  /** Rows the simulated query reports scanning while it runs. */
  rowsScanned: number;
  result: AskYourDataResult;
}

const count = (value: number) => value.toLocaleString("en-US");
const usd = (value: number) => `$${value.toLocaleString("en-US")}k`;
const pct = (value: number) => `${value.toFixed(1)}%`;

const weeks = ["Aug 3", "Aug 10", "Aug 17", "Aug 24", "Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28", "Oct 5", "Oct 12", "Oct 19"];

/* Weekly signups, Aug 3 to Oct 25, 2026. Every series adds up: 701 + 378 + 165 + 40 = 1,284 signups, one row scanned each. */
export const signupsSample: AskYourDataSample = {
  match: /sign ?ups?|registrations?|new users/i,
  question: "Weekly signups by plan since August",
  rowsScanned: 1284,
  sql: `-- Weekly signups by plan, full weeks since August
select
  date_trunc('week', u.created_at)::date as week,
  p.name as plan,
  count(*) as signups
from users u
join subscriptions s on s.user_id = u.id
join plans p on p.id = s.plan_id
where u.created_at >= date '2026-08-03'
  and u.created_at < date_trunc('week', now())
group by 1, 2
order by 1, 2;`,
  result: {
    title: "Weekly signups by plan",
    subtitle: "Aug 3 to Oct 25 · 1,284 signups",
    categoryLabel: "Week",
    categories: weeks,
    series: [
      { id: "free", label: "Free", values: [58, 61, 55, 63, 45, 60, 64, 59, 62, 57, 61, 56] },
      { id: "pro", label: "Pro", values: [24, 26, 27, 29, 25, 31, 33, 34, 36, 35, 38, 40] },
      { id: "team", label: "Team", values: [9, 10, 11, 11, 12, 13, 14, 15, 16, 17, 18, 19] },
      { id: "enterprise", label: "Enterprise", values: [2, 2, 3, 2, 3, 3, 4, 3, 4, 4, 5, 5] },
    ],
    stacked: true,
    chart: "bar",
    formatValue: count,
    insight: "Pro is up 67% since August, from 24 to 40 a week, and Team more than doubled. Free held flat near 60, with a dip in Labor Day week.",
    rowCount: 48,
    durationMs: 214,
  },
};

/* MRR by billing region, Jan to Sep 2026, in thousands of dollars. September totals 258 + 146 + 71 = $475k. */
export const revenueSample: AskYourDataSample = {
  match: /revenue|mrr|arr|billing|income/i,
  question: "Monthly recurring revenue by region in 2026",
  rowsScanned: 18402,
  sql: `-- Monthly recurring revenue by region in 2026
select
  date_trunc('month', i.period_start)::date as month,
  a.region,
  round(sum(i.amount_cents) / 100000.0) as mrr_usd_k
from invoices i
join accounts a on a.id = i.account_id
where i.status = 'paid'
  and i.period_start >= date '2026-01-01'
  and i.period_start < date '2026-10-01'
group by 1, 2
order by 1, 2;`,
  result: {
    title: "Monthly recurring revenue by region",
    subtitle: "Jan to Sep 2026 · $475k in September",
    categoryLabel: "Month",
    categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"],
    series: [
      { id: "na", label: "North America", values: [182, 189, 197, 204, 215, 223, 236, 244, 258] },
      { id: "eu", label: "Europe", values: [96, 101, 104, 111, 117, 124, 129, 138, 146] },
      { id: "apac", label: "Asia Pacific", values: [31, 34, 38, 41, 47, 52, 58, 63, 71] },
    ],
    stacked: true,
    legendValue: "last",
    chart: "line",
    formatValue: usd,
    insight: "Asia Pacific more than doubled this year, from $31k to $71k. Total MRR reached $475k in September, up 54% since January.",
    rowCount: 27,
    durationMs: 386,
  },
};

/* Churn on paid plans, May to Sep 2026. Rates do not add up across plans, so the table shows no total. */
export const churnSample: AskYourDataSample = {
  match: /churn|cancel|retention|lost/i,
  question: "Monthly churn rate by plan since May",
  rowsScanned: 3912,
  sql: `-- Monthly churn rate on paid plans since May
select
  m.month,
  p.name as plan,
  round(100.0 * sum(m.churned) / nullif(sum(m.active_at_start), 0), 1) as churn_pct
from plan_metrics_monthly m
join plans p on p.id = m.plan_id
where m.month >= date '2026-05-01'
  and m.month < date '2026-10-01'
  and p.name <> 'Free'
group by 1, 2
order by 1, 2;`,
  result: {
    title: "Monthly churn rate by plan",
    subtitle: "May to Sep 2026 · paid plans",
    categoryLabel: "Month",
    categories: ["May", "Jun", "Jul", "Aug", "Sep"],
    series: [
      { id: "pro", label: "Pro", values: [4.8, 4.6, 4.9, 4.2, 3.9] },
      { id: "team", label: "Team", values: [3.1, 2.9, 2.7, 2.6, 2.3] },
      { id: "enterprise", label: "Enterprise", values: [1.2, 0.9, 1.1, 0.8, 0.7] },
    ],
    stacked: false,
    legendValue: "last",
    chart: "line",
    formatValue: pct,
    insight: "Churn fell on every paid plan since May. Pro dropped below 4% for the first time in September, and Team is down to 2.3%.",
    rowCount: 15,
    durationMs: 172,
  },
};

export const askYourDataSamples = [signupsSample, revenueSample, churnSample];
export const askYourDataSuggestions = askYourDataSamples.map(sample => sample.question);
