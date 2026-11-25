// SEC reads of the mapping build: the latest 10-K or 10-Q of a registrant, the EIN on its cover page, and the
// total assets its XBRL states for a date. About two requests a second (http.ts).
import { coverEin } from "../../../src/lib/sources/company/build";
import { politeGet } from "./http";

export interface CoverRead {
  cik: string;
  accession: string;
  form: string;
  coverUrl: string;
  ein: string | null;
  headerEin: string | null;
  name: string;
}

/** Step 1: the EIN printed on the cover page of the registrant's latest 10-K or 10-Q. */
export async function readCover(cik: string): Promise<CoverRead | null> {
  const sub = (await politeGet(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)) as {
    name?: string; ein?: string; filings?: { recent?: { form: string[]; accessionNumber: string[]; filingDate: string[] } };
  } | null;
  const recent = sub?.filings?.recent;
  if (!recent) return null;
  let best = -1;
  for (let i = 0; i < recent.form.length; i++) {
    if (!/^10-[KQ]$/.test(recent.form[i])) continue;
    if (best < 0 || recent.filingDate[i] > recent.filingDate[best]) best = i;
  }
  if (best < 0) return null;
  const accession = recent.accessionNumber[best];
  const coverUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/R1.htm`;
  const html = (await politeGet(coverUrl, { json: false })) as string | null;
  const header = sub?.ein && /^\d{9}$/.test(sub.ein) && sub.ein !== "000000000" ? sub.ein : null;
  return { cik: String(Number(cik)), accession, form: recent.form[best], coverUrl, ein: html ? coverEin(html) : null, headerEin: header, name: sub?.name ?? "" };
}

/** Total assets (us-gaap:Assets, USD) the registrant's 10-Q or 10-K states for a date, from SEC companyfacts. */
export async function statedAssets(cik: string, date: string): Promise<{ value: number; accession: string } | null> {
  const j = (await politeGet(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik.padStart(10, "0")}/us-gaap/Assets.json`)) as {
    units?: { USD?: { end: string; val: number; accn: string; form: string; filed: string }[] };
  } | null;
  const hits = (j?.units?.USD ?? []).filter(f => f.end === date && /^10-[KQ]/.test(f.form)).sort((a, b) => a.filed.localeCompare(b.filed));
  const first = hits[0];
  return first ? { value: first.val, accession: first.accn } : null;
}
