// OFR Hedge Fund Monitor ETL: every public series (SEC Form PF aggregates, CFTC Traders in
// Financial Futures, Fed SCOOS dealer survey, FICC sponsored repo) → public/data/hedge-funds.json.
//   bun scripts/hedge-funds.ts
// Values are stored exactly as published; each series keeps its OFR mnemonic and API source URL.
import { writeFile } from "node:fs/promises";

const API = "https://data.financialresearch.gov/hf/v1";
const SETS = ["fpf", "tff", "scoos", "ficc"] as const;
const NAMES: Record<string, string> = { fpf: "SEC Form PF — hedge fund aggregates", tff: "CFTC Traders in Financial Futures", scoos: "Fed Senior Credit Officer Opinion Survey (SCOOS)", ficc: "DTCC FICC sponsored repo" };

type Raw = { short_name: string; long_name: string; timeseries: Record<string, { timeseries: { aggregation: [string, number | null][] }; metadata: any }> };

const out: any = { updated: new Date().toISOString(), source: "U.S. Office of Financial Research — Hedge Fund Monitor", datasets: {} };
let n = 0;
for (const ds of SETS) {
  let raw: Raw | null = null;
  for (let i = 0; i < 4 && !raw; i++) {
    try {
      const r = await fetch(`${API}/series/dataset?dataset=${ds}`, { signal: AbortSignal.timeout(90_000) });
      if (r.ok) raw = await r.json();
    } catch { await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
  }
  if (!raw) throw new Error(`OFR ${ds} failed — keeping the previous snapshot`);
  const series = Object.entries(raw.timeseries).map(([m, s]) => {
    const md = s.metadata ?? {};
    const data = (s.timeseries?.aggregation ?? []).filter(([, v]) => v !== null && Number.isFinite(v)) as [string, number][];
    return {
      m, name: md.description?.name ?? m, notes: md.description?.notes ?? "",
      unit: md.unit?.name ?? "", freq: md.schedule?.observation_frequency ?? "", updated: md.schedule?.last_update ?? null,
      release: md.release?.long_name ?? NAMES[ds],
      url: `${API}/series/full?mnemonic=${m}`, data,
    };
  }).filter((s) => s.data.length);
  n += series.length;
  out.datasets[ds] = { name: NAMES[ds], series };
  console.log(ds, series.length, "series");
}
await writeFile("public/data/hedge-funds.json", JSON.stringify(out));
console.log("wrote", n, "series");
