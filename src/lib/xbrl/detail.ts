// Filing detail: the dimensional disclosures in one 10-K or 10-Q, grouped into tables an analyst
// reads — revenue by product, geography, segment and customer; each segment's costs; customer,
// supplier and geographic concentration; purchase obligations and backlog; inventory; where the
// long-lived assets sit. Pure: built by scripts/xbrl-detail.ts, rendered by the Financials tab.
import { humanize, type XbrlContext, type XbrlFact } from "@/lib/xbrl/inline";

export const DETAIL_FORMAT = 3;

export interface DetailValue {
  v: number;
  /** iXBRL element id for the exact tag */
  id?: string;
}
export interface DetailPeriod {
  key: string;
  /** column heading for maturity buckets ("Year 1", "After year 5") */
  label?: string;
  start?: string;
  end: string;
  /** 12 = fiscal year, 3 = quarter, 0 = as of a date */
  months: number;
}
export interface DetailRow {
  member: string;
  label: string;
  values: Record<string, DetailValue>;
  /** second-level split (e.g. product lines inside one segment) */
  sub?: DetailRow[];
}
export interface DetailTable {
  id: string;
  family: DetailFamily;
  title: string;
  concept: string;
  conceptLabel: string;
  axis: string;
  axisLabel: string;
  unit: string;
  periods: string[];
  rows: DetailRow[];
  /** the undimensioned (consolidated) value of the same concept, when tagged */
  total?: Record<string, DetailValue>;
}
/** Segment P&L: one row per tagged line, one column per segment. */
export interface SegmentMatrix {
  periods: string[];
  segments: { member: string; label: string }[];
  rows: { concept: string; label: string; kind: "revenue" | "cost" | "profit" | "other"; values: Record<string, Record<string, DetailValue>> }[];
}
export interface ConcentrationRow {
  kind: "customer" | "supplier" | "geographic" | "product" | "credit" | "other";
  benchmark: "revenue" | "receivables" | "purchases" | "other";
  benchmarkLabel: string;
  member: string;
  label: string;
  /** share as a fraction (0.22 = 22%) per period key */
  values: Record<string, DetailValue>;
}
export type DetailFamily = "revenue" | "costs" | "concentration" | "geography" | "commitments" | "inventory" | "other";

export interface FilingDetail {
  format: number;
  ticker: string;
  accn: string;
  form: string;
  filed: string;
  reportDate: string;
  doc: string;
  periods: Record<string, DetailPeriod>;
  tables: DetailTable[];
  segments: SegmentMatrix | null;
  concentration: ConcentrationRow[];
  counts: { facts: number; dimensional: number };
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY + 1;

export const AXIS_LABEL: Record<string, string> = {
  "srt:ProductOrServiceAxis": "Product / service",
  "us-gaap:StatementBusinessSegmentsAxis": "Segment",
  "srt:StatementGeographicalAxis": "Geography",
  "srt:MajorCustomersAxis": "Major customer",
  "us-gaap:ContractWithCustomerSalesChannelAxis": "Sales channel",
  "us-gaap:TimingOfTransferOfGoodOrServiceAxis": "Timing",
  "us-gaap:PropertyPlantAndEquipmentByTypeAxis": "Asset type",
  "us-gaap:UnrecordedUnconditionalPurchaseObligationByCategoryOfItemPurchasedAxis": "Purchase category",
  "us-gaap:ContractWithCustomerDurationAxis": "Contract duration",
  "us-gaap:InventoryByTypeAxis": "Inventory type",
};

/** Axes whose tables are accounting plumbing rather than business detail. */
const NOISE_AXES = /Litigation|LossContingency|EquityComponents|AwardType|FairValue|RetirementPlan|DefinedBenefit|IncomeTaxAuthority|LongtermDebtType|DebtInstrument|ShareRepurchase|SubsequentEvent|srt:RangeAxis|BusinessAcquisition|FinancialInstrument|ValuationAllowances|RestatementAdjustment|StatementClassOfStock|LegalEntity|RelatedParty|PlanName|Hedging|DerivativeInstrument|CreditFacility|LineOfCredit|Lessee|Lease|TitleOfIndividual|Director|Executive|Restructuring|Investment|Securit|Pledged|Maturity|ScenarioAxis|AdjustmentsForNewAccountingPronouncements|ChangeInAccountingEstimate|Antidilutive|Warrant|Option|Tranche|OwnershipAxis|Consolidated|Disposal|Award|Grant|TemporaryEquity|Partner|Variable|Collateral|Counterparty|Portfolio|Financing|Credit|Loan|Receivable|Liabilit|Tax|Unit|Vesting|Share|Stock|Equity/i;

const REVENUE = /Revenues? ?FromExternalCustomers|(^|:)(Revenues?|RevenueFromContractWithCustomer(Excluding|Including)AssessedTax|SalesRevenue(Net|GoodsNet|ServicesNet)|RevenuesNetOfInterestExpense|NetSales|Sales)$|Revenue$/;
const NOT_REVENUE = /Deferred|Receivable|Obligation|Unbilled|Cost|Expense|Allowance|Reserve|Recognized(Prior|In)|Increase|Decrease|Percentage/i;
const COST = /Cost|Expense|Expenses|Charges?$|Fuel|Labor|Depreciation|Amortization|Impairment|Payments?ToSuppliers|MaterialsAndSupplies|Purchases/i;
const PROFIT = /(OperatingIncomeLoss|GrossProfit|NetIncomeLoss|IncomeLossFromContinuingOperations|SegmentProfit|ProfitLoss|OperatingProfit|AdjustedEBITDA|Ebitda)/i;
const COMMIT = /PurchaseObligation|UnconditionalPurchaseObligation|RemainingPerformanceObligation|ContractualObligation|LongTermPurchaseCommitment|Backlog/i;
const INVENTORY = /^(us-gaap:)?Inventory(RawMaterials|WorkInProcess|FinishedGoods|Supplies|Parts|LIFOReserve|Gross|Net|ValuationReserves|NetOfAllowances)|Inventory(RawMaterialsAndSupplies|FinishedGoodsAndWorkInProcess)/i;
const ASSETS_GEO = /LongLivedAssets|PropertyPlantAndEquipment(Net|Gross)|NoncurrentAssets|OperatingLeaseRightOfUseAsset/i;
const CONC = /ConcentrationRiskPercentage[12]?$/;
/** Liability roll-forwards and claim-development triangles: real, but not business detail. */
const NOISE_CONCEPT = /Cumulative|Liabilit|Reinsurance|HeldForSale|NotSeparatelyPresented|ShortDuration|LongDuration|Accretion|Deferred|IncomeTaxExpense|IncomeTaxesPaid|UnrecognizedTaxBenefits|Goodwill|Translation|Acquisition|Intangible|Allowance|Derivative|Notional|ShareBased|StockBased|Compensation|AggregateAvailable|TradingArrangement|AccumulatedDepreciation|AccumulatedAmortization|OtherCommitment|Litigation|LossContingency|IncreaseDecrease|CashAndCashEquivalents/i;

/** Maturity ladders ("…DueInSecondYear", "…ToBePaidYearThree"): bucket order and heading. */
const BUCKETS: [RegExp, number, string][] = [
  [/(RemainderOfFiscalYear|DueInRemainderOfFiscalYear)$/, 0, "Rest of year"],
  [/BalanceOnFirstAnniversary$/, 1, "Year 1"],
  [/BalanceOnSecondAnniversary$/, 2, "Year 2"],
  [/BalanceOnThirdAnniversary$/, 3, "Year 3"],
  [/BalanceOnFourthAnniversary$/, 4, "Year 4"],
  [/BalanceOnFifthAnniversary$/, 5, "Year 5"],
  [/BalanceAfterFifthAnniversary$/, 6, "After year 5"],
  [/(DueInNextTwelveMonths|DueNextTwelveMonths|NextTwelveMonths|YearOne|DueInNextRollingTwelveMonths|InRollingYearOne)$/, 1, "Year 1"],
  [/(DueInSecondYear|SecondYear|YearTwo|InRollingYearTwo|TwoYears|InTwoYears)$/, 2, "Year 2"],
  [/(DueInThirdYear|ThirdYear|YearThree|InRollingYearThree|ThreeYears|InThreeYears)$/, 3, "Year 3"],
  [/(DueInFourthYear|FourthYear|YearFour|InRollingYearFour|FourYears|InFourYears)$/, 4, "Year 4"],
  [/(DueInFifthYear|FifthYear|YearFive|InRollingYearFive|FiveYears|InFiveYears)$/, 5, "Year 5"],
  [/(DueAfterFifthYear|DueAfterFiveYears|AfterFiveYears|AfterYearFive|Thereafter|DueThereafter|InRollingAfterYearFive)$/, 6, "After year 5"],
];
export function bucketOf(concept: string): { base: string; order: number; label: string } | null {
  // "After year five" first, or "…AfterFifthYear" would read as year five.
  for (const [re, order, label] of [...BUCKETS].sort((a, b) => b[1] - a[1])) {
    const m = concept.match(re);
    if (m) return { base: concept.slice(0, m.index).replace(/(ToBePaid|DueIn|Due|Payments?Due|In)$/, ""), order, label };
  }
  return null;
}

/** Plain names for the standard concepts that carry long official labels. */
const SHORT: Record<string, string> = {
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax": "Revenue",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax": "Revenue",
  "us-gaap:Revenues": "Revenue",
  "us-gaap:SalesRevenueNet": "Revenue",
  "us-gaap:RevenuesNetOfInterestExpense": "Revenue, net of interest expense",
  "us-gaap:CostOfGoodsAndServicesSold": "Cost of goods and services sold",
  "us-gaap:CostOfRevenue": "Cost of revenue",
  "us-gaap:OperatingIncomeLoss": "Operating income",
  "us-gaap:LongLivedAssets": "Long-lived assets",
  "us-gaap:PropertyPlantAndEquipmentNet": "Property, plant and equipment, net",
  "us-gaap:PropertyPlantAndEquipmentGross": "Property, plant and equipment, gross",
  "us-gaap:UnrecordedUnconditionalPurchaseObligation": "Purchase obligations",
  "us-gaap:RevenueRemainingPerformanceObligation": "Remaining performance obligations (backlog)",
};

const SEG = "us-gaap:StatementBusinessSegmentsAxis";
const CONS = "srt:ConsolidationItemsAxis";

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
let regionNames: Intl.DisplayNames | null = null;
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Human label for a member: the filing's own label, states and countries by name, else the QName spelled out. */
export function memberLabel(member: string, labels: Map<string, string>): string {
  const own = labels.get(member);
  const [ns, local] = member.split(":");
  if (ns === "stpr") return STATES[local] ?? (own ? titleCase(own) : local);
  if (ns === "country") {
    try {
      regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
      return regionNames.of(local) ?? own ?? local;
    } catch {
      return own ?? local;
    }
  }
  return own ?? humanize(member);
}

const conceptLabel = (c: string, labels: Map<string, string>) => SHORT[c] ?? labels.get(c) ?? humanize(c);

/** Period key and shape for a context; durations other than a year or a quarter are dropped. */
function periodOf(ctx: XbrlContext): DetailPeriod | null {
  if (ctx.instant) return { key: `I${ctx.instant}`, end: ctx.instant, months: 0 };
  if (!ctx.start || !ctx.end) return null;
  const d = days(ctx.start, ctx.end);
  const months = d >= 350 && d <= 380 ? 12 : d >= 84 && d <= 98 ? 3 : null;
  return months ? { key: `D${ctx.start}_${ctx.end}`, start: ctx.start, end: ctx.end, months } : null;
}

/** The filing's own dimensions, with the "operating segments" consolidation marker folded away. */
function dimsOf(ctx: XbrlContext): [string, string][] {
  const dims = ctx.dims.filter(([a, m]) => !(a === CONS && m === "us-gaap:OperatingSegmentsMember"));
  // Corporate / eliminations columns tagged only on the consolidation axis read as extra segment columns.
  if (dims.length === 1 && dims[0][0] === CONS && !ctx.dims.some(([a]) => a === SEG)) return [[SEG, dims[0][1]]];
  return dims.filter(([a]) => a !== CONS);
}

const familyOf = (concept: string, axis: string): DetailFamily | null => {
  if (COMMIT.test(concept)) return "commitments";
  if (INVENTORY.test(concept)) return "inventory";
  if (REVENUE.test(concept) && !NOT_REVENUE.test(concept.split(":")[1] ?? concept)) return axis === "srt:StatementGeographicalAxis" ? "geography" : "revenue";
  if (axis === "srt:StatementGeographicalAxis" && ASSETS_GEO.test(concept)) return "geography";
  if (axis === "us-gaap:PropertyPlantAndEquipmentByTypeAxis") return "inventory";
  if (NOISE_CONCEPT.test(concept)) return null;
  if (COST.test(concept) && (axis === "srt:ProductOrServiceAxis" || axis === "srt:StatementGeographicalAxis")) return "costs";
  if (NOISE_AXES.test(axis)) return null;
  return "other";
};

const TITLE: Record<DetailFamily, string> = {
  revenue: "Revenue",
  costs: "Costs",
  concentration: "Concentration",
  geography: "Geography",
  commitments: "Commitments & backlog",
  inventory: "Inventory & assets",
  other: "Other",
};

/**
 * Build the detail of one filing. `fiscal` keeps only the filing's main period type: fiscal years for a
 * 10-K, quarters for a 10-Q (instants always).
 */
export function buildDetail(input: {
  ticker: string;
  accn: string;
  form: string;
  filed: string;
  reportDate: string;
  doc: string;
  facts: XbrlFact[];
  contexts: Map<string, XbrlContext>;
  labels: Map<string, string>;
}): FilingDetail {
  const { facts, contexts, labels } = input;
  const annual = /^10-K/.test(input.form);
  const periods: Record<string, DetailPeriod> = {};
  const keep = (p: DetailPeriod | null) => !!p && (p.months === 0 || p.months === (annual ? 12 : 3)) && p.end <= input.reportDate.slice(0, 10).padEnd(10, "9");
  const total = new Map<string, Record<string, DetailValue>>(); // concept|unit → period → value
  type Cell = { f: XbrlFact; p: DetailPeriod; dims: [string, string][] };
  const cells: Cell[] = [];
  let dimensional = 0;
  for (const f of facts) {
    const ctx = contexts.get(f.context);
    if (!ctx || ctx.typed) continue;
    const p = periodOf(ctx);
    if (!keep(p)) continue;
    const dims = dimsOf(ctx);
    if (!dims.length) {
      const k = `${f.concept}|${f.unit}`;
      const m = total.get(k) ?? {};
      m[p!.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
      total.set(k, m);
      if (INVENTORY.test(f.concept) || COMMIT.test(f.concept)) cells.push({ f, p: p!, dims: [] });
      continue;
    }
    dimensional++;
    cells.push({ f, p: p!, dims });
  }

  // ---- Concentration: type × benchmark × the concentrated item.
  const concentration = new Map<string, ConcentrationRow>();
  const kindOf = (m: string): ConcentrationRow["kind"] =>
    /CustomerConcentration/i.test(m) ? "customer" : /SupplierConcentration|Vendor/i.test(m) ? "supplier" : /GeographicConcentration/i.test(m) ? "geographic" : /ProductConcentration/i.test(m) ? "product" : /CreditConcentration/i.test(m) ? "credit" : "other";
  const benchOf = (m: string): ConcentrationRow["benchmark"] =>
    /Revenue|Sales/i.test(m) ? "revenue" : /Receivable/i.test(m) ? "receivables" : /CostOfGoods|Purchases|Supplier|Inventory/i.test(m) ? "purchases" : "other";

  // ---- Tables keyed by family, concept, unit and axis (second axis nests under the first).
  const tables = new Map<string, DetailTable & { _rows: Map<string, DetailRow> }>();
  const seg = new Map<string, SegmentMatrix["rows"][number]>();
  const segMembers = new Map<string, string>();
  const used = new Set<string>();
  for (const { f, p, dims } of cells) {
    used.add(p.key);
    if (CONC.test(f.concept)) {
      const type = dims.find(([a]) => /ConcentrationRiskByTypeAxis/.test(a))?.[1] ?? "";
      const bench = dims.find(([a]) => /ConcentrationRiskByBenchmarkAxis/.test(a))?.[1] ?? "";
      const item = dims.find(([a]) => !/ConcentrationRiskBy(Type|Benchmark)Axis/.test(a));
      // "Geographic concentration: 100%" without the region it concerns says nothing.
      if (!item) continue;
      if (!/Concentration/i.test(type) && !bench) continue;
      const member = item[1];
      const key = `${type}|${bench}|${member}`;
      const row = concentration.get(key) ?? {
        kind: kindOf(type),
        benchmark: benchOf(bench),
        benchmarkLabel: bench ? memberLabel(bench, labels) : "",
        member,
        label: memberLabel(item[1], labels),
        values: {},
      };
      row.values[p.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
      concentration.set(key, row);
      continue;
    }
    if (!dims.length) {
      // Undimensioned inventory components and obligations form their own list.
      const fam: DetailFamily = INVENTORY.test(f.concept) ? "inventory" : "commitments";
      const id = `${fam}|lines|${f.unit}`;
      const t = tables.get(id) ?? { id, family: fam, title: fam === "inventory" ? "Inventory components" : "Obligations and backlog", concept: "", conceptLabel: "", axis: "", axisLabel: "Line", unit: f.unit, periods: [], rows: [], _rows: new Map() };
      tables.set(id, t);
      const r = t._rows.get(f.concept) ?? { member: f.concept, label: conceptLabel(f.concept, labels), values: {} };
      r.values[p.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
      t._rows.set(f.concept, r);
      continue;
    }
    // Segment P&L matrix: every monetary flow tagged on the segment axis alone.
    if (dims.length === 1 && dims[0][0] === SEG && f.unit === "USD" && p.months && !NOISE_CONCEPT.test(f.concept)) {
      const member = dims[0][1];
      segMembers.set(member, memberLabel(member, labels));
      const kind = REVENUE.test(f.concept) && !NOT_REVENUE.test(f.concept) ? "revenue" : PROFIT.test(f.concept) ? "profit" : COST.test(f.concept) ? "cost" : "other";
      const row = seg.get(f.concept) ?? { concept: f.concept, label: conceptLabel(f.concept, labels), kind, values: {} };
      (row.values[member] ??= {})[p.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
      seg.set(f.concept, row);
    }
    if (dims.length > 2) continue;
    // Nest the second axis under the segment (segment → product), else under the first axis.
    const [outer, inner] = dims.length === 2 ? (dims[1][0] === SEG ? [dims[1], dims[0]] : [dims[0], dims[1]]) : [dims[0], undefined];
    const family = familyOf(f.concept, inner && outer[0] === SEG ? inner[0] : outer[0]);
    if (!family) continue;
    // Single-axis segment lines are all in the segment P&L; only the revenue mix repeats them.
    if (!inner && outer[0] === SEG && family === "other") continue;
    const id = `${family}|${f.concept}|${f.unit}|${outer[0]}${inner ? `|${inner[0]}` : ""}`;
    let t = tables.get(id);
    if (!t) {
      const axisLabel = AXIS_LABEL[outer[0]] ?? memberLabel(outer[0], labels);
      const innerLabel = inner ? (AXIS_LABEL[inner[0]] ?? memberLabel(inner[0], labels)) : "";
      const cl = conceptLabel(f.concept, labels);
      t = { id, family, title: `${cl} by ${axisLabel.toLowerCase()}${inner ? ` and ${innerLabel.toLowerCase()}` : ""}`, concept: f.concept, conceptLabel: cl, axis: outer[0], axisLabel, unit: f.unit, periods: [], rows: [], _rows: new Map() };
      tables.set(id, t);
    }
    let row = t._rows.get(outer[1]);
    if (!row) t._rows.set(outer[1], (row = { member: outer[1], label: memberLabel(outer[1], labels), values: {} }));
    if (inner) {
      row.sub ??= [];
      let s = row.sub.find((x) => x.member === inner[1]);
      if (!s) row.sub.push((s = { member: inner[1], label: memberLabel(inner[1], labels), values: {} }));
      s.values[p.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
    } else row.values[p.key] ??= { v: f.value, ...(f.id ? { id: f.id } : {}) };
  }

  for (const k of used) {
    const c = [...contexts.values()].find((x) => periodOf(x)?.key === k);
    const p = c && periodOf(c);
    if (p) periods[k] = p;
  }
  const byEnd = (a: string, b: string) => (periods[a]?.end ?? "").localeCompare(periods[b]?.end ?? "");

  const out: DetailTable[] = [];
  for (const t of tables.values()) {
    const rows = [...t._rows.values()];
    const keys = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.values)) keys.add(k);
      for (const s of r.sub ?? []) for (const k of Object.keys(s.values)) keys.add(k);
    }
    const ps = [...keys].sort(byEnd).slice(-3);
    const latest = ps[ps.length - 1];
    const size = (r: DetailRow) => Math.abs(r.values[latest]?.v ?? r.sub?.reduce((n, s) => n + Math.abs(s.values[latest]?.v ?? 0), 0) ?? 0);
    rows.sort((a, b) => size(b) - size(a));
    for (const r of rows) r.sub?.sort((a, b) => Math.abs(b.values[latest]?.v ?? 0) - Math.abs(a.values[latest]?.v ?? 0));
    // A table needs at least two items (one member alone is a footnote, not a breakdown).
    const items = rows.length + rows.reduce((n, r) => n + (r.sub?.length ?? 0), 0);
    if (items < 2 && t.family !== "commitments" && t.family !== "inventory") continue;
    // One inner member under every row (e.g. "aircraft type × purchase commitments"): flatten it.
    const inner = new Set(rows.flatMap((r) => (r.sub ?? []).map((x) => x.member)));
    let title = t.title;
    if (inner.size === 1 && rows.every((r) => r.sub?.length === 1 && !Object.keys(r.values).length)) {
      const only = rows[0].sub![0].label;
      for (const r of rows) {
        r.values = r.sub![0].values;
        delete r.sub;
      }
      title = `${title.replace(/ and [^—]+$/, "")} — ${only}`;
    }
    const tot = t.concept ? total.get(`${t.concept}|${t.unit}`) : undefined;
    // A consolidated figure the items cannot plausibly add up to is a reused tag, not this table's total.
    const sum = rows.reduce((n, r) => n + (r.values[latest]?.v ?? r.sub?.reduce((m, x) => m + (x.values[latest]?.v ?? 0), 0) ?? 0), 0);
    const okTotal = tot && tot[latest] && tot[latest].v !== 0 && sum / tot[latest].v >= 0.3 && sum / tot[latest].v <= 1.5;
    const { _rows, ...rest } = t;
    out.push({ ...rest, title, periods: ps, rows, ...(okTotal ? { total: Object.fromEntries(ps.flatMap((k) => (tot![k] ? [[k, tot![k]]] : []))) } : {}) });
  }
  // Two concepts with the same plain name (contract revenue vs total revenue) keep their official labels.
  const titles = new Map<string, number>();
  for (const t of out) titles.set(t.title, (titles.get(t.title) ?? 0) + 1);
  for (const t of out)
    if ((titles.get(t.title) ?? 0) > 1 && t.concept && SHORT[t.concept]) {
      const official = labels.get(t.concept) ?? humanize(t.concept);
      t.title = t.title.replace(t.conceptLabel, official);
      t.conceptLabel = official;
    }

  // Maturity ladders: one table per obligation, a column per year bucket, instead of a table per year.
  const ladders = new Map<string, DetailTable>();
  const flat: DetailTable[] = [];
  const ladderOf = (id: string, base: string, t: DetailTable, member?: boolean) => {
    let L = ladders.get(id);
    if (!L) {
      const cl = conceptLabel(base, labels);
      L = { id, family: "commitments", title: member ? `${cl} by year due — ${t.axisLabel.toLowerCase()}` : "Obligations by year due", concept: base, conceptLabel: cl, axis: member ? t.axis : "", axisLabel: member ? t.axisLabel : "Obligation", unit: t.unit, periods: [], rows: [] };
      ladders.set(id, L);
    }
    return L;
  };
  const put = (L: DetailTable, member: string, label: string, b: { order: number; label: string }, v: DetailValue | undefined) => {
    if (!v) return;
    const key = `B${b.order}`;
    periods[key] = { key, label: b.label, end: input.reportDate, months: 0 };
    if (!L.periods.includes(key)) L.periods.push(key);
    let r = L.rows.find((x) => x.member === member);
    if (!r) L.rows.push((r = { member, label, values: {} }));
    r.values[key] = v;
  };
  for (const t of out) {
    const latest = t.periods[t.periods.length - 1];
    const b = t.concept ? bucketOf(t.concept) : null;
    if (b) {
      const L = ladderOf(`ladder|${b.base}|${t.unit}|${t.axis}`, b.base, t, true);
      for (const r of t.rows) put(L, r.member, r.label, b, r.values[latest]);
      continue;
    }
    if (!t.concept) {
      const keep = t.rows.filter((r) => {
        const rb = bucketOf(r.member);
        if (!rb) return true;
        put(ladderOf(`ladder|lines|${t.unit}`, "", t), rb.base, conceptLabel(rb.base, labels), rb, r.values[latest]);
        return false;
      });
      if (keep.length) flat.push({ ...t, rows: keep });
      continue;
    }
    flat.push(t);
  }
  for (const L of ladders.values()) {
    L.periods.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (L.periods.length >= 2) flat.push(L);
  }
  out.length = 0;
  // The same disclosure tagged under two concepts shows once; other look-alikes get their concept named.
  const sig = (t: DetailTable) => JSON.stringify([t.unit, t.axis, t.rows.map((r) => [r.member, r.values[t.periods[t.periods.length - 1]]?.v])]);
  const sigs = new Set<string>();
  for (const t of flat) {
    const k = sig(t);
    if (sigs.has(k)) continue;
    sigs.add(k);
    out.push(t);
  }
  const named = new Map<string, number>();
  for (const t of out) named.set(t.title, (named.get(t.title) ?? 0) + 1);
  for (const t of out)
    if ((named.get(t.title) ?? 0) > 1) {
      const extra = t.concept ? humanize(t.concept) : detailUnit(t.unit) === "count" ? t.unit.replace(/^.*:/, "").toLowerCase() : t.unit === "USD" ? "" : t.unit;
      if (extra && !t.title.includes(extra)) t.title = `${t.title} (${extra})`;
    }

  const familyRank: DetailFamily[] = ["revenue", "costs", "geography", "concentration", "commitments", "inventory", "other"];
  const axisRank = (a: string) => ["us-gaap:StatementBusinessSegmentsAxis", "srt:ProductOrServiceAxis", "srt:StatementGeographicalAxis", "srt:MajorCustomersAxis"].indexOf(a) + 1 || 9;
  out.sort((a, b) => familyRank.indexOf(a.family) - familyRank.indexOf(b.family) || axisRank(a.axis) - axisRank(b.axis) || b.rows.length - a.rows.length);

  let segments: SegmentMatrix | null = null;
  if (segMembers.size >= 2 && seg.size >= 2) {
    const keys = new Set<string>();
    for (const r of seg.values()) for (const m of Object.values(r.values)) for (const k of Object.keys(m)) keys.add(k);
    const ps = [...keys].sort(byEnd).slice(-3);
    const latest = ps[ps.length - 1];
    const rank = { revenue: 0, cost: 1, profit: 2, other: 3 };
    const rows = [...seg.values()].filter((r) => Object.values(r.values).filter((m) => m[latest]).length >= 2);
    rows.sort((a, b) => rank[a.kind] - rank[b.kind] || Object.values(b.values).reduce((n, m) => n + Math.abs(m[latest]?.v ?? 0), 0) - Object.values(a.values).reduce((n, m) => n + Math.abs(m[latest]?.v ?? 0), 0));
    const revenueOf = (m: string) => Math.abs(rows.find((r) => r.kind === "revenue")?.values[m]?.[latest]?.v ?? 0);
    const members = [...segMembers.entries()].map(([member, label]) => ({ member, label })).sort((a, b) => revenueOf(b.member) - revenueOf(a.member));
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.label, (seen.get(r.label) ?? 0) + 1);
    for (const r of rows) if ((seen.get(r.label) ?? 0) > 1) r.label = labels.get(r.concept) ?? humanize(r.concept);
    if (rows.length >= 2) segments = { periods: ps, segments: members, rows };
  }

  const conc = [...concentration.values()].filter((r) => r.kind !== "other" || r.benchmark !== "other").sort((a, b) => {
    const order = ["customer", "supplier", "geographic", "product", "credit", "other"];
    const last = (r: ConcentrationRow) => Object.entries(r.values).sort(([x], [y]) => byEnd(x, y)).at(-1)?.[1].v ?? 0;
    return order.indexOf(a.kind) - order.indexOf(b.kind) || last(b) - last(a);
  });

  return {
    format: DETAIL_FORMAT,
    ticker: input.ticker,
    accn: input.accn,
    form: input.form,
    filed: input.filed,
    reportDate: input.reportDate,
    doc: input.doc,
    periods,
    tables: out,
    segments,
    concentration: conc,
    counts: { facts: facts.length, dimensional },
  };
}

export const FAMILY_TITLE = TITLE;

/** What `detail/TICKER.json` holds: the latest 10-K and the latest 10-Q filed after it. */
export interface StoredDetail {
  ticker: string;
  builtAt: string;
  format: number;
  annual: FilingDetail | null;
  quarterly: FilingDetail | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Column heading: "FY2026", "Jun 2026 qtr", "Sep 2026" (as of) or a maturity bucket. */
export function detailPeriodLabel(p: DetailPeriod | undefined): string {
  if (!p) return "";
  if (p.label) return p.label;
  if (p.months === 12) return `FY${p.end.slice(0, 4)}`;
  if (p.months === 3) return `${monthYear(p.end)} qtr`;
  return monthYear(p.end);
}

/** App unit for an XBRL unit; anything else (aircraft, stores, employees) is a plain count. */
export function detailUnit(unit: string): "usd" | "shares" | "pct" | "usdPerShare" | "count" {
  const u = unit.toLowerCase();
  if (u === "usd") return "usd";
  if (u === "shares") return "shares";
  if (u === "pure") return "pct";
  if (u === "usd/shares") return "usdPerShare";
  return "count";
}

/** Share of the consolidated total that the listed items explain, for the latest period. */
export function coverageOf(t: DetailTable): number | null {
  const k = t.periods[t.periods.length - 1];
  const total = t.total?.[k]?.v;
  if (!total) return null;
  const sum = t.rows.reduce((n, r) => n + (r.values[k]?.v ?? r.sub?.reduce((m, s) => m + (s.values[k]?.v ?? 0), 0) ?? 0), 0);
  return sum / total;
}

/** Change between the two latest comparable periods of a row (same length), as a fraction. */
export function changeOf(t: DetailTable, values: Record<string, DetailValue>, periods: Record<string, DetailPeriod>): number | null {
  const ks = t.periods.filter((k) => periods[k] && !periods[k].label);
  if (ks.length < 2) return null;
  const [a, b] = [ks[ks.length - 2], ks[ks.length - 1]];
  if (periods[a].months !== periods[b].months) return null;
  const x = values[a]?.v;
  const y = values[b]?.v;
  return x && y !== undefined && x > 0 ? y / x - 1 : null;
}
