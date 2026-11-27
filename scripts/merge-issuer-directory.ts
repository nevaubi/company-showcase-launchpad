/**
 * Merge reviewed source receipts into the native issuer-directory seed.
 * Run with a JSON array of reviewed links and the official SEC company_tickers.json.
 * Existing affirmative decisions and explicit withheld destinations stay protected.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { COVERAGE } from "../src/lib/coverage";
import { guardedSourceOf } from "../src/lib/ir/source-guard";

interface Receipt {
  ticker: string; cik: string; kind: "website" | "ir"; status: "verified" | "withheld";
  url: string | null; evidence_url: string; evidence_text: string; checked_on: string;
}
const [incomingFile, secFile, output] = process.argv.slice(2);
if (!incomingFile || !secFile) throw new Error("Pass a reviewed JSON file and SEC company_tickers.json.");
const seedPath = output || fileURLToPath(new URL("./data/issuer-directory.json", import.meta.url));
const original = await readFile(seedPath, "utf8");
const prior: Receipt[] = JSON.parse(original);
const incoming: Receipt[] = JSON.parse(await readFile(incomingFile, "utf8"));
const sec: Record<string, { ticker: string; cik_str: number }> = JSON.parse(await readFile(secFile, "utf8"));
const secByTicker = new Map(Object.values(sec).map((r) => [r.ticker, String(r.cik_str)]));
const coverage = new Map(COVERAGE.map((c) => [c.ticker, String(Number(c.cik))]));
const key = (r: Receipt) => [r.ticker, r.cik, r.kind].join(":");
const rows = new Map(prior.map((r) => [key(r), r]));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const safeDestination = (s: string) => {
  const url = new URL(s);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443") && url.hostname.includes(".");
};

let added = 0;
for (const row of incoming) {
  if (coverage.get(row.ticker) !== row.cik || secByTicker.get(row.ticker) !== row.cik) throw new Error("Ticker/CIK mismatch for " + row.ticker);
  if (!["ir", "website"].includes(row.kind) || row.status !== "verified" || !row.url || !safeDestination(row.url) || !safeDestination(row.evidence_url) ||
      !row.evidence_text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(row.checked_on) || guardedSourceOf(row.ticker, row.url)) {
    throw new Error("Invalid source evidence or reviewed wrong destination for " + key(row));
  }
  const old = rows.get(key(row));
  if (old && (Object.keys(old) as (keyof Receipt)[]).some((k) => old[k] !== row[k])) throw new Error("Existing reviewed decision requires separate review for " + key(row));
  if (!old) { rows.set(key(row),row); added++; }
}
if (added) {
  const ordered = [...rows.values()].sort((a,b) => compare(a.ticker,b.ticker) || compare(a.kind,b.kind) || compare(a.cik,b.cik));
  const content = "[\n" + ordered.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";
  const tmp = seedPath + "." + process.pid + ".tmp";
  await writeFile(tmp,content);
  await rename(tmp,seedPath);
}
console.log(`Added ${added} issuer links. Verified seed has ${rows.size} decisions.`);
