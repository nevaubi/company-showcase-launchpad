// Read-time currency check: do the statements include the newest report the company has filed?
// Pure. Inputs are what the app already holds for a company: the dataset's statements (whose
// cells cite the accession they came from), its filing list (the partner build's own list plus the
// filings the sec job found since, merged by companyQuery) and its earnings releases (8-K item
// 2.02, including the ones withFiledReleases adds from the filing list).
//
// Rules, in order of precision:
// - A periodic report (10-K, 10-KT, 10-Q, amendments excluded) is newer when its period of report
//   ends more than six days (52/53-week calendars) after the latest statement period and is not a
//   statement period end. Cited accessions do not decide this: a balance sheet's year-end column
//   cites the newest 10-Q that repeats it as a comparative. A filing without a period of report
//   counts as newer only when filed after the newest report the statements include (the one whose
//   period of report is the latest period, else the newest one an income or cash flow cell cites).
// - An earnings release is newer when it was filed on a later day than every periodic report above
//   and at least 85 days after the latest period known (statements or a newer report): the next
//   quarter cannot have been released earlier, and a release about the latest quarter, which often
//   arrives the same day as the 10-Q, a day after it, or before it, never counts.
import type { Cell, CompanyDataset, Filing, Period, Statement } from "./types";

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);

const PERIODIC = /^(10-K|10-KT|10-Q|10-QT)$/;
const NEXT_RELEASE_MIN_DAYS = 85;
const END_TOLERANCE = 6;

export type CurrencyKind = "annual" | "quarterly" | "release";

export interface CurrencyFiling {
  kind: CurrencyKind;
  form: string;
  accn: string;
  filed: string;
  /** Period of report (fiscal period end) when SEC lists it */
  report?: string;
  doc?: string;
  /** SEC page for the filing */
  url: string;
}

export interface Currency {
  /** current: nothing newer is known; behind: a newer report or release exists; unknown: no statements */
  status: "current" | "behind" | "unknown";
  /** Latest quarterly and annual statement periods */
  quarter?: Pick<Period, "key" | "label" | "end">;
  year?: Pick<Period, "key" | "label" | "end">;
  /** Newest periodic report the statements include */
  included?: CurrencyFiling;
  /** Newer filings not in the statements, newest first: at most one annual, one quarterly, one release */
  newer: CurrencyFiling[];
  /** One plain sentence (two when behind) for the page */
  text: string;
}

export interface CurrencyOptions {
  /** Every CIK the company files or filed under, current first (coverage `companyCiks`) */
  ciks?: string[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-06-27" → "27 Jun 2026" (UTC, locale independent). */
export function dayLabel(d: string): string {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

const unpad = (cik: string) => String(Number(cik));

/**
 * CIK whose archive holds the filing. An accession's prefix is the CIK of whoever submitted it: when
 * that is one of the company's CIKs it is the registrant. Otherwise (a filing agent submitted it) a
 * company that changed registrant files new reports under its current CIK; everyone else has one.
 */
export function filingCik(accn: string, profileCik: string, ciks: string[] = []): string {
  const all = ciks.length ? ciks.map(unpad) : [unpad(profileCik)];
  const prefix = unpad(accn.slice(0, 10));
  if (all.includes(prefix)) return prefix;
  return all[0];
}

export function filingUrl(cik: string, accn: string, doc?: string): string {
  const base = `https://www.sec.gov/Archives/edgar/data/${unpad(cik)}/${accn.replace(/-/g, "")}`;
  return doc ? `${base}/${doc}` : `${base}/${accn}-index.htm`;
}

function cellAccns(c: Cell | null, out: Set<string>) {
  if (!c) return;
  if (c.src) out.add(c.src.accn);
  for (const p of c.derived?.parts ?? []) out.add(p.accn);
  for (const a of c.alts ?? []) out.add(a);
}

/** Accessions cited by the cells of each flow statement's latest period. */
function citedAtLatest(statements: Statement[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) {
    const i = s.periods.length - 1;
    if (i < 0) continue;
    for (const r of s.rows) if (r.kind !== "kpi") cellAccns(r.cells[i] ?? null, out);
  }
  return out;
}

function latestPeriod(statements: Statement[]): Period | undefined {
  let best: Period | undefined;
  for (const s of statements) {
    const p = s.periods.at(-1);
    if (p && (!best || p.end > best.end)) best = p;
  }
  return best;
}

const pick = (p: Period | undefined) => (p ? { key: p.key, label: p.label, end: p.end } : undefined);

/**
 * Every 10-K/10-Q the statements do not hold (periods after the latest statement period, and 10-Ks
 * whose year is not an annual column), oldest first: what a read-time extension should read.
 */
export function missingReports(d: CompanyDataset): Filing[] {
  const A = d.statements.annual;
  const Q = d.statements.quarterly;
  const all = [A.income, A.balance, A.cashflow, Q.income, Q.balance, Q.cashflow];
  const latestEnd = all.map((s) => s.periods.at(-1)?.end ?? "").sort().at(-1);
  if (!latestEnd) return [];
  const ends = all.flatMap((s) => s.periods.map((p) => p.end));
  const yearEnd = [A.income, A.balance, A.cashflow].map((s) => s.periods.at(-1)?.end ?? "").sort().at(-1) ?? "";
  const yearEnds = A.income.periods.map((p) => p.end);
  const near = (a: string, b: string) => Math.abs(days(a, b)) <= END_TOLERANCE;
  return d.filings
    .filter((f) => PERIODIC.test(f.form) && f.report)
    .filter((f) =>
      (days(latestEnd, f.report!) > END_TOLERANCE && !ends.some((e) => near(e, f.report!))) ||
      (f.form.startsWith("10-K") && !!yearEnd && days(yearEnd, f.report!) > END_TOLERANCE && !yearEnds.some((e) => near(e, f.report!))),
    )
    .sort((a, b) => a.filed.localeCompare(b.filed));
}

export function assessCurrency(d: CompanyDataset, opts: CurrencyOptions = {}): Currency {
  const A = d.statements.annual;
  const Q = d.statements.quarterly;
  const qStatements = [Q.income, Q.balance, Q.cashflow];
  const aStatements = [A.income, A.balance, A.cashflow];
  const quarter = latestPeriod(qStatements);
  const year = latestPeriod(aStatements);
  const latestEnd = [quarter?.end, year?.end].filter(Boolean).sort().at(-1);
  if (!latestEnd) return { status: "unknown", newer: [], text: "No statements have been built for this company yet." };

  const cik = d.profile.cik;
  const toFiling = (f: Filing, kind: CurrencyKind): CurrencyFiling => ({
    kind,
    form: f.form,
    accn: f.accn,
    filed: f.filed,
    ...(f.report ? { report: f.report } : {}),
    ...(f.doc ? { doc: f.doc } : {}),
    url: filingUrl(filingCik(f.accn, cik, opts.ciks), f.accn, f.doc),
  });

  const cited = new Set([...citedAtLatest([Q.income, Q.cashflow]), ...citedAtLatest([A.income, A.cashflow])]);
  const ends = new Set([...qStatements, ...aStatements].flatMap((s) => s.periods.map((p) => p.end)));
  const isEnd = (r: string) => [...ends].some((e) => Math.abs(days(e, r)) <= END_TOLERANCE);
  const periodic = d.filings.filter((f) => PERIODIC.test(f.form)).sort((a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn));

  // Newest report the statements include: cited at the latest period, else one whose period of report is the latest end.
  const inc =
    periodic.find((f) => f.report && Math.abs(days(latestEnd, f.report)) <= END_TOLERANCE) ??
    periodic.find((f) => cited.has(f.accn) && !(f.report && days(latestEnd, f.report) > END_TOLERANCE));
  const includedFiled = inc?.filed ?? "";

  const isNewer = (f: Filing) =>
    f.report ? days(latestEnd, f.report) > END_TOLERANCE && !isEnd(f.report) : !!includedFiled && f.filed > includedFiled && !cited.has(f.accn);
  // An annual report is also missing when its year is not an annual column, even if later quarters
  // are in the tables (Clorox: FY2027 Q1 placed, the FY2026 10-K absent from SEC companyfacts).
  const yearEnds = A.income.periods.map((p) => p.end);
  const annualMissing = (f: Filing) => !!f.report && !!year && days(year.end, f.report) > END_TOLERANCE && !yearEnds.some((e) => Math.abs(days(e, f.report!)) <= END_TOLERANCE);
  const annual = periodic.find((f) => f.form.startsWith("10-K") && (isNewer(f) || annualMissing(f)));
  const quarterly = periodic.find((f) => f.form.startsWith("10-Q") && isNewer(f));
  const newestPeriodicFiled = [includedFiled, annual?.filed ?? "", quarterly?.filed ?? ""].sort().at(-1) ?? "";
  const latestKnown = [latestEnd, annual?.report ?? "", quarterly?.report ?? ""].sort().at(-1)!;
  const release = [...d.earningsReleases]
    .sort((a, b) => b.filed.localeCompare(a.filed))
    .find((r) => r.filed > newestPeriodicFiled && days(latestKnown, r.filed) >= NEXT_RELEASE_MIN_DAYS);

  const newer: CurrencyFiling[] = [];
  if (annual) newer.push(toFiling(annual, "annual"));
  if (quarterly) newer.push(toFiling(quarterly, "quarterly"));
  if (release) newer.push({ kind: "release", form: "8-K", accn: release.accn, filed: release.filed, doc: release.doc, url: filingUrl(filingCik(release.accn, cik, opts.ciks), release.accn, release.doc) });
  newer.sort((a, b) => b.filed.localeCompare(a.filed));

  const yearIsLatest = year && quarter && Math.abs(days(year.end, quarter.end)) <= END_TOLERANCE;
  const through =
    !quarter || (year && year.end > quarter.end) || yearIsLatest
      ? `Statements run through the fiscal year ended ${dayLabel((year ?? quarter)!.end)}.`
      : `Statements run through the quarter ended ${dayLabel(quarter.end)}.`;

  const included = inc ? toFiling(inc, inc.form.startsWith("10-K") ? "annual" : "quarterly") : undefined;
  if (!newer.length) {
    const tail = included ? ` The latest report on file is the ${included.form} filed on ${dayLabel(included.filed)}.` : "";
    return { status: "current", quarter: pick(quarter), year: pick(year), included, newer, text: `${through}${tail}` };
  }
  const report = newer.find((n) => n.kind !== "release");
  const parts: string[] = [];
  if (report) {
    // A 10-KT covers a transition period (Ferguson: five months to 31 Dec 2025), not a fiscal year.
    const what =
      report.form === "10-KT"
        ? `A transition report (10-KT) for the period ended`
        : report.kind === "annual"
          ? `An annual report (${report.form}) for the year ended`
          : `A quarterly report (${report.form}) for the quarter ended`;
    parts.push(
      report.report
        ? `${what} ${dayLabel(report.report)} was filed on ${dayLabel(report.filed)} and is not in these tables yet.`
        : `A newer ${report.form} was filed on ${dayLabel(report.filed)} and is not in these tables yet.`,
    );
  }
  if (release && (!report || release.filed > report.filed))
    parts.push(
      report
        ? `Results for a later period were released on ${dayLabel(release.filed)} (Form 8-K).`
        : `Results for the next period were released on ${dayLabel(release.filed)} (Form 8-K); the tables add them from the 10-Q or 10-K once it is filed.`,
    );
  return { status: "behind", quarter: pick(quarter), year: pick(year), included, newer, text: `${through} ${parts.join(" ")}` };
}
