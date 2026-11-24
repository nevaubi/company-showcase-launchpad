// Reviewed list of investor-relations files stored under a covered ticker that belong to another
// company (or to no company). Each entry was decided by reading the stored files' titles or the
// site itself on 24 Nov 2026 (read-only SQL on ir_documents, EDGAR for the CIKs in CDN paths).
// Being absent from this list proves nothing: it names files known to be wrong, it does not
// certify the rest. Add an entry only with its evidence; never remove one without re-reading the site.

export interface GuardedSource {
  /** covered ticker the files are stored under */
  ticker: string;
  /** host the files come from (matches the host and its subdomains) */
  host: string;
  /** optional path prefix, when only part of a shared host is wrong (a CDN folder of another filer) */
  path?: string;
  /** whose files they are */
  owner: string;
  /** what was looked at to decide */
  evidence: string;
  /** files stored under the ticker when reviewed */
  files: number;
  /** figures already stored from them in ir_kpi_facts when reviewed */
  facts: number;
}

export const GUARDED_SOURCES: readonly GuardedSource[] = [
  {
    ticker: "ON",
    host: "sonal.co.in",
    owner: "an Indian listed company (sonal.co.in), not onsemi",
    evidence: "titles 'Audited Results March 2024', 'Board Meeting Notice June 2023 Results' on an Indian fiscal year; coverage ir field pointed here",
    files: 77,
    facts: 0,
  },
  {
    ticker: "DGII",
    host: "digi-communications.ro",
    owner: "Digi Communications N.V. (Romania)",
    evidence: "titles 'Digi Romania 2025 non-statutory consolidated', 'Digi-Communications-N-V-2024-Annual-Report.pdf'",
    files: 45,
    facts: 0,
  },
  {
    ticker: "FOXA",
    host: "investor.ridefox.com",
    owner: "Fox Factory Holding Corp. (FOXF)",
    evidence: "titles 'Fox Factory Holding Corp. Reports Fourth Quarter Fiscal 2025'; stored figures include 'Powered Vehicles Group' (a Fox Factory segment); coverage ir field pointed here",
    files: 26,
    facts: 1041,
  },
  {
    ticker: "WMK",
    host: "ir.syndax.com",
    owner: "Syndax Pharmaceuticals (SNDX)",
    evidence: "titles 'Syndax Reports Third Quarter 2026 Financial Results'",
    files: 4,
    facts: 0,
  },
  {
    ticker: "TFSL",
    host: "toyotafinancial.com",
    owner: "Toyota Motor Credit Corporation",
    evidence: "titles 'TMCC's Q2 FY2026 quarterly Fixed Income update'",
    files: 4,
    facts: 0,
  },
  {
    ticker: "NBTB",
    host: "investors.thebancorp.com",
    owner: "The Bancorp, Inc. (TBBK)",
    evidence: "titles 'The Bancorp Reports 3Q 2026 EPS of $1.53'",
    files: 24,
    facts: 0,
  },
  {
    ticker: "WABC",
    host: "investors.westernalliancebancorporation.com",
    owner: "Western Alliance Bancorporation (WAL)",
    evidence: "titles 'Western Alliance Bancorporation Announces Third Quarter...'",
    files: 24,
    facts: 0,
  },
  {
    ticker: "WABC",
    host: "s21.q4cdn.com",
    path: "/328636679/",
    owner: "Western Alliance Bancorporation (WAL)",
    evidence: "file names 'Western-Alliance-Bancorporation-to-Host-2026-Investor-Day'; titles 'Western Alliance Appoints CEO'",
    files: 38,
    facts: 0,
  },
  {
    ticker: "CSCO",
    host: "d18rn0p25nwr6d.cloudfront.net",
    path: "/CIK-0000093751/",
    owner: "State Street Corporation (STT)",
    evidence: "the CDN folder is named by the filer's CIK; EDGAR CIK 93751 is STATE STREET CORP",
    files: 1,
    facts: 0,
  },
  {
    ticker: "AXP",
    host: "d18rn0p25nwr6d.cloudfront.net",
    path: "/CIK-0001820872/",
    owner: "Global Business Travel Group, Inc.",
    evidence: "the CDN folder is named by the filer's CIK; EDGAR CIK 1820872 is Global Business Travel Group, Inc.",
    files: 2,
    facts: 0,
  },
  {
    ticker: "NFLX",
    host: "d18rn0p25nwr6d.cloudfront.net",
    path: "/CIK-0001437107/",
    owner: "Warner Bros. Discovery, Inc.",
    evidence: "the CDN folder is named by the filer's CIK; EDGAR CIK 1437107 is Warner Bros. Discovery, Inc.",
    files: 1,
    facts: 0,
  },
  {
    ticker: "BEN",
    host: "fele.widen.net",
    owner: "Franklin Electric Co. (FELE) asset library",
    evidence: "the same library serves FELE's own files; file names '2022_form_10-k-1.pdf', '2025 Proxy.pdf' under Franklin Resources",
    files: 11,
    facts: 0,
  },
  {
    ticker: "COKE",
    host: "investors.coca-colacompany.com",
    owner: "The Coca-Cola Company (KO)",
    evidence: "title 'Coca-Cola Reports Second Quarter 2026 Results and Raises Full Year Guidance' (a KO release); the host serves KO's own files",
    files: 1,
    facts: 0,
  },
  {
    ticker: "AGM",
    host: "www.bls.gov",
    owner: "Bureau of Labor Statistics (not a company document)",
    evidence: "title is a bls.gov news-release archive address",
    files: 1,
    facts: 0,
  },
];
