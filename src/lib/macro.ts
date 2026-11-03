import type { MacroDef } from "@/lib/coverage";

type Obs = [string, number][];

const back = (d: string, months: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() - months);
  return t.toISOString().slice(0, 10);
};

/** Value at or before `date` (binary search on sorted observations). */
export function valueAt(obs: Obs, date: string): number | null {
  let lo = 0;
  let hi = obs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid][0] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? obs[ans][1] : null;
}

/** Apply the series' display transform (year-over-year % or period change). */
export function transformed(def: Pick<MacroDef, "transform">, obs: Obs): Obs {
  if (def.transform === "yoy") {
    const out: Obs = [];
    for (const [d, v] of obs) {
      const prior = valueAt(obs, back(d, 12));
      if (prior && obs[0][0] <= back(d, 12)) out.push([d, (v / prior - 1) * 100]);
    }
    return out;
  }
  if (def.transform === "diff") return obs.slice(1).map(([d, v], i) => [d, v - obs[i][1]]);
  return obs;
}

export function displayUnits(def: Pick<MacroDef, "transform" | "units">) {
  if (def.transform === "yoy") return "% y/y";
  if (def.transform === "diff") return `Δ ${def.units.toLowerCase()}`;
  return def.units;
}

export function fmtMacro(def: Pick<MacroDef, "transform" | "units" | "id">, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (def.transform === "yoy") return `${v.toFixed(1)}%`;
  if (def.transform === "diff") return `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString()}k`;
  if (def.units === "%" || def.units === "pp") return `${v.toFixed(2)}${def.units === "%" ? "%" : " pp"}`;
  if (def.id === "WALCL") return `$${(v / 1e6).toFixed(2)}T`;
  if (def.id === "ICSA") return `${Math.round(v / 1000)}k`;
  if (Math.abs(v) >= 1e5) return Math.round(v).toLocaleString();
  return v.toFixed(v < 10 ? 2 : 1);
}

export interface Reading {
  latest: number | null;
  date: string | null;
  prior: number | null;
  priorLabel: string;
  yearAgo: number | null;
}

export function reading(def: MacroDef, raw: Obs): Reading {
  const obs = transformed(def, raw);
  const last = obs.at(-1);
  if (!last) return { latest: null, date: null, prior: null, priorLabel: "", yearAgo: null };
  const step = def.frequency === "Daily" ? 1 : def.frequency === "Weekly" ? 1 : 1;
  const prev = def.frequency === "Daily" ? valueAt(obs, back(last[0], 1)) : (obs.at(-1 - step)?.[1] ?? null);
  return {
    latest: last[1],
    date: last[0],
    prior: prev,
    priorLabel: def.frequency === "Daily" ? "1M ago" : def.frequency === "Weekly" ? "prior week" : def.frequency === "Quarterly" ? "prior qtr" : "prior month",
    yearAgo: valueAt(obs, back(last[0], 12)),
  };
}

export function changeText(def: MacroDef, r: Reading) {
  if (r.latest == null || r.prior == null) return "";
  const d = r.latest - r.prior;
  const isRate = def.units === "%" || def.units === "pp" || def.transform === "yoy";
  const s = isRate ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)} bp` : `${d >= 0 ? "+" : ""}${fmtMacro(def, d).replace(/^\+?/, "")}`;
  return `${s} vs ${r.priorLabel}`;
}
