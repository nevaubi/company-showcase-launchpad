/** Only published issuer material, official agencies, and named newswires enter the scheduled news pass. */
export const supplyNewsDomains = (website?: string, investorSite?: string) => {
  const hosts = new Set(["reuters.com", "apnews.com", "commerce.gov", "bis.gov", "ustr.gov", "energy.gov", "federalregister.gov", "ec.europa.eu"]);
  for (const address of [website, investorSite]) {
    if (!address) continue;
    try {
      const u = new URL(address);
      if (u.protocol === "https:") hosts.add(u.hostname.toLowerCase().replace(/^www\./, ""));
    } catch { /* optional directory entry */ }
  }
  return [...hosts];
};

export function supplyNewsCandidate(
  hit: { url: string; publishedAt?: string }, domains: string[], now: number,
): { url: string; filed: string } | null {
  const time = Date.parse(hit.publishedAt ?? "");
  if (!Number.isFinite(time) || time > now || time < now - 120 * 86_400_000) return null;
  try {
    const url = new URL(hit.url);
    if (url.protocol !== "https:" || !domains.some((d) => d === url.hostname || url.hostname.endsWith("." + d))) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return { url: url.href, filed: new Date(time).toISOString().slice(0, 10) };
  } catch { return null; }
}
