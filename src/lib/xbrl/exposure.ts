// Cross-company views built from every company's stored filing detail: revenue exposure by region
// (from each 10-K's revenue-by-geography table that ties to its consolidated total) and loan-book
// metrics for banks and lenders. Pure: `scripts/xbrl-detail.ts` writes the index, the Exposures page
// and the assistant read it. Every number keeps the tags it came from, so click-to-source works.
import { detailPeriodLabel, type DetailPeriod, type DetailRow, type DetailTable, type FilingDetail, type StoredDetail } from "@/lib/xbrl/detail";
import { annualWithHistory } from "@/lib/xbrl/history";

/** One tagged value: filing, concept, period and the iXBRL element id. */
export interface ExpRef {
  accn: string;
  doc: string;
  concept: string;
  start?: string;
  end: string;
  value: number;
  id?: string;
  label?: string;
  /** −1 when the part is subtracted (net charge-offs = gross − recoveries) */
  sign?: -1;
}
/** A figure that is either one tag (one part) or the sum (with signs) of the listed tags. */
export interface ExpVal {
  v: number;
  parts: ExpRef[];
}
export interface RegionExposure {
  key: string;
  /** the region as the filing names it */
  label: string;
  value: ExpVal;
  total: ExpVal;
  share: number;
  period: string;
  /** the same region about three years earlier, when the stored filings reach that far */
  prior?: { share: number; period: string; years: number; value: ExpVal; total: ExpVal };
}
export interface CompanyExposure {
  fyEnd: string;
  table: string;
  regions: RegionExposure[];
}
export interface BankMetrics {
  end: string;
  loans: ExpVal;
  loansPrior?: ExpVal & { end: string };
  deposits?: ExpVal;
  depositsPrior?: ExpVal & { end: string };
  nco?: ExpVal & { period: string };
  allowance?: ExpVal;
  nonaccrual?: ExpVal;
}
/** An insurer's fiscal year: premiums, losses and benefits, reserve development, acquisition costs, reserves. */
export interface InsurerMetrics {
  end: string;
  /** premium revenue: net premiums earned (or a health plan's premium revenue) */
  earned: ExpVal;
  earnedPrior?: ExpVal & { end: string };
  written?: ExpVal;
  losses?: ExpVal;
  /** prior-year reserve development: positive = reserves strengthened (adverse), negative = released */
  priorYear?: ExpVal;
  acquisition?: ExpVal;
  underwriting?: ExpVal;
  /** loss and loss-expense reserves at year-end */
  reserves?: ExpVal;
}
export interface ExposureIndex {
  builtAt: string;
  companies: Record<string, { exposure?: CompanyExposure; bank?: BankMetrics; insurer?: InsurerMetrics }>;
}

export const REGION_NAMES: Record<string, string> = {
  us: "United States",
  china: "China / Greater China",
  taiwan: "Taiwan",
  japan: "Japan",
  korea: "South Korea",
  india: "India",
  apac: "Asia Pacific",
  europe: "Europe / EMEA",
  uk: "United Kingdom",
  germany: "Germany",
  france: "France",
  ireland: "Ireland",
  netherlands: "Netherlands",
  switzerland: "Switzerland",
  singapore: "Singapore",
  canada: "Canada",
  mexico: "Mexico",
  brazil: "Brazil",
  latam: "Latin America",
  americas: "Americas",
  intl: "Outside the US",
};
const COUNTRY: Record<string, string> = { US: "us", CN: "china", TW: "taiwan", JP: "japan", KR: "korea", IN: "india", GB: "uk", DE: "germany", FR: "france", IE: "ireland", NL: "netherlands", CH: "switzerland", SG: "singapore", CA: "canada", MX: "mexico", BR: "brazil" };

/** Canonical region key for a geography member, or null for "other" / mixed buckets. */
export function regionKey(member: string, label: string): string | null {
  const [ns, local] = member.split(":");
  if (ns === "country" && local) return COUNTRY[local] ?? local.toLowerCase();
  const l = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(other|rest of world|all other|remaining)\b/.test(l) && !/rest of asia/.test(l)) return /outside|non-u\.?s|international|foreign/.test(l) ? "intl" : null;
  if (/excluding|except|ex-|other than/.test(l) && !/outside (the )?(u\.?s|united states)|non-u\.?s/.test(l)) return null;
  if (/china|prc|mainland/.test(l)) return "china";
  if (/taiwan/.test(l)) return "taiwan";
  if (/japan/.test(l)) return "japan";
  if (/korea/.test(l)) return "korea";
  if (/\bindia\b/.test(l)) return "india";
  if (/asia|apac|pacific/.test(l)) return "apac";
  if (/united kingdom|^u\.?k\.?$|britain|england/.test(l)) return "uk";
  if (/germany/.test(l)) return "germany";
  if (/france/.test(l)) return "france";
  if (/ireland/.test(l)) return "ireland";
  if (/netherlands/.test(l)) return "netherlands";
  if (/switzerland/.test(l)) return "switzerland";
  if (/singapore/.test(l)) return "singapore";
  if (/europe|emea/.test(l)) return "europe";
  if (/canada/.test(l)) return "canada";
  if (/mexico/.test(l)) return "mexico";
  if (/brazil/.test(l)) return "brazil";
  if (/latin america|south america|latam|central america/.test(l)) return "latam";
  if (/outside (the )?(u\.?s|united states)|non-u\.?s|international|foreign/.test(l)) return "intl";
  if (/^(the )?united states( of america)?$|^u\.?s\.?(a\.?)?$|^us$|^domestic$|^north america$/.test(l)) return /north america/.test(l) ? "americas" : "us";
  if (/americas/.test(l)) return "americas";
  return null;
}

const REVENUE_CONCEPT = /(^|:)(Revenues?|RevenueFromContractWithCustomer(Excluding|Including)AssessedTax|SalesRevenue(Net|GoodsNet|ServicesNet)|RevenuesNetOfInterestExpense|NetSales|Sales)$/;

const refOf = (d: FilingDetail, t: DetailTable, k: string, v: { v: number; id?: string; accn?: string; doc?: string }, label?: string): ExpRef => {
  const p = d.periods[k];
  return { accn: v.accn ?? d.accn, doc: v.doc ?? d.doc, concept: t.concept || label || "", ...(p?.start ? { start: p.start } : {}), end: p?.end ?? d.reportDate, value: v.v, ...(v.id ? { id: v.id } : {}), ...(label ? { label } : {}) };
};

/** A row's value in one period: its own tag, else the sum of its nested rows' tags. */
function rowVal(d: FilingDetail, t: DetailTable, r: DetailRow, k: string): ExpVal | null {
  const own = r.values[k];
  if (own) return { v: own.v, parts: [refOf(d, t, k, own, r.label)] };
  const subs = (r.sub ?? []).filter((s) => s.values[k]);
  if (!subs.length) return null;
  return { v: subs.reduce((n, s) => n + s.values[k].v, 0), parts: subs.map((s) => refOf(d, t, k, s.values[k], s.label)) };
}

/** The table's consolidated total in one period, else the sum of its rows (each a part). */
function tableVal(d: FilingDetail, t: DetailTable, k: string): ExpVal | null {
  const tot = t.total?.[k];
  if (tot) return { v: tot.v, parts: [refOf(d, t, k, tot, `${t.conceptLabel} — total`)] };
  const rows = t.rows.map((r) => rowVal(d, t, r, k)).filter((x): x is ExpVal => !!x);
  if (!rows.length) return null;
  return { v: rows.reduce((n, x) => n + x.v, 0), parts: rows.flatMap((x) => x.parts) };
}

const yearsBetween = (a: DetailPeriod, b: DetailPeriod) => Math.round((Date.parse(b.end) - Date.parse(a.end)) / (365.25 * 86_400_000));

/** Revenue by region from the latest 10-K's geography table that has a consolidated total. */
export function exposureOf(stored: StoredDetail): CompanyExposure | null {
  const d = annualWithHistory(stored);
  if (!d) return null;
  const tables = d.tables.filter((t) => t.family === "geography" && REVENUE_CONCEPT.test(t.concept) && t.total && t.unit === "USD");
  const latestOf = (t: DetailTable) => t.periods.filter((k) => d.periods[k]?.months === 12).at(-1);
  const t = tables.filter((x) => { const k = latestOf(x); return k && x.total?.[k]; }).sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!t) return null;
  const k = latestOf(t)!;
  const total = tableVal(d, t, k)!;
  if (!(total.v > 0)) return null;
  const pk = d.periods[k];
  const regions: RegionExposure[] = [];
  const seen = new Set<string>();
  for (const r of t.rows) {
    const key = regionKey(r.member, r.label);
    if (!key || seen.has(key)) continue;
    const value = rowVal(d, t, r, k);
    if (!value || value.v <= 0 || value.v > total.v * 1.001) continue;
    seen.add(key);
    // About three years back (two to four), where both the row and the total were reported.
    const back = t.periods
      .filter((x) => x !== k && d.periods[x]?.months === 12 && r.values[x] && t.total?.[x])
      .map((x) => ({ x, yrs: yearsBetween(d.periods[x], pk) }))
      .filter((c) => c.yrs >= 2 && c.yrs <= 4)
      .sort((a, b) => Math.abs(a.yrs - 3) - Math.abs(b.yrs - 3))[0];
    const prior = back
      ? (() => {
          const pv = rowVal(d, t, r, back.x)!;
          const pt = tableVal(d, t, back.x)!;
          return pt.v > 0 ? { share: pv.v / pt.v, period: detailPeriodLabel(d.periods[back.x]), years: back.yrs, value: pv, total: pt } : undefined;
        })()
      : undefined;
    regions.push({ key, label: r.label, value, total, share: value.v / total.v, period: detailPeriodLabel(pk), ...(prior ? { prior } : {}) });
  }
  return regions.length ? { fyEnd: pk.end, table: t.title, regions } : null;
}

/** Consolidated concepts for each bank figure, most common first. */
const BANK_CONCEPTS = {
  loans: ["FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss", "LoansAndLeasesReceivableGrossCarryingAmount", "FinancingReceivableBeforeAllowanceForCreditLoss", "FinancingReceivableRecordedInvestment", "FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLossNetOfDeferredIncome", "LoansAndLeasesReceivableNetOfDeferredIncome", "NotesReceivableGross"],
  allowance: ["FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest", "FinancingReceivableAllowanceForCreditLosses", "FinancingReceivableAllowanceForCreditLoss"],
  nco: ["FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoffAfterRecovery", "FinancingReceivableAllowanceForCreditLossWriteoffAfterRecovery", "FinancingReceivableAllowanceForCreditLossesWriteOffsNet"],
  nonaccrual: ["FinancingReceivableExcludingAccruedInterestNonaccrual", "FinancingReceivableNonaccrual", "FinancingReceivableRecordedInvestmentNonaccrualStatus"],
  deposits: ["Deposits"],
} as const;

const LABEL: Record<keyof typeof BANK_CONCEPTS | "gross" | "recoveries", string> = { loans: "Loans", allowance: "Allowance for loan losses", nco: "Net charge-offs", nonaccrual: "Nonaccrual loans", deposits: "Total deposits", gross: "Gross charge-offs", recoveries: "Recoveries" };
/** A bank's own consolidated tag for the same figure (extension concepts). */
const OWN: Partial<Record<keyof typeof BANK_CONCEPTS, (c: string) => boolean>> = {
  loans: (c) => /BeforeAllowanceForCreditLoss$/.test(c),
  // the allowance itself, not loans before/after it; the loan-loss allowance before a broader credit-loss one
  allowance: (c) => /AllowanceFor(Loan|Credit)Loss(es)?(ExcludingAccruedInterest)?$/.test(c) && !/(After|Before)Allowance/.test(c),
  nco: (c) => /WriteoffAfterRecovery$/.test(c),
  nonaccrual: (c) => /Nonaccrual$/.test(c),
};
const GROSS = ["FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoff", "FinancingReceivableAllowanceForCreditLossWriteoff", "FinancingReceivableAllowanceForCreditLossesWriteOffs"];
const RECOVERIES = ["FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossRecovery", "FinancingReceivableAllowanceForCreditLossRecovery", "FinancingReceivableAllowanceForCreditLossesRecovery"];

/**
 * One consolidated bank figure at a period end: the undimensioned tag first, else the total a breakdown
 * table carries (never a sum of rows — banks tag overlapping components such as allowance + reserve).
 */
function bankFigure(d: FilingDetail, what: keyof typeof BANK_CONCEPTS, end: string, months: 0 | 12, concepts: readonly string[] = BANK_CONCEPTS[what], label = LABEL[what]): ExpVal | null {
  const fits = (k: string) => d.periods[k]?.end === end && d.periods[k].months === months && !d.periods[k].label;
  const tagged = (concept: string): ExpVal | null => {
    const m = d.consolidated?.[concept];
    const k = m && Object.keys(m).find(fits);
    return m && k ? { v: m[k].v, parts: [refOf(d, { concept } as DetailTable, k, m[k], label)] } : null;
  };
  const std = concepts.map((c) => tagged(`us-gaap:${c}`)).filter((x): x is ExpVal => !!x);
  const ownTest = OWN[what];
  const own =
    ownTest && concepts === BANK_CONCEPTS[what]
      ? Object.keys(d.consolidated ?? {})
          .filter((c) => !/^us-gaap:/.test(c) && ownTest(c))
          .sort((a, b) => Number(/LoanLoss/.test(b)) - Number(/LoanLoss/.test(a)))
          .map(tagged)
          .filter((x): x is ExpVal => !!x)
      : [];
  // Total loans: the broadest balance (a bank's own loans-and-leases total is the balance-sheet line).
  if (what === "loans" && (std.length || own.length)) return [...std, ...own].sort((a, b) => b.v - a.v)[0];
  if (std.length) return std[0];
  if (own.length) return own[0];
  for (const local of concepts) {
    const t = d.tables.find((x) => x.family === "lending" && x.concept === `us-gaap:${local}` && x.total);
    const k = t && Object.keys(t.total!).find(fits);
    if (t && k) return { v: t.total![k].v, parts: [refOf(d, t, k, t.total![k], label)] };
  }
  // Portfolio segments partition the book, and classes partition a segment (ASC 326): when every segment
  // reports its own figure or its classes', they add up.
  for (const local of concepts) {
    const t = d.tables.find((x) => x.family === "lending" && x.concept === `us-gaap:${local}` && x.axis === "us-gaap:FinancingReceivablePortfolioSegmentAxis" && (!/ — /.test(x.title) || /allowance for (credit|loan)/i.test(x.title)));
    if (!t || t.rows.length < 2 || t.rows.some((r) => /total|consolidated/i.test(r.label))) continue;
    const k = t.periods.find(fits);
    if (!k) continue;
    const segs = t.rows.map((r) => rowVal(d, t, { ...r, sub: r.sub?.filter((x) => !/total/i.test(x.label)) }, k));
    if (segs.some((x) => !x)) continue;
    return { v: segs.reduce((n, x) => n + x!.v, 0), parts: segs.flatMap((x) => x!.parts) };
  }
  return null;
}

/** Year-end dates the stored filings report loans for, newest first. */
function loanDates(d: FilingDetail): string[] {
  const ends = new Set<string>();
  for (const local of BANK_CONCEPTS.loans) {
    for (const k of Object.keys(d.consolidated?.[`us-gaap:${local}`] ?? {})) if (d.periods[k]?.months === 0) ends.add(d.periods[k].end);
    for (const t of d.tables) if (t.family === "lending" && t.concept === `us-gaap:${local}`) for (const k of [...Object.keys(t.total ?? {}), ...t.periods]) if (d.periods[k]?.months === 0) ends.add(d.periods[k].end);
  }
  return [...ends].sort().reverse();
}

/** Loan book, deposits, net charge-offs, allowance and nonaccrual loans for a bank or lender. */
export function bankMetricsOf(stored: StoredDetail): BankMetrics | null {
  const d = annualWithHistory(stored);
  if (!d || !stored.annual) return null;
  // Only the latest fiscal year-end counts; an older filing's tag must not stand in for today's book.
  const fye = Date.parse(stored.annual.reportDate);
  const dates = loanDates(d);
  const end = dates.find((e) => Math.abs(Date.parse(e) - fye) <= 7 * 86_400_000);
  if (!end) return null;
  const older = dates.filter((e) => e < end);
  const loans = bankFigure(d, "loans", end, 0);
  if (!loans || loans.v <= 0) return null;
  const prevEnd = older.find((e) => Math.round((Date.parse(end) - Date.parse(e)) / (365.25 * 86_400_000)) === 1);
  const loansPrior = prevEnd ? bankFigure(d, "loans", prevEnd, 0) : null;
  const deposits = bankFigure(d, "deposits", end, 0);
  const depositsPrior = prevEnd ? bankFigure(d, "deposits", prevEnd, 0) : null;
  // Net charge-offs: tagged, else gross charge-offs less recoveries (both tagged for the same year).
  let nco = bankFigure(d, "nco", end, 12);
  if (!nco) {
    const gross = bankFigure(d, "nco", end, 12, GROSS, LABEL.gross);
    const rec = bankFigure(d, "nco", end, 12, RECOVERIES, LABEL.recoveries);
    if (gross && rec) nco = { v: gross.v - rec.v, parts: [...gross.parts, ...rec.parts.map((p) => ({ ...p, sign: -1 as const }))] };
  }
  const allowance = bankFigure(d, "allowance", end, 0);
  const nonaccrual = bankFigure(d, "nonaccrual", end, 0);
  // Ratios outside plausible bounds mean the tags describe different scopes; leave them out.
  const ok = (x: ExpVal | null, lo: number, hi: number) => !!x && x.v / loans.v >= lo && x.v / loans.v <= hi;
  const ncoKey = nco ? Object.keys(d.periods).find((k) => d.periods[k].end === end && d.periods[k].months === 12) : undefined;
  // A notes-receivable line alone is not a lender; a lender also reports deposits or credit losses.
  if (!deposits && !ok(nco, -0.01, 0.25) && !ok(allowance, 0, 0.25)) return null;
  return {
    end,
    loans,
    ...(loansPrior && loansPrior.v > 0 ? { loansPrior: { ...loansPrior, end: prevEnd! } } : {}),
    ...(deposits && deposits.v > 0 ? { deposits } : {}),
    ...(depositsPrior && depositsPrior.v > 0 ? { depositsPrior: { ...depositsPrior, end: prevEnd! } } : {}),
    ...(nco && ok(nco, -0.01, 0.25) ? { nco: { ...nco, period: ncoKey ? detailPeriodLabel(d.periods[ncoKey]) : `FY${end.slice(0, 4)}` } } : {}),
    ...(allowance && ok(allowance, 0, 0.25) ? { allowance } : {}),
    ...(nonaccrual && ok(nonaccrual, 0, 0.25) ? { nonaccrual } : {}),
  };
}

const INS: Record<"earned" | "written" | "losses" | "priorYear" | "acquisition" | "underwriting" | "reserves", readonly string[]> = {
  earned: ["PremiumsEarnedNet", "HealthCareOrganizationPremiumRevenue", "SupplementaryInsuranceInformationPremiumRevenue"],
  written: ["PremiumsWrittenNet", "SupplementaryInsuranceInformationPremiumsWritten"],
  losses: ["PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability", "PolicyholderBenefitsAndClaimsIncurredHealthCare", "SupplementaryInsuranceInformationBenefitsClaimsLossesAndSettlementExpense"],
  priorYear: ["SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense"],
  acquisition: ["DeferredPolicyAcquisitionCostAmortizationExpense", "SupplementaryInsuranceInformationAmortizationOfDeferredPolicyAcquisitionCosts"],
  underwriting: ["UnderwritingIncomeLoss"],
  reserves: ["LiabilityForClaimsAndClaimsAdjustmentExpense", "SupplementaryInsuranceInformationLiabilityForFuturePolicyBenefitsLossesClaimsAndLossExpenseReserves"],
};
const INS_LABEL: Record<keyof typeof INS, string> = {
  earned: "Net premiums earned",
  written: "Net premiums written",
  losses: "Losses and benefits incurred",
  priorYear: "Prior-year reserve development",
  acquisition: "Acquisition cost amortization",
  underwriting: "Underwriting income",
  reserves: "Loss and loss-expense reserves",
};

/** One consolidated insurer figure: the undimensioned tag first, else the total its breakdown table carries. */
function insFigure(d: FilingDetail, what: keyof typeof INS, end: string): ExpVal | null {
  const months = what === "reserves" ? 0 : 12;
  const fits = (k: string) => d.periods[k]?.end === end && d.periods[k].months === months && !d.periods[k].label;
  for (const local of INS[what]) {
    const concept = `us-gaap:${local}`;
    const m = d.consolidated?.[concept];
    const k = m && Object.keys(m).find(fits);
    if (m && k) return { v: m[k].v, parts: [refOf(d, { concept } as DetailTable, k, m[k], INS_LABEL[what])] };
    const t = d.tables.find((x) => x.family === "insurance" && x.concept === concept && x.total && Object.keys(x.total).some(fits));
    const tk = t && Object.keys(t.total!).find(fits);
    if (t && tk) return { v: t.total![tk].v, parts: [refOf(d, t, tk, t.total![tk], INS_LABEL[what])] };
  }
  return null;
}

/** Premiums, losses, reserve development, acquisition costs and reserves for an insurer's latest fiscal year. */
export function insurerMetricsOf(stored: StoredDetail): InsurerMetrics | null {
  const d = annualWithHistory(stored);
  if (!d || !stored.annual) return null;
  const fye = Date.parse(stored.annual.reportDate);
  // The latest fiscal year only: an older filing's premiums must not stand in for this year's.
  const ends = [...new Set(Object.values(d.periods).filter((p) => p.months === 12 && !p.label).map((p) => p.end))].sort().reverse();
  const end = ends.find((e) => Math.abs(Date.parse(e) - fye) <= 7 * 86_400_000);
  if (!end) return null;
  const earned = insFigure(d, "earned", end);
  if (!earned || earned.v <= 0) return null;
  const prevEnd = ends.find((e) => e < end && Math.round((Date.parse(end) - Date.parse(e)) / (365.25 * 86_400_000)) === 1);
  const earnedPrior = prevEnd ? insFigure(d, "earned", prevEnd) : null;
  const get = (w: keyof typeof INS) => insFigure(d, w, end);
  const written = get("written"), losses = get("losses"), priorYear = get("priorYear"), acquisition = get("acquisition"), underwriting = get("underwriting"), reserves = get("reserves");
  // Figures far out of proportion to premiums describe another scope (a segment, a run-off book); leave them out.
  const ok = (x: ExpVal | null, lo: number, hi: number) => !!x && x.v / earned.v >= lo && x.v / earned.v <= hi;
  return {
    end,
    earned,
    ...(earnedPrior && earnedPrior.v > 0 ? { earnedPrior: { ...earnedPrior, end: prevEnd! } } : {}),
    ...(written && ok(written, 0.5, 2) ? { written } : {}),
    ...(losses && ok(losses, 0.2, 1.6) ? { losses } : {}),
    ...(priorYear && ok(priorYear, -0.5, 0.5) ? { priorYear } : {}),
    ...(acquisition && ok(acquisition, 0, 0.6) ? { acquisition } : {}),
    ...(underwriting && ok(underwriting, -1, 1) ? { underwriting } : {}),
    ...(reserves && ok(reserves, 0.05, 30) ? { reserves } : {}),
  };
}

/** Index entry for one company (empty when it has none of the views). */
export function indexEntry(stored: StoredDetail): { exposure?: CompanyExposure; bank?: BankMetrics; insurer?: InsurerMetrics } {
  const exposure = exposureOf(stored);
  const bank = bankMetricsOf(stored);
  const insurer = insurerMetricsOf(stored);
  return { ...(exposure ? { exposure } : {}), ...(bank ? { bank } : {}), ...(insurer ? { insurer } : {}) };
}

/** Insurers and health plans. Other companies with premium revenue (a captive insurer inside a conglomerate) are opt-in. */
export const isInsurerIndustry = (industry: string | undefined) => !!industry && /insurance|reinsurance|managed health care|insurance brokers/i.test(industry);

/** Companies ranked by their share of revenue from one region (largest first). */
export function rankRegion(index: ExposureIndex, key: string): { ticker: string; r: RegionExposure; fyEnd: string }[] {
  const out: { ticker: string; r: RegionExposure; fyEnd: string }[] = [];
  for (const [ticker, c] of Object.entries(index.companies)) {
    const r = c.exposure?.regions.find((x) => x.key === key);
    if (r) out.push({ ticker, r, fyEnd: c.exposure!.fyEnd });
  }
  return out.sort((a, b) => b.r.share - a.r.share);
}

/** Region keys by how many companies report them. */
export function regionCounts(index: ExposureIndex): { key: string; n: number }[] {
  const n = new Map<string, number>();
  for (const c of Object.values(index.companies)) for (const r of c.exposure?.regions ?? []) n.set(r.key, (n.get(r.key) ?? 0) + 1);
  return [...n].map(([key, count]) => ({ key, n: count })).sort((a, b) => b.n - a.n);
}

export const regionName = (key: string) => {
  if (REGION_NAMES[key]) return REGION_NAMES[key];
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(key.toUpperCase()) ?? key.toUpperCase();
  } catch {
    return key.toUpperCase();
  }
};

/** Banks, card issuers, consumer and mortgage lenders. Other companies with a loan book (a captive finance arm, an insurer's mortgage loans) are opt-in on the lender table. */
export const isLenderIndustry = (industry: string | undefined) => !!industry && /bank|consumer finance|thrift|mortgage|specialized finance|commercial lending|transaction & payment/i.test(industry);
