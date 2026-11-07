// Scans every covered company for trade-idea signals and replays each rule over history
// (point-in-time) to attach hit rates. Writes public/data/signals.json. Usage:
//   bun scripts/signals.ts
import { readDataset } from "./lib/datasets";
import { readFile, writeFile } from "node:fs/promises";
import { hydrateDataset, isBankIndustry } from "../src/lib/financials/dataset";
import type { Bar, CompanyDataset } from "../src/lib/financials/types";
import { buildIdea, scanCompany, summarize, type BacktestStats, type CompanyScan, type ScanInput, type SignalKind } from "../src/lib/signals/core";

const universe = JSON.parse(await readFile("public/data/universe.json", "utf8")) as { companies: { ticker: string }[] };
const spy = (JSON.parse(await readFile("public/data/prices/SPY.json", "utf8")) as { bars: Bar[] }).bars;

const inputs: ScanInput[] = [];
const scans: CompanyScan[] = [];
for (const { ticker } of universe.companies) {
  try {
    const dataset = hydrateDataset(await readDataset<CompanyDataset>("companies", ticker));
    const bars = (await readDataset<{ bars: Bar[] }>("prices", ticker)).bars;
    if (bars.length < 260) continue;
    const input = { ticker, dataset, bars, bank: isBankIndustry(dataset.profile.industry), spy };
    inputs.push(input);
    scans.push(scanCompany(input));
  } catch (e) {
    console.warn(ticker, (e as Error).message);
  }
}

const pooledSamples: Partial<Record<SignalKind, { ret: number; excess: number | null }[]>> = {};
for (const s of scans) for (const [k, v] of Object.entries(s.samples)) (pooledSamples[k as SignalKind] ??= []).push(...v!);
const pooled: Partial<Record<SignalKind, BacktestStats>> = {};
for (const [k, v] of Object.entries(pooledSamples)) pooled[k as SignalKind] = summarize(v!);

const ideas = inputs.map((t, i) => buildIdea(t, scans[i], pooled)).filter((x) => x != null);
ideas.sort((a, b) => b.score - a.score || (b.signals[0].stats.avgExcess ?? 0) - (a.signals[0].stats.avgExcess ?? 0));

await writeFile("public/data/signals.json", JSON.stringify({ generatedAt: new Date().toISOString(), companies: inputs.length, pooled, ideas }));
console.log(`${inputs.length} companies, ${ideas.length} ideas`);
for (const [k, v] of Object.entries(pooled)) console.log(k, v);
