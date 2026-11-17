// CMS "Medicare Part D Prescribers – by Geography and Drug": gross Part D drug costs for every
// brand in every state (by the prescriber's state), turned into per-company state breakdowns for
// drug makers. A brand belongs to a company only when CMS's Part D Spending by Drug file names that
// company's labelers for (nearly) all of the brand's spending that year, so multi-source generics
// are never attributed. Pure: the script downloads the files.
import { displayBrand, type CmsRecord } from "./medicare";
import { parseCsv } from "./csv";
import { STATES } from "./sod";

export const GEO_PAGE = "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/medicare-part-d-prescribers-by-geography-and-drug";
export const GEO_TITLE_PREFIX = "Medicare Part D Prescribers - by Geography and Drug : ";
export const GEO_DATASET = "medicare_states";
export const GEO_TOTAL = "Part D spending by prescriber state";
export const geoStateTitle = (st: string) => `Part D · ${st}`;
/** Share of a brand's yearly spending one company's labelers must hold for the brand to count as theirs. */
export const OWNER_SHARE = 0.95;

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), c]));
NAME_TO_CODE["virgin islands"] = "VI";

/** The exact CMS records for one brand in one state and year (JSON). */
export const geoRecordUrl = (datasetId: string, stateName: string, brand: string) =>
  `https://data.cms.gov/data-api/v1/dataset/${datasetId}/data?filter%5BPrscrbr_Geo_Desc%5D=${encodeURIComponent(stateName)}&filter%5BBrnd_Name%5D=${encodeURIComponent(brand)}`;

export { parseCsv } from "./csv";

/** One brand in one state (or the nation) for one year. */
export interface GeoRec {
  national: boolean;
  /** Two-letter code; null for the nation and for "Unknown"/"Foreign Country"/military rows. */
  state: string | null;
  stateName: string;
  brand: string;
  generic: string;
  cost: number;
  claims: number | null;
  benes: number | null;
  prescribers: number | null;
}

const num = (v: string | undefined) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseGeoCsv(text: string): GeoRec[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const h = rows[0].map((x) => x.trim().replace(/^\uFEFF/, ""));
  const ix = (k: string) => h.indexOf(k);
  const L = ix("Prscrbr_Geo_Lvl"), D = ix("Prscrbr_Geo_Desc"), B = ix("Brnd_Name"), G = ix("Gnrc_Name"), C = ix("Tot_Drug_Cst"), K = ix("Tot_Clms"), N = ix("Tot_Benes"), P = ix("Tot_Prscrbrs");
  if ([L, D, B, C].some((i) => i < 0)) throw new Error("unexpected CMS geography columns: " + h.join(","));
  const out: GeoRec[] = [];
  for (const r of rows.slice(1)) {
    const lvl = r[L];
    if (lvl !== "National" && lvl !== "State") continue;
    const cost = num(r[C]);
    if (cost == null || cost <= 0) continue;
    const name = (r[D] ?? "").trim();
    out.push({
      national: lvl === "National",
      state: lvl === "State" ? NAME_TO_CODE[name.toLowerCase()] ?? null : null,
      stateName: name,
      brand: (r[B] ?? "").trim(),
      generic: (r[G] ?? "").trim(),
      cost,
      claims: num(r[K]),
      benes: num(r[N]),
      prescribers: num(r[P]),
    });
  }
  return out;
}

/** Brand + generic identify one product across the CMS files. */
export const drugKey = (brand: string, generic: string) => `${displayBrand(brand).toLowerCase()}|${generic.toLowerCase().replace(/\s+/g, " ").trim()}`;

/**
 * Year → drug key → owning ticker, from the Part D Spending by Drug annual file. A brand is owned in
 * a year when labelers resolving to one ticker carry at least OWNER_SHARE of its labeler-level
 * spending (the "Overall" roll-up row is skipped).
 */
export function partDOwners(records: CmsRecord[], resolve: (maker: string) => string | null): Map<number, Map<string, string>> {
  const acc = new Map<number, Map<string, { total: number; by: Map<string, number> }>>();
  for (const r of records) {
    const maker = (r.Mftr_Name ?? "").trim();
    if (!maker || maker === "Overall" || !r.Brnd_Name) continue;
    const key = drugKey(r.Brnd_Name, r.Gnrc_Name ?? "");
    const t = resolve(maker);
    for (const k of Object.keys(r)) {
      const m = /^Tot_Spndng_(\d{4})$/.exec(k);
      if (!m) continue;
      const v = num(r[k]);
      if (v == null || v <= 0) continue;
      const y = Number(m[1]);
      const ym = acc.get(y) ?? acc.set(y, new Map()).get(y)!;
      const d = ym.get(key) ?? ym.set(key, { total: 0, by: new Map() }).get(key)!;
      d.total += v;
      if (t) d.by.set(t, (d.by.get(t) ?? 0) + v);
    }
  }
  const out = new Map<number, Map<string, string>>();
  for (const [y, ym] of acc) {
    const m = new Map<string, string>();
    for (const [key, d] of ym) {
      const best = [...d.by.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= d.total * OWNER_SHARE) m.set(key, best[0]);
    }
    out.set(y, m);
  }
  return out;
}

interface Row {
  uid: string;
  ticker: string;
  dataset: string;
  kind: string;
  date: string;
  title: string;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
  source: string;
  source_url: string;
}

export interface GeoDrug {
  brand: string;
  generic: string;
  value: number;
  url: string;
}

/**
 * Per-company rows for one year: a total (national cost of its drugs, with its largest states and
 * drugs) and one row per state with the state's share of the company's spending, the company's
 * share of all Part D drug costs in the state, and an index against Medicare overall (the state's
 * share of the company's spending ÷ the state's share of all Part D spending; above 1 = its drugs
 * are prescribed more there than Medicare drugs in general).
 */
export function geoRows(year: number, recs: GeoRec[], owners: Map<string, string>, datasetId: string, opts: { topDrugs?: number; /** ticker → the company's Part D spending that year in the Spending by Drug file, to report how much of it the state view covers */ spend?: Map<string, number> } = {}): Row[] {
  const topDrugs = opts.topDrugs ?? 3;
  const allByState = new Map<string, number>();
  let allStates = 0;
  for (const r of recs) {
    if (r.national || !r.state) continue;
    allByState.set(r.state, (allByState.get(r.state) ?? 0) + r.cost);
    allStates += r.cost;
  }
  type Acc = { cost: number; claims: number; drugs: Map<string, GeoDrug> };
  const per = new Map<string, { nat: Acc; states: Map<string, Acc>; unplaced: number }>();
  const add = (a: Acc, r: GeoRec, url: string) => {
    a.cost += r.cost;
    a.claims += r.claims ?? 0;
    const k = drugKey(r.brand, r.generic);
    const d = a.drugs.get(k) ?? a.drugs.set(k, { brand: displayBrand(r.brand), generic: r.generic, value: 0, url }).get(k)!;
    d.value += r.cost;
  };
  const fresh = (): Acc => ({ cost: 0, claims: 0, drugs: new Map() });
  for (const r of recs) {
    const t = owners.get(drugKey(r.brand, r.generic));
    if (!t) continue;
    const c = per.get(t) ?? per.set(t, { nat: fresh(), states: new Map(), unplaced: 0 }).get(t)!;
    if (r.national) add(c.nat, r, geoRecordUrl(datasetId, "National", r.brand));
    else if (r.state) add(c.states.get(r.state) ?? c.states.set(r.state, fresh()).get(r.state)!, r, geoRecordUrl(datasetId, r.stateName, r.brand));
    else c.unplaced += r.cost;
  }
  const date = `${year}-12-31`;
  const out: Row[] = [];
  const top = (a: Acc, n: number) => [...a.drugs.values()].sort((x, y) => y.value - x.value).slice(0, n).map((d) => ({ ...d, value: Math.round(d.value) }));
  for (const [ticker, c] of per) {
    const placed = [...c.states.values()].reduce((s, a) => s + a.cost, 0);
    if (placed <= 0) continue;
    const ranked = [...c.states.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const base = { ticker, dataset: GEO_DATASET, kind: "series", date, unit: "USD", source: "CMS Medicare Part D Prescribers by Geography and Drug" };
    const index = (st: string, cost: number) => {
      const all = allByState.get(st);
      return all && allStates ? cost / placed / (all / allStates) : null;
    };
    out.push({
      ...base,
      uid: `cmsgeo:${ticker}:${year}:total`,
      title: GEO_TOTAL,
      value: Math.round(c.nat.cost || placed),
      meta: {
        year,
        states: c.states.size,
        placed: Math.round(placed),
        unplaced: Math.round(c.unplaced),
        ...(opts.spend?.get(ticker) ? { coverage: Math.min(1, (c.nat.cost || placed) / opts.spend.get(ticker)!) } : {}),
        claims: c.nat.claims || null,
        drugs: c.nat.drugs.size,
        top: ranked.slice(0, 8).map(([st, a]) => ({ state: st, value: Math.round(a.cost), share: a.cost / placed, index: index(st, a.cost) })),
        top_drugs: top(c.nat, 8),
      },
      source_url: GEO_PAGE,
    });
    ranked.forEach(([st, a], i) => {
      const all = allByState.get(st) ?? null;
      out.push({
        ...base,
        uid: `cmsgeo:${ticker}:${year}:${st}`,
        title: geoStateTitle(st),
        value: Math.round(a.cost),
        meta: {
          year,
          state: st,
          name: STATES[st] ?? st,
          share: a.cost / placed,
          ...(all ? { market_share: a.cost / all, state_total: Math.round(all) } : {}),
          index: index(st, a.cost),
          claims: a.claims || null,
          rank: i + 1,
          drugs: top(a, topDrugs),
        },
        // the state's largest drug for the company; every drug in meta links its own record
        source_url: top(a, 1)[0]?.url ?? GEO_PAGE,
      });
    });
  }
  return out;
}

/** "…by Geography and Drug : 2024-12-01" catalog entries → year → { CSV url, API dataset id }. */
export function geoDistributions(catalog: { dataset: { title: string; distribution?: { title?: string; accessURL?: string; downloadURL?: string; description?: string }[] }[] }): Map<number, { csv: string; id: string }> {
  const out = new Map<number, { csv: string; id: string }>();
  for (const ds of catalog.dataset ?? []) {
    if (!ds.title?.startsWith(GEO_TITLE_PREFIX)) continue;
    const year = Number(ds.title.slice(GEO_TITLE_PREFIX.length, GEO_TITLE_PREFIX.length + 4));
    if (!year || out.has(year)) continue;
    const dist = ds.distribution ?? [];
    const csv = dist.map((d) => d.downloadURL ?? "").find((u) => /\.csv$/i.test(u));
    // the "latest" alias moves to the next year when CMS publishes it; link the year's own version
    const ids = (pick: (d: (typeof dist)[number]) => boolean) => dist.filter(pick).map((d) => /data-api\/v1\/dataset\/([0-9a-f-]{36})\/data/.exec(d.accessURL ?? "")?.[1]).find(Boolean);
    const api = ids((d) => d.description !== "latest") ?? ids(() => true);
    if (csv && api) out.set(year, { csv, id: api });
  }
  return out;
}

// ---------- assistant text ----------

interface TextRow {
  ticker: string;
  date: string | null;
  title: string;
  value: number | null;
  meta: Record<string, any>;
  source_url: string | null;
}

const usd = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const pc = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

/** One company's Part D costs by state: latest year's states (share, slice of the state, index, change) and drugs. */
export function geoCompanyText(rows: TextRow[], ticker: string, limit = 15): string {
  const years = [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => b - a);
  if (!years.length) return `No Medicare Part D state data for ${ticker} (only drug makers whose own labelers carry ≥95% of a brand's Part D spending are covered).`;
  const y = years[0], y0 = years[years.length - 1];
  const total = rows.find((r) => r.title === GEO_TOTAL && r.meta?.year === y);
  const at = (yr: number) => new Map(rows.filter((r) => r.meta?.year === yr && r.title !== GEO_TOTAL).map((r) => [r.meta.state as string, r]));
  const now = at(y), then = at(y0);
  const states = [...now.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const lines = [
    `${ticker} Medicare Part D gross drug costs by prescriber state, ${y} (CMS Part D Prescribers by Geography and Drug; before rebates; the company's own brands only): ${usd(total?.value)} nationally across ${states.length} states${total?.meta?.coverage != null ? `, covering ${pc(total.meta.coverage, 0)} of its Part D spending in CMS's Spending by Drug file` : ""}. Index = state's share of the company's costs ÷ state's share of all Part D costs (above 1 = prescribed more there than Medicare drugs overall). <${GEO_PAGE}>`,
    `STATES (largest first; change vs ${y0}):`,
    ...states.slice(0, limit).map((r) => {
      const o = then.get(r.meta.state);
      const g = o?.value ? (r.value ?? 0) / o.value - 1 : null;
      return `${r.meta.state} ${usd(r.value)} · ${pc(r.meta.share)} of company · ${pc(r.meta.market_share, 2)} of the state's Part D · index ${r.meta.index?.toFixed(2) ?? "—"}${g != null && y0 !== y ? ` · ${g >= 0 ? "+" : ""}${(g * 100).toFixed(0)}% vs ${y0}` : ""} · top: ${(r.meta.drugs ?? []).map((d: GeoDrug) => `${d.brand} ${usd(d.value)}`).join(", ")} <${r.source_url}>`;
    }),
  ];
  const over = [...states].filter((r) => (r.meta.share ?? 0) >= 0.005).sort((a, b) => (b.meta.index ?? 0) - (a.meta.index ?? 0));
  if (over.length > 4) {
    lines.push("MOST OVER-INDEXED (≥0.5% of company):", over.slice(0, 5).map((r) => `${r.meta.state} ${r.meta.index?.toFixed(2)}`).join(", "));
    lines.push("MOST UNDER-INDEXED:", over.slice(-5).reverse().map((r) => `${r.meta.state} ${r.meta.index?.toFixed(2)}`).join(", "));
  }
  if (total?.meta?.top_drugs?.length) lines.push("LARGEST DRUGS NATIONALLY:", (total.meta.top_drugs as GeoDrug[]).map((d) => `${d.brand} (${d.generic}) ${usd(d.value)} <${d.url}>`).join("; "));
  return lines.join("\n");
}

/** Every covered drug maker in one state, ranked by Part D costs. */
export function geoStateText(rows: TextRow[], state: string, latest: string | null, limit = 20): string {
  if (!rows.length) return `No Medicare Part D state rows for ${state}.`;
  const all = rows[0].meta?.state_total as number | undefined;
  return [
    `Covered drug makers' Medicare Part D gross drug costs in ${STATES[state] ?? state}, ${latest?.slice(0, 4)} (prescriber state; before rebates)${all ? `; all Part D drug costs there ${usd(all)}` : ""}:`,
    ...rows.slice(0, limit).map((r, i) => `${i + 1}. ${r.ticker} ${usd(r.value)} · ${pc(r.meta.market_share, 2)} of the state · ${pc(r.meta.share)} of the company · index ${r.meta.index?.toFixed(2) ?? "—"} · top: ${(r.meta.drugs ?? []).slice(0, 2).map((d: GeoDrug) => d.brand).join(", ")} <${r.source_url}>`),
  ].join("\n");
}
