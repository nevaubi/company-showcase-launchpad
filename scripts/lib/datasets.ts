// Company and price datasets for pipeline scripts. Covered companies' files are no longer bundled
// in public/data; they come from the partner data service (PARTNER_DATA_KEY), with a local file
// (e.g. a fresh `bun scripts/ingest.ts` run) taking precedence when present.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const URL_ = process.env.PARTNER_DATA_URL || "https://www.filedunder.ai/api/app-data";

export async function readDataset<T>(kind: "companies" | "prices", file: string): Promise<T> {
  const local = `public/data/${kind}/${file}.json`;
  if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")) as T;
  const key = process.env.PARTNER_DATA_KEY;
  if (!key) throw new Error(`${local} is not bundled and PARTNER_DATA_KEY is not set`);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${URL_}?path=${encodeURIComponent(`${kind}/${file}.json`)}`, { headers: { "x-partner-key": key }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r?.ok) return (await r.json()) as T;
    if (r && r.status === 404) throw new Error(`no ${kind} dataset for ${file}`);
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(`partner data service unavailable for ${kind}/${file}`);
}
