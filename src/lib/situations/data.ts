// Situation screens (pipeline etl/situations.py): independent, sourced components per company. The app combines
// them into preset screens and a custom builder. The "aligned" count is a count of components, not a score.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export type SitDir = "bullish" | "bearish" | "neutral";

export interface BaseRate {
  signal: string;
  horizon: number;
  excess: number | null;
  ci: [number, number] | null;
  n: number | null;
  hit: number | null;
  first: string | null;
  last: string | null;
}

export interface SitEvidence {
  label?: string;
  date?: string;
  value?: number;
  shares?: number | null;
  price?: number | null;
  code?: string;
  plan?: boolean;
  url?: string | null;
  quote?: string | null;
  form?: string;
  section?: string;
  signal?: string;
  base_rate?: BaseRate | null;
  joint?: string[] | null;
}

export interface SitComponentDef {
  label: string;
  group: string;
  dir: SitDir;
  desc: string;
}

export interface SitScreen {
  id: string;
  title: string;
  desc: string;
  all?: string[];
  any?: string[];
  caveat?: string;
  n: number;
}

export type SitMetric = number | string | null;

export interface SitRow {
  t: string;
  n: string | null;
  s: string | null;
  mcap: number | null;
  px: number | null;
  c: Record<string, { h: string; m: Record<string, SitMetric> }>;
}

export interface SitIndex {
  version: number;
  generated: string;
  as_of: string;
  components: Record<string, SitComponentDef>;
  screens: SitScreen[];
  rows: SitRow[];
  base_rates: Record<string, BaseRate | null>;
  sources: Record<string, string>;
  caveats: string[];
}

export interface SitComponent {
  headline: string;
  dir: SitDir;
  metrics: Record<string, unknown>;
  evidence: SitEvidence[];
}

export interface SitDetail {
  ticker: string;
  generated: string;
  as_of: string;
  components: Record<string, SitComponent>;
}

const H = 15 * 60_000;

export const situationsIndexQuery = queryOptions({
  queryKey: ["situations", "index"],
  queryFn: () => partnerFile<SitIndex>("situations/index.json"),
  staleTime: H,
  retry: 1,
});

export const situationQuery = (t: string) =>
  queryOptions({
    queryKey: ["situations", t],
    queryFn: () => partnerFile<SitDetail>(`situations/${t}.json`),
    staleTime: H,
    retry: 0,
  });

/** Component order used for chips and the builder. */
export const COMPONENT_ORDER = [
  "insider_buy",
  "insider_sell",
  "holder_buy",
  "cheap_hist",
  "rich_hist",
  "contracts_up",
  "contracts_down",
  "distress",
  "financing",
  "new_single_source",
  "customer_conc_up",
  "mean_reversion",
  "quality_down",
] as const;

/** Components that make up the red-flag radar. */
export const RED_FLAGS = [
  "distress",
  "quality_down",
  "new_single_source",
  "customer_conc_up",
  "insider_sell",
  "financing",
] as const;

export function inScreen(row: Pick<SitRow, "c">, screen: Pick<SitScreen, "all" | "any">): boolean {
  const on = row.c;
  if (screen.all?.length && !screen.all.every((k) => k in on)) return false;
  if (screen.any?.length && !screen.any.some((k) => k in on)) return false;
  return true;
}

export interface Builder {
  comps: string[];
  /** Minimum number of the chosen components that must be on. */
  min: number;
  dir: "any" | SitDir;
}

/** Number of chosen components on for a row (respecting the direction filter), and whether it passes. */
export function matchBuilder(
  row: Pick<SitRow, "c">,
  b: Builder,
  defs: Record<string, Pick<SitComponentDef, "dir">>,
): { ok: boolean; aligned: number } {
  const chosen = b.comps.filter((k) => b.dir === "any" || defs[k]?.dir === b.dir);
  const aligned = chosen.filter((k) => k in row.c).length;
  return { ok: chosen.length > 0 && aligned >= Math.max(1, Math.min(b.min, chosen.length)), aligned };
}

/** Count of components that are on, by direction. */
export function alignedCounts(row: Pick<SitRow, "c">, defs: Record<string, Pick<SitComponentDef, "dir">>) {
  const out = { bullish: 0, bearish: 0, neutral: 0, total: 0 };
  for (const k of Object.keys(row.c)) {
    const d = defs[k]?.dir ?? "neutral";
    out[d] += 1;
    out.total += 1;
  }
  return out;
}

const num = (v: SitMetric | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The number a screen's table sorts by first (largest first), from the screen's lead component. */
export function leadValue(row: SitRow, comp: string): number | null {
  const m = row.c[comp]?.m;
  if (!m) return null;
  switch (comp) {
    case "insider_buy":
    case "insider_sell":
    case "holder_buy":
      return num(m.value);
    case "contracts_up":
    case "contracts_down": {
      const c = num(m.change);
      return c == null ? null : Math.abs(c);
    }
    case "cheap_hist": {
      const pe = num(m.pe_p5);
      const fy = num(m.fcf_yield_p5);
      return Math.max(pe != null ? 1 - pe : -1, fy ?? -1);
    }
    case "rich_hist":
      return num(m.pe_p5);
    case "customer_conc_up":
      return num(m.latest);
    case "mean_reversion": {
      const rsi = num(m.rsi);
      return rsi == null ? null : 100 - rsi;
    }
    default:
      return num(m.n);
  }
}

/** "Similar setups: 60-day excess +3.0% [0.7 to 5.3], n=107k, 2008-2026" and a tone from the CI. */
export function describeBaseRate(br: Pick<BaseRate, "excess" | "ci" | "n" | "first" | "last" | "horizon"> | null | undefined) {
  if (!br || br.excess == null) return null;
  const p = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const q = (v: number) => (v * 100).toFixed(1);
  const n = br.n == null ? "" : br.n >= 1e6 ? `${(br.n / 1e6).toFixed(1)}M` : br.n >= 1000 ? `${Math.round(br.n / 1000)}k` : `${br.n}`;
  const yrs = br.first && br.last ? `, ${br.first.slice(0, 4)}-${br.last.slice(0, 4)}` : "";
  const ci = br.ci ? ` [${q(br.ci[0])} to ${q(br.ci[1])}]` : "";
  const tone: "positive" | "negative" | "none" = br.ci
    ? br.ci[0] > 0
      ? "positive"
      : br.ci[1] < 0
        ? "negative"
        : "none"
    : "none";
  return {
    text: `Similar setups: ${br.horizon}-day excess ${p(br.excess)}${ci}${n ? `, n=${n}` : ""}${yrs}`,
    tone,
    verdict: tone === "positive" ? "beat the average day" : tone === "negative" ? "lagged the average day" : "no measurable edge",
  };
}

export const SURVIVORSHIP_NOTE =
  "Past frequencies in companies tracked today. Companies that were delisted or acquired are missing, which flatters setups that buy weakness. Not a forecast.";
