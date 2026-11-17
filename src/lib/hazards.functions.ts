import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { byCompany, NWS_ALERTS, parseNws, parseQuakes, PLANTS_PATH, plantsUnder, USGS_QUAKES, type CompanyHazards, type Hazard, type HazardKind, type Plant } from "@/lib/alt/hazards";

export interface PlantHazards {
  asOf: string;
  plantYear: number | null;
  plants: number;
  /** Hazards in force by kind, with how many covered plants sit under each. */
  kinds: { kind: HazardKind; alerts: number; plants: number; companies: number }[];
  companies: CompanyHazards[];
  /** Feeds that couldn't be read this time (the rest still shows). */
  errors: string[];
}

const UA = "FiledUnder research@filedunder.ai";
// Short per-isolate cache so a page and the assistant don't refetch the feeds every few seconds.
let memo: { at: number; ttl: number; value: PlantHazards } | null = null;

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json", ...headers }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

/** Covered companies' US plants (EPA TRI) under live NWS warnings or near this week's USGS quakes. */
export const getPlantHazards = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().max(12).nullable().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PlantHazards> => {
    if (!memo || Date.now() - memo.at > memo.ttl) {
      const errors: string[] = [];
      const file = await context.supabase.storage.from("datasets").download(PLANTS_PATH);
      if (file.error || !file.data) throw new Error("Plant index unavailable");
      const idx = JSON.parse(await file.data.text()) as { year: number; plants: Plant[] };
      const [nws, usgs] = await Promise.allSettled([getJson(NWS_ALERTS), getJson(USGS_QUAKES)]);
      const hazards: Hazard[] = [];
      if (nws.status === "fulfilled") hazards.push(...parseNws(nws.value));
      else errors.push("National Weather Service alerts");
      if (usgs.status === "fulfilled") hazards.push(...parseQuakes(usgs.value));
      else errors.push("USGS earthquakes");
      const hits = plantsUnder(hazards, idx.plants);
      const kinds = new Map<HazardKind, { alerts: Set<string>; plants: Set<string>; companies: Set<string> }>();
      for (const h of hazards) {
        const k = kinds.get(h.kind) ?? kinds.set(h.kind, { alerts: new Set(), plants: new Set(), companies: new Set() }).get(h.kind)!;
        k.alerts.add(h.id);
      }
      for (const x of hits) {
        const k = kinds.get(x.hazard.kind)!;
        k.plants.add(x.plant.id);
        k.companies.add(x.plant.t);
      }
      const companies = byCompany(hits);
      memo = {
        at: Date.now(),
        // a feed that failed is retried after a minute, not five
        ttl: errors.length ? 60_000 : 5 * 60_000,
        value: {
          asOf: new Date().toISOString(),
          plantYear: idx.year ?? null,
          plants: idx.plants.length,
          kinds: [...kinds.entries()].map(([kind, v]) => ({ kind, alerts: v.alerts.size, plants: v.plants.size, companies: v.companies.size })).filter((k) => k.plants > 0).sort((a, b) => b.plants - a.plants),
          companies,
          errors,
        },
      };
    }
    const v = memo.value;
    const t = data.ticker?.toUpperCase();
    return { ...v, companies: t ? v.companies.filter((c) => c.ticker === t) : v.companies.map((c) => ({ ...c, plants: c.plants.slice(0, 40) })) };
  });
