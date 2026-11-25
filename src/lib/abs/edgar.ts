// What EDGAR says about an ABS-EE filing, read from three public files (pure parsing, no network):
//   the submissions index of a CIK      https://data.sec.gov/submissions/CIK##########.json
//   the filing's header                 .../Archives/edgar/data/<cik>/<accession>/<accession>.hdr.sgml
//   the filing's document list          .../Archives/edgar/data/<cik>/<accession>/<accession>-index.htm
// The header carries the cover period, the asset class and who filed; the document list says which file
// is the asset data file (type EX-102). Rules in AGENTS.md beside this file.

export const ABS_FORMS = ["ABS-EE", "ABS-EE/A"] as const;
export type AbsForm = (typeof ABS_FORMS)[number];

export type ListedFiling = {
  accession: string;
  list_cik: number;
  form: AbsForm;
  /** filing date, YYYY-MM-DD */
  filed: string;
  /** acceptance time as the index gives it (UTC, ISO) */
  accepted_at: string | null;
};

type SubmissionColumns = {
  accessionNumber?: string[];
  form?: string[];
  filingDate?: string[];
  acceptanceDateTime?: string[];
};
export type SubmissionsFile = {
  cik?: string | number;
  name?: string;
  filings?: { recent?: SubmissionColumns; files?: { name: string }[] };
} & SubmissionColumns;

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ABS-EE and ABS-EE/A filings in one submissions file. The first file of a CIK holds its newest
 * filings under `filings.recent`; older pages (named in `filings.files`) hold the same columns at the top.
 */
export function listedFilings(file: SubmissionsFile, listCik: number): ListedFiling[] {
  const c = file.filings?.recent ?? file;
  const n = c.accessionNumber?.length ?? 0;
  const out: ListedFiling[] = [];
  for (let i = 0; i < n; i++) {
    const form = c.form?.[i];
    const accession = c.accessionNumber![i];
    const filed = c.filingDate?.[i] ?? "";
    if (
      (form !== "ABS-EE" && form !== "ABS-EE/A") ||
      !ACCESSION.test(accession) ||
      !ISO_DAY.test(filed)
    )
      continue;
    const at = c.acceptanceDateTime?.[i];
    out.push({
      accession,
      list_cik: listCik,
      form,
      filed,
      accepted_at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null,
    });
  }
  return out;
}

/** Names of the older submissions pages a first file points at. */
export const olderPages = (file: SubmissionsFile): string[] =>
  (file.filings?.files ?? [])
    .map((f) => f.name)
    .filter((n) => /^CIK\d{10}-submissions-\d+\.json$/.test(n));

export const submissionsUrl = (cik: number) =>
  `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
export const submissionsPageUrl = (name: string) => `https://data.sec.gov/submissions/${name}`;
export const filingFolder = (cik: number, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`;
export const headerUrl = (cik: number, accession: string) =>
  `${filingFolder(cik, accession)}${accession}.hdr.sgml`;
export const indexUrl = (cik: number, accession: string) =>
  `${filingFolder(cik, accession)}${accession}-index.htm`;

export type HeaderFiler = {
  cik: number;
  name: string;
  form: string | null;
  fileNumber: string | null;
};
export type AbsHeader = {
  accession: string;
  form: string;
  /** filing date and cover period as YYYY-MM-DD; null when the header leaves one out */
  filed: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** acceptance time as the header writes it, Eastern time: "YYYY-MM-DD HH:MM:SS America/New_York" */
  acceptedAt: string | null;
  /** the asset classes the header lists, as filed; a header may list more than one, and a filer's label can be wrong */
  assetClasses: string[];
  depositorCik: number | null;
  sponsorCik: number | null;
  filers: HeaderFiler[];
};

const tag = (text: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([^\\n<]*)`).exec(text);
  const v = m?.[1].trim();
  return v ? v : null;
};
const tags = (text: string, name: string): string[] =>
  [...text.matchAll(new RegExp(`<${name}>([^\\n<]*)`, "g"))]
    .map((m) => m[1].trim())
    .filter(Boolean);
const day = (v: string | null) =>
  v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
const cikOf = (v: string | null) => (v && /^\d{1,10}$/.test(v) ? Number(v) : null);

/** The facts of an `.hdr.sgml` header. Throws when the text is not a header with an accession number and a form. */
export function parseAbsHeader(text: string): AbsHeader {
  const accession = tag(text, "ACCESSION-NUMBER");
  const form = tag(text, "TYPE");
  if (!text.includes("<SEC-HEADER>") || !accession || !ACCESSION.test(accession) || !form)
    throw new Error("not an EDGAR filing header");
  const at = tag(text, "ACCEPTANCE-DATETIME");
  const filers: HeaderFiler[] = [];
  for (const m of text.matchAll(/<FILER>([\s\S]*?)<\/FILER>/g)) {
    const cik = cikOf(tag(m[1], "CIK"));
    const name = tag(m[1], "CONFORMED-NAME");
    if (cik != null && name)
      filers.push({
        cik,
        name,
        form: tag(m[1], "FORM-TYPE"),
        fileNumber: tag(m[1], "FILE-NUMBER"),
      });
  }
  return {
    accession,
    form,
    filed: day(tag(text, "FILING-DATE")),
    periodStart: day(tag(text, "PERIOD-START")),
    periodEnd: day(tag(text, "PERIOD")),
    acceptedAt:
      at && /^\d{14}$/.test(at)
        ? `${day(at.slice(0, 8))} ${at.slice(8, 10)}:${at.slice(10, 12)}:${at.slice(12, 14)} America/New_York`
        : null,
    assetClasses: tags(
      text.slice(0, text.indexOf("<FILER>") < 0 ? undefined : text.indexOf("<FILER>")),
      "ABS-ASSET-CLASS",
    ),
    depositorCik: cikOf(tag(text, "DEPOSITOR-CIK")),
    sponsorCik: cikOf(tag(text, "SPONSOR-CIK")),
    filers,
  };
}

/**
 * An asset class a header states in words ("Commercial mortgages", "Auto loans", "Auto leases") as a
 * family. Only used to leave a large file alone before it is downloaded; the file's own namespace
 * decides what it is, because the header's label is the filer's and has been seen wrong.
 */
export function familyOfClass(assetClass: string): "cmbs" | "auto_loan" | "auto_lease" | "other" {
  const c = assetClass.toLowerCase();
  return /commercial mortgage/.test(c)
    ? "cmbs"
    : /auto(mobile)? loan/.test(c)
      ? "auto_loan"
      : /auto(mobile)? lease/.test(c)
        ? "auto_lease"
        : "other";
}

export type DealIdentity = {
  deal_id: string;
  issuer_cik: number | null;
  issuer_name: string;
  file_number: string | null;
};

/**
 * Which deal a filing belongs to. The issuing entity is the filer that is not the depositor; its CIK,
 * as ten digits, is the deal. A filing whose only filer is the depositor (several trusts share that CIK)
 * is keyed by the depositor and the file number, which SEC gives each trust on the depositor's shelf.
 * Null when the header names no filer, or a depositor-only filing has no file number: the deal is then
 * not established and the filing is not stored.
 */
export function dealOf(h: AbsHeader): DealIdentity | null {
  if (!h.filers.length) return null;
  const others = h.filers.filter((f) => f.cik !== h.depositorCik);
  if (others.length === 1) {
    const f = others[0];
    return {
      deal_id: String(f.cik).padStart(10, "0"),
      issuer_cik: f.cik,
      issuer_name: f.name,
      file_number: f.fileNumber,
    };
  }
  if (others.length === 0 && h.filers.length === 1 && h.filers[0].fileNumber) {
    const f = h.filers[0];
    return {
      deal_id: `${String(f.cik).padStart(10, "0")}:${f.fileNumber}`,
      issuer_cik: null,
      issuer_name: f.name,
      file_number: f.fileNumber,
    };
  }
  return null;
}

export type IndexDocument = {
  seq: number;
  description: string | null;
  name: string;
  url: string;
  doc_type: string;
  listed_bytes: number | null;
};

const cellText = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The documents of a filing from its `-index.htm` page: the rows of the "Document Format Files" table
 * that have a sequence number (the complete-submission text file has none and is left out).
 */
export function parseFilingIndex(html: string): IndexDocument[] {
  const start = html.indexOf('summary="Document Format Files"');
  if (start < 0) return [];
  const table = html.slice(
    start,
    html.indexOf("</table>", start) < 0 ? undefined : html.indexOf("</table>", start),
  );
  const out: IndexDocument[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 5) continue;
    const seq = cellText(cells[0]);
    const href = /href="([^"]+)"/.exec(cells[2])?.[1];
    const type = cellText(cells[3]);
    if (!/^\d+$/.test(seq) || !href || !type) continue;
    // an inline-viewer link (/ix?doc=/Archives/...) points at the same archive path
    const path = href.replace(/^\/ix\?doc=/, "");
    if (!path.startsWith("/Archives/edgar/data/")) continue;
    const size = cellText(cells[4]);
    out.push({
      seq: Number(seq),
      description: cellText(cells[1]) || null,
      name: path.slice(path.lastIndexOf("/") + 1),
      url: `https://www.sec.gov${path}`,
      doc_type: type,
      listed_bytes: /^\d+$/.test(size) ? Number(size) : null,
    });
  }
  return out;
}

/** The asset data files of a filing (type EX-102), in document order. */
export const assetFiles = (docs: IndexDocument[]) =>
  docs.filter((d) => d.doc_type === "EX-102" && /\.xml$/i.test(d.name));
