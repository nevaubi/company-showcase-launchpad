/** Types and sample data for the AI insight card. All figures are samples for a fictional SaaS business. */

export interface InsightMetric {
  /** Metric name, such as "Net revenue". */
  label: string;
  /** Short period label shown next to the name. */
  period: string;
  /** Total for the current period. */
  value: number;
  /** Total for the comparison period, used for the delta. */
  previous: number;
  /** Comparison wording after the delta, such as "vs last week". */
  comparisonLabel: string;
  /** One value per point in the current period. */
  series: number[];
  /** The same points in the comparison period, drawn dashed. Optional. */
  previousSeries?: number[];
  /** Point labels for the tooltip, such as "Tue, Oct 21". Same length as `series`. */
  points: string[];
  /** Legend names for the two lines. */
  seriesLabel?: string;
  previousSeriesLabel?: string;
  /** Turns a number into display text. Defaults to compact US dollars ($482.1k). */
  format?: (value: number) => string;
  /** Set when a rise is bad news (churn, cost). Flips the delta colors. */
  lowerIsBetter?: boolean;
}

export interface InsightDriver {
  id: string;
  /** What moved, such as "Annual renewals, EMEA". */
  label: string;
  /** Signed contribution to the change, in metric units. */
  delta: number;
  /** Index into `metric.series` where the chart annotation sits. */
  point: number;
}

/** A run of explanation text. A segment with `driver` lights up that driver and its chart annotation when it streams in. */
export interface InsightSegment {
  text: string;
  driver?: string;
}

export interface Insight {
  segments: InsightSegment[];
  /** Up to three drivers, ranked by size. */
  drivers: InsightDriver[];
}

export interface InsightFollowUp {
  id: string;
  label: string;
  /** Local answer used when no `explain` function is passed. */
  insight?: Insight;
}

export const sampleMetric: InsightMetric = {
  label: "Net revenue",
  period: "Oct 20 to 26",
  value: 482_100,
  previous: 515_100,
  comparisonLabel: "vs last week",
  series: [74_800, 66_100, 73_200, 69_000, 70_600, 60_400, 68_000],
  previousSeries: [76_200, 78_900, 77_400, 75_800, 74_100, 66_300, 66_400],
  points: ["Mon, Oct 20", "Tue, Oct 21", "Wed, Oct 22", "Thu, Oct 23", "Fri, Oct 24", "Sat, Oct 25", "Sun, Oct 26"],
  seriesLabel: "This week",
  previousSeriesLabel: "Last week",
};

export const sampleInsight: Insight = {
  segments: [
    { text: "Driven by fewer annual renewals in EMEA, down from 41 to 23 on Tuesday.", driver: "emea" },
    { text: " " },
    { text: "Failed card payments in North America cost another $11.8k on Thursday,", driver: "failed" },
    { text: " while " },
    { text: "Enterprise usage overages added back $3.4k on Sunday.", driver: "overage" },
  ],
  drivers: [
    { id: "emea", label: "Annual renewals, EMEA", delta: -24_600, point: 1 },
    { id: "failed", label: "Failed card payments, NA", delta: -11_800, point: 3 },
    { id: "overage", label: "Usage overages, Enterprise", delta: 3_400, point: 6 },
  ],
};

export const sampleFollowUps: InsightFollowUp[] = [
  {
    id: "quarter",
    label: "Compare to last quarter",
    insight: {
      segments: [
        { text: "This week is $13.2k above the Q3 weekly average of $468.9k. " },
        { text: "New business in North America ran ahead from Monday,", driver: "new" },
        { text: " and " },
        { text: "Enterprise expansion landed on Sunday.", driver: "expansion" },
        { text: " Only " },
        { text: "failed card payments on Thursday fell below the Q3 pace.", driver: "failed" },
      ],
      drivers: [
        { id: "new", label: "New business, NA", delta: 9_800, point: 0 },
        { id: "expansion", label: "Expansion, Enterprise", delta: 6_600, point: 6 },
        { id: "failed", label: "Failed card payments, NA", delta: -3_200, point: 3 },
      ],
    },
  },
  {
    id: "plan",
    label: "Break down by plan",
    insight: {
      segments: [
        { text: "Team carried the decline, down $26.9k as EMEA renewals lapsed on Tuesday.", driver: "team" },
        { text: " " },
        { text: "Pro slipped $9.5k, mostly from failed payments on Thursday.", driver: "pro" },
        { text: " " },
        { text: "Enterprise grew $3.4k on overage invoices billed Sunday.", driver: "enterprise" },
      ],
      drivers: [
        { id: "team", label: "Team plan", delta: -26_900, point: 1 },
        { id: "pro", label: "Pro plan", delta: -9_500, point: 3 },
        { id: "enterprise", label: "Enterprise plan", delta: 3_400, point: 6 },
      ],
    },
  },
];

/** $482.1k, $11.8k, $940. Negative values get a true minus sign. */
export function formatCompactUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}
