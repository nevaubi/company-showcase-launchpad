import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ISO3, latestByCountry, riskTier, WGI, type CountryScore } from "@/lib/supply/region";

const WB = "https://api.worldbank.org/v2";
const json = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

/** World Bank governance (WGI) + GDP growth for many countries in four requests. */
async function scores(countries: string[]): Promise<CountryScore[]> {
  const isos = [...new Set(countries.map((c) => ISO3[c]).filter(Boolean))];
  const got: Record<string, Record<string, { value: number; date: string }>> = {};
  if (isos.length) {
    const list = isos.join(";");
    const reqs = [
      ...WGI.map((w) => ({ key: w.key, url: `${WB}/country/${list}/indicator/${w.id}?source=3&format=json&mrv=3&per_page=1000` })),
      { key: "gdpGrowth", url: `${WB}/country/${list}/indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=3&per_page=1000` },
    ];
    await Promise.all(reqs.map(async (q) => { try { got[q.key] = latestByCountry(await json(q.url)); } catch { got[q.key] = {}; } }));
  }
  return countries.map((country) => {
    const iso3 = ISO3[country] ?? null;
    const v = (k: string) => (iso3 ? got[k]?.[iso3]?.value ?? null : null);
    const s = { stability: v("stability"), ruleOfLaw: v("ruleOfLaw"), regulatory: v("regulatory") };
    return {
      country, iso3, ...s, gdpGrowth: v("gdpGrowth"),
      year: iso3 ? got.stability?.[iso3]?.date ?? null : null,
      tier: riskTier(s),
      sourceUrl: iso3 ? `https://data.worldbank.org/country/${iso3.toLowerCase()}` : null,
    };
  });
}

export const getCountryScores = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ countries: z.array(z.string().max(60)).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { cached } = await import("@/lib/ai.server");
    const list = [...new Set(data.countries)].sort();
    return cached(`wgi:v1:${list.join("|")}`, 7 * 86_400_000, async () => ({ rows: await scores(list) }), (r) => r.rows.some((x) => x.tier !== "unrated"));
  });

export interface PolicyAction { title: string; date: string; type: string; agency: string; url: string }
export interface RegionNews { title: string; url: string; date: string | null; snippet: string; host: string }
export interface RegionDossier { score: CountryScore; policy: PolicyAction[]; policyTotal: number; news: RegionNews[]; newsError?: string }

const AGENCIES = ["industry-and-security-bureau", "trade-representative-office-of-united-states", "foreign-assets-control-office", "international-trade-administration", "international-trade-commission", "u-s-customs-and-border-protection"];

async function federalRegister(country: string): Promise<{ items: PolicyAction[]; total: number }> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const p = new URLSearchParams({ per_page: "20", order: "newest", "conditions[term]": `"${country}"`, "conditions[publication_date][gte]": since });
  for (const a of AGENCIES) p.append("conditions[agencies][]", a);
  for (const f of ["title", "publication_date", "html_url", "agencies", "type"]) p.append("fields[]", f);
  const d = (await json(`https://www.federalregister.gov/api/v1/documents.json?${p}`)) as {
    count: number; results?: { title: string; publication_date: string; html_url: string; type: string; agencies: { name?: string; raw_name?: string }[] }[];
  };
  return {
    total: d.count ?? 0,
    items: (d.results ?? []).map((r) => ({
      title: r.title, date: r.publication_date, type: r.type, url: r.html_url,
      agency: (r.agencies ?? []).map((a) => a.name ?? a.raw_name ?? "").filter(Boolean).pop() ?? "Federal Register",
    })),
  };
}

/** Sourced region brief: governance scores (World Bank), U.S. trade/sanctions actions naming the country (Federal Register), recent supply-chain news (web). */
export const getRegionDossier = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ country: z.string().min(2).max(60), theme: z.string().max(80).optional() }).parse(d))
  .handler(async ({ data }): Promise<RegionDossier & { cachedAt: string }> => {
    const { cached } = await import("@/lib/ai.server");
    const theme = (data.theme ?? "").trim();
    return cached(`region:v1:${data.country}:${theme.toLowerCase()}`, 12 * 3_600_000, async () => {
      const [sc, fr, news] = await Promise.all([
        scores([data.country]).then((r) => r[0]),
        federalRegister(data.country).catch(() => ({ items: [], total: 0 })),
        (async (): Promise<{ items: RegionNews[]; error?: string }> => {
          try {
            const { tavilySearch } = await import("@/lib/web.server");
            const q = `${data.country} supply chain ${theme} disruption OR tariffs OR export controls OR sanctions OR factory OR port OR strike`;
            const r = await tavilySearch(q, { topic: "news", days: 45, maxResults: 8, depth: "basic" });
            return {
              items: r.results
                .filter((x) => new RegExp(data.country.split(" ")[0], "i").test(`${x.title} ${x.content ?? ""}`))
                .map((x) => ({ title: x.title, url: x.url, date: x.publishedAt ?? null, snippet: (x.content ?? "").slice(0, 260), host: new URL(x.url).hostname.replace(/^www\./, "") })),
            };
          } catch (e) {
            return { items: [], error: e instanceof Error ? e.message : "News search failed" };
          }
        })(),
      ]);
      return { score: sc, policy: fr.items, policyTotal: fr.total, news: news.items, ...(news.error ? { newsError: news.error } : {}) };
    }, (r) => r.policy.length > 0 || r.news.length > 0);
  });
