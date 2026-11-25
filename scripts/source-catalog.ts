/**
 * Regenerates `src/lib/sources/catalog/titles.generated.json`: a title for a stored official dataset
 * only where the publisher's own listing names it, with the listing's address beside it.
 *
 *   bun scripts/source-catalog.ts --cache <dir> [--datasets <file>] [--out <file>] [--offline]
 *
 * Reads the dataset list from the verified production fixture by default
 * (`src/test/fixtures/sources/catalog/datasets.json`). Listings are read politely through
 * `scripts/lib/source-catalog/http.ts` (one request at a time, a named User-Agent, each address
 * once, every response kept in the cache folder); with `--offline` only the cache is used, so a
 * rerun on the same cache writes the same file. Nothing is written to any database.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readListing } from "./lib/source-catalog/http";
import { FAMILIES } from "./lib/source-catalog/families";
import type { DatasetRow, GeneratedTitle, Page, Unmatched } from "./lib/source-catalog/types";

type Args = { cache: string; datasets: string; out: string; offline: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cache: ".cache/source-catalog",
    datasets: "src/test/fixtures/sources/catalog/datasets.json",
    out: "src/lib/sources/catalog/titles.generated.json",
    offline: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--offline") args.offline = true;
    else if (flag === "--cache" || flag === "--datasets" || flag === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error(`${flag} needs a value`);
      args[flag.slice(2) as "cache" | "datasets" | "out"] = value;
      i += 1;
    } else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

async function readDatasets(file: string): Promise<DatasetRow[]> {
  const doc = JSON.parse(await readFile(file, "utf8")) as { datasets?: DatasetRow[] } | DatasetRow[];
  const list = Array.isArray(doc) ? doc : doc.datasets;
  if (!Array.isArray(list) || !list.length) throw new Error(`${file} holds no datasets`);
  return list;
}

function render(titles: Record<string, GeneratedTitle>): string {
  const ids = Object.keys(titles).sort();
  if (!ids.length) return "{}\n";
  const lines = ids.map((id) => {
    const t = titles[id];
    const entry: GeneratedTitle = t.code ? { title: t.title, code: t.code, source: t.source } : { title: t.title, source: t.source };
    return `  ${JSON.stringify(id)}: ${JSON.stringify(entry)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cache = resolve(args.cache);
  const datasets = await readDatasets(args.datasets);
  const titles: Record<string, GeneratedTitle> = {};
  const unmatched: (Unmatched & { family: string })[] = [];
  const claimed = new Map<string, string>();

  for (const family of FAMILIES) {
    const candidates = family.candidates(datasets);
    const pages = new Map<string, Page>();
    for (const url of family.listings(candidates)) {
      try {
        const listing = await readListing(url, cache, args.offline);
        pages.set(url, { url, status: listing.status, body: listing.body });
      } catch (error) {
        console.error(`${family.id}: ${url}: ${(error as Error).message}`);
      }
    }
    const result = family.build(candidates, pages);
    for (const [id, title] of Object.entries(result.titles)) {
      const earlier = claimed.get(id);
      if (earlier) throw new Error(`${id} is titled by both ${earlier} and ${family.id}`);
      claimed.set(id, family.id);
      titles[id] = title;
    }
    for (const miss of result.unmatched) unmatched.push({ ...miss, family: family.id });
    console.log(
      `${family.id.padEnd(16)} ${String(candidates.length).padStart(4)} datasets, ${String(Object.keys(result.titles).length).padStart(4)} titled, ${String(result.unmatched.length).padStart(4)} not matched, ${pages.size} listing(s)`,
    );
  }

  await writeFile(args.out, render(titles));
  console.log(`${Object.keys(titles).length} of ${datasets.length} datasets have a title from a listing -> ${args.out}`);
  const reasons = new Map<string, number>();
  for (const miss of unmatched) {
    const key = `${miss.family}: ${miss.reason}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...reasons].sort()) console.log(`  not matched ${String(n).padStart(4)}  ${reason}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
