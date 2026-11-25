// FDIC institutions API (public, api.fdic.gov), read in batches of 40 identifiers per request.
import type { FdicInstitution } from "../../../src/lib/sources/company/build";
import { politeGet } from "./http";

export const FDIC_FIELDS = "CERT,NAME,FED_RSSD,RSSDHCR,NAMEHCR,ACTIVE,REPDTE,ASSET,BKCLASS,INSFDIC,STALP";
export type FdicRecord = FdicInstitution & { BKCLASS?: string | null; INSFDIC?: number | string | null; STALP?: string | null; NAMEHCR?: string | null };

/** The address a mapping row cites for one certificate. */
export const fdicRecordUrl = (cert: string) => `https://api.fdic.gov/banks/institutions?filters=${encodeURIComponent(`CERT:${cert}`)}&fields=CERT%2CNAME%2CFED_RSSD%2CRSSDHCR%2CNAMEHCR%2CREPDTE`;

async function query(field: "CERT" | "RSSDHCR" | "FED_RSSD", values: string[]): Promise<FdicRecord[]> {
  const out: FdicRecord[] = [];
  for (let i = 0; i < values.length; i += 40) {
    const part = values.slice(i, i + 40);
    const filter = `${field}:(${part.join(" OR ")})`;
    const url = `https://api.fdic.gov/banks/institutions?filters=${encodeURIComponent(filter)}&fields=${FDIC_FIELDS}&limit=1000`;
    const j = (await politeGet(url)) as { data?: { data: FdicRecord }[] } | null;
    for (const d of j?.data ?? []) out.push(d.data);
  }
  return out;
}

/** Today's FDIC records of the given certificates, by certificate. */
export async function institutionsByCert(certs: string[]): Promise<Map<string, FdicRecord>> {
  return new Map((await query("CERT", certs)).map(r => [String(r.CERT), r]));
}
/** Institutions whose top regulatory holder is one of the RSSDs. */
export const institutionsByHolder = (rssds: string[]) => query("RSSDHCR", rssds);
/** Institutions whose own RSSD is one of the RSSDs. */
export const institutionsByRssd = (rssds: string[]) => query("FED_RSSD", rssds);

/** An FDIC class NC institution files a call report but is not insured and holds no deposits. */
export const isNoninsuredTrust = (r: FdicRecord) => String(r.BKCLASS ?? "") === "NC" || String(r.INSFDIC ?? "1") === "0";
