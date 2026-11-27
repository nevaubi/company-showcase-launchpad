import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { coverageOf } from "@/lib/coverage";
import { coverageDetails } from "@/lib/coverage-details.server";
import { issuerLink, reviewedLinks, type ReviewedIssuerLinks } from "./issuer-directory";

const cache = new Map<string, { until: number; value: Promise<ReviewedIssuerLinks> }>();

/** Reviewed links for the legal registrant in the coverage universe. Never transfer another CIK's links to it. */
export async function issuerDirectory(ticker: string, cik: string) {
  const t = ticker.toUpperCase();
  const id = cik.replace(/^0+/, "");
  if (!/^\d{1,10}$/.test(id) || !/^[A-Z0-9.-]{1,12}$/.test(t)) return {};
  const key = `${t}:${id}`;
  const found = cache.get(key);
  if (found && found.until > Date.now()) return found.value;
  const value = (async () => {
    let live: ReviewedIssuerLinks = {};
    try {
      const { data, error } = await supabaseAdmin.from("issuer_directory").select("kind,status,url").eq("ticker", t).eq("cik", id);
      if (!error) live = reviewedLinks(data);
      if (live.website !== undefined && live.ir !== undefined) return live;
    } catch {
      // The service can be unavailable while the website or workers are starting.
    }
    const { snapshotIssuerLinks } = await import("./issuer-directory.seed");
    return { ...snapshotIssuerLinks(t, id), ...live };
  })();
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, until: Date.now() + 5 * 60_000 });
  return value;
}

export async function reviewedCompanyDetails(ticker: string, profileCik?: string) {
  const fallback = coverageDetails(ticker);
  const covered = coverageOf(ticker);
  if (!covered) return { ...fallback, directory: {} as ReviewedIssuerLinks };
  if (profileCik && covered.cik.replace(/^0+/, "") !== profileCik.replace(/^0+/, "")) {
    return { ...fallback, website: undefined, ir: undefined, directory: { website: null, ir: null } };
  }
  const directory = await issuerDirectory(ticker, covered.cik);
  return {
    ...fallback,
    website: issuerLink(directory, "website", ticker, fallback.website) ?? undefined,
    ir: issuerLink(directory, "ir", ticker, fallback.ir) ?? undefined,
    directory,
  };
}
