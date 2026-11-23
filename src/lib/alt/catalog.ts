// The alt-data catalogue: what each dataset is, where it comes from, which theme it belongs to, and
// the one number format every alt figure uses. Pure.

export type AltTheme = "gov" | "products" | "market" | "banking" | "events";

export const THEMES: { id: AltTheme; label: string; anchor: string }[] = [
  { id: "gov", label: "Government and regulation", anchor: "alt-gov" },
  { id: "products", label: "Products and safety", anchor: "alt-products" },
  { id: "market", label: "Market, ownership and attention", anchor: "alt-market" },
  { id: "banking", label: "Banking", anchor: "alt-banking" },
  { id: "events", label: "Corporate events", anchor: "alt-events" },
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
  events: { label: "Corporate events", blurb: "8-K items: deals, acquisitions, new debt, restructurings, impairments, executive and auditor changes, restatements, cyber incidents", source: "SEC EDGAR", theme: "events", measures: "8-K item", cadence: "Daily" },
};

const MINUS = "−";

/** One format for alt values: $1.2B, 3.4M, 12K, 2.50%, 0.84×, 85K lb; an en dash for missing. */
export function fmtAlt(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const sign = v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (unit === "USD") return `${sign}$${a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0)}`;
  if (unit === "%") return `${sign}${a.toFixed(2)}%`;
  if (unit === "ratio") return `${sign}${a.toFixed(2)}×`;
  if (unit === "lbs") return `${sign}${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}K` : Math.round(a).toLocaleString("en-US")} lb`;
  return `${sign}${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}K` : Math.round(a * 100) / 100 === Math.round(a) ? Math.round(a).toLocaleString("en-US") : a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** A signed change as a percentage ("+5.7%", "−12%"); one decimal under 10%. */
export function fmtChange(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "–";
  if (c >= 10) return "> +999%";
  const p = Math.abs(c * 100);
  return `${c < 0 ? MINUS : "+"}${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
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
