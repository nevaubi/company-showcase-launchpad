// The alt-data catalogue: what each dataset is, where it comes from, which theme it belongs to, and
// the one number format every alt figure uses. Pure.

export type AltTheme = "gov" | "products" | "market" | "banking" | "events";

export const THEMES: { id: AltTheme; label: string; short: string; anchor: string }[] = [
  { id: "gov", label: "Government and regulation", short: "Government", anchor: "alt-gov" },
  { id: "products", label: "Products and safety", short: "Products and safety", anchor: "alt-products" },
  { id: "market", label: "Market, ownership and attention", short: "Market and attention", anchor: "alt-market" },
  { id: "banking", label: "Banking", short: "Banking", anchor: "alt-banking" },
  { id: "events", label: "Corporate events", short: "Events", anchor: "alt-events" },
];

export interface DatasetInfo {
  label: string;
  blurb: string;
  source: string;
  theme: AltTheme;
  /** what one row is */
  measures: string;
  /** how often the source publishes */
  cadence: string;
}

/** Every dataset in `alt_data`, in the order a theme shows them. */
export const DATASETS: Record<string, DatasetInfo> = {
  contracts: { label: "Government contracts", blurb: "Federal contract obligations by fiscal year and the latest award actions", source: "USAspending.gov", theme: "gov", measures: "Fiscal-year obligations; award and modification actions", cadence: "Daily" },
  regulatory: { label: "Regulatory actions", blurb: "Rules, proposed rules and notices in the Federal Register naming the company", source: "Federal Register", theme: "gov", measures: "Documents per year; each document", cadence: "Daily" },
  fda: { label: "FDA approvals and recalls", blurb: "Drug approvals and new indications; drug, device and food recalls", source: "openFDA", theme: "products", measures: "Approval or recall record", cadence: "Weekly" },
  trials: { label: "Clinical trials", blurb: "Trials the company leads as sponsor: phase, status, enrollment and completion dates", source: "ClinicalTrials.gov", theme: "products", measures: "Trial record, dated by last update", cadence: "Daily" },
  medicare: { label: "Medicare drug spending", blurb: "Gross Medicare spending on the company's drugs, Part D (pharmacy) and Part B (given in clinics), per year and the latest quarter, before rebates", source: "CMS", theme: "products", measures: "Yearly and quarterly spending, total and per drug", cadence: "Quarterly" },
  medicare_states: { label: "Medicare drugs by state", blurb: "Gross Part D costs of the company's own brands by the prescriber's state, its slice of each state's spending and how far each state over- or under-indexes", source: "CMS", theme: "products", measures: "Yearly Part D costs per state", cadence: "Yearly" },
  recalls: { label: "Vehicle and equipment recalls", blurb: "NHTSA recall campaigns and units affected", source: "NHTSA", theme: "products", measures: "Recall campaign", cadence: "Weekly" },
  consumer: { label: "Consumer product recalls", blurb: "CPSC recalls naming the company as maker, importer or retailer, with units and hazard", source: "CPSC", theme: "products", measures: "Recall notice", cadence: "Weekly" },
  tri: { label: "Plants and releases", blurb: "EPA Toxics Release Inventory: the company's US plants that handle listed chemicals, yearly releases and a production index", source: "EPA", theme: "products", measures: "Yearly releases, plants and production index", cadence: "Yearly" },
  ownership: { label: "Ownership and activists", blurb: "Schedule 13D (activist) and 13G (5%+ passive) holder filings", source: "SEC EDGAR", theme: "market", measures: "Holder filing", cadence: "Daily" },
  capital: { label: "Capital markets", blurb: "Shelf registrations, debt and equity takedowns, tender offers, merger registrations and stock-plan filings", source: "SEC EDGAR", theme: "market", measures: "Registration or prospectus filing", cadence: "Daily" },
  settlement: { label: "Fails to deliver", blurb: "Shares sold but not delivered on settlement day, average daily balance per half-month valued at the day's price", source: "SEC", theme: "market", measures: "Half-month average value failing", cadence: "Twice a month" },
  attention: { label: "Public attention", blurb: "Monthly Wikipedia pageviews of the company's article", source: "Wikimedia", theme: "market", measures: "Pageviews per month", cadence: "Monthly" },
  bank: { label: "Bank call reports", blurb: "Quarterly FDIC data for the main insured bank: deposits, loans, margin, charge-offs, capital", source: "FDIC", theme: "banking", measures: "Quarterly call-report line", cadence: "Quarterly" },
  deposits: { label: "Deposits by state", blurb: "Branch deposits each June 30 by state and metro area for all the company's insured banks", source: "FDIC", theme: "banking", measures: "Yearly deposits per state", cadence: "Yearly" },
  complaints: { label: "Consumer complaints", blurb: "CFPB complaints per year with product mix", source: "CFPB", theme: "banking", measures: "Complaints per year", cadence: "Daily" },
  events: { label: "8-K filings", blurb: "8-K items: deals, acquisitions, new debt, restructurings, impairments, executive and auditor changes, restatements, cyber incidents", source: "SEC EDGAR", theme: "events", measures: "8-K item", cadence: "Daily" },
};

const MINUS = "−";

/** One format for alt values: $1.2B, 3.4M, 12K, 2.50%, 0.84×, 85K lb; an en dash for missing. */
/**
 * A number scaled to K/M/B/T with `digits` decimals, moving up a step when rounding would print
 * 1000 of a unit ("$1.00T", not "$1000.0B").
 */
/** steps: [divisor, suffix, decimals, smallest value shown this way (defaults to the divisor)] */
function scaled(a: number, steps: [number, string, number, number?][], small: (a: number) => string): string {
  for (let i = 0; i < steps.length; i++) {
    const [base, suffix, digits, from = base] = steps[i];
    if (a < from) continue;
    const txt = (a / base).toFixed(digits);
    if (Number(txt) >= 1000 && i > 0) {
      const [b2, s2, d2] = steps[i - 1];
      return `${(a / b2).toFixed(d2)}${s2}`;
    }
    return `${txt}${suffix}`;
  }
  return small(a);
}

/**
 * An alt-data value with its unit: "$1.2B", "0.61%", "2,221 lb", "804K". A true minus sign, and no
 * sign on a value that rounds to zero. Exported for every caller in the app (daily brief, overview,
 * state deposits, the assistant), which take it as plain text.
 */
export function fmtAlt(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  let body: string;
  if (unit === "USD") body = `$${scaled(a, [[1e12, "T", 2], [1e9, "B", 1], [1e6, "M", 1], [1e3, "K", 0]], (x) => x.toFixed(0))}`;
  else if (unit === "%") body = `${a.toFixed(2)}%`;
  else if (unit === "ratio") body = `${a.toFixed(2)}×`;
  else if (unit === "lbs") body = `${scaled(a, [[1e6, "M", 1], [1e3, "K", 0, 1e4]], (x) => Math.round(x).toLocaleString("en-US"))} lb`;
  else body = scaled(a, [[1e9, "B", 1], [1e6, "M", 1], [1e3, "K", 0, 1e4]], (x) => (Math.round(x * 100) / 100 === Math.round(x) ? Math.round(x).toLocaleString("en-US") : x.toLocaleString("en-US", { maximumFractionDigits: 2 })));
  const zero = !/[1-9]/.test(body);
  return `${v < 0 && !zero ? MINUS : ""}${body}`;
}

/** A signed change as a percentage ("+5.7%", "−12%"); one decimal under 10%; "0.0%" for no change. */
export function fmtChange(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "–";
  if (c >= 10) return "> +999%";
  const p = Math.abs(c * 100);
  const txt = p < 10 ? p.toFixed(1) : p.toFixed(0);
  if (!/[1-9]/.test(txt)) return "0.0%";
  return `${c < 0 ? MINUS : "+"}${txt}%`;
}

/** A share as a percentage ("74%", "3.1%", "<0.1%"). */
export function fmtShare(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "–";
  const p = s * 100;
  return p > 0 && p < 0.1 ? "<0.1%" : p < 10 ? `${p.toFixed(1)}%` : `${p.toFixed(0)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 20, 2026" */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "–";
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}

/** A signed change as a percentage at a fixed number of decimals, for a table column ("+12%", "−3%"); "–" when missing. */
export function fmtSigned(c: number | null | undefined, d: number): string {
  if (c == null || !Number.isFinite(c)) return "–";
  const txt = Math.abs(c * 100).toFixed(d);
  if (!/[1-9]/.test(txt)) return `${txt}%`;
  return `${c < 0 ? MINUS : "+"}${txt}%`;
}

/** A share as a percentage at a fixed number of decimals, for a table column; "–" when missing. */
export function fmtPct(v: number | null | undefined, d: number): string {
  return v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`;
}
