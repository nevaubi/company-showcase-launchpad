/**
 * Read-only audit of the stored IR payloads (src/lib/ir/audit.ts): what each company's page gives, measured
 * with the page's own layout code. Writes one JSON line per company to --out and prints a summary.
 *   bun scripts/ir-audit.ts [--tickers=AAPL,JPM] [--shard=0/4] [--out=/tmp/ir-audit.jsonl] [--build=5]
 * No model, no write to the database or to storage.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { COVERAGE } from "@/lib/coverage";
import { auditPayload } from "@/lib/ir/audit";
import type { IrPayload } from "@/lib/ir/payload";
import { pageAll } from "./lib/rank";
import { args, log, sb } from "./lib/supa";

const out = args.out ?? "/tmp/ir-audit.jsonl";
const [shard, shards] = (args.shard ?? "0/1").split("/").map(Number);
const want = args.tickers ? new Set(args.tickers.split(",")) : null;
const rows = await pageAll<{ ticker: string; payload_path: string | null; payload_bytes: number | null; build: unknown; built_at: string | null }>((a, b) =>
  sb.from("ir_company_series").select("ticker, payload_path, payload_bytes, build:stats->build, built_at").order("ticker").range(a, b));
const todo = rows.filter((r, i) => r.payload_path && (!want || want.has(r.ticker)) && i % shards === shard && (!args.build || String(r.build) === args.build));
if (!args.append) writeFileSync(out, "");
const cov = new Map(COVERAGE.map((c) => [c.ticker, c]));
let n = 0;
for (const r of todo) {
  try {
    const { data, error } = await sb.storage.from("ir-documents").download(r.payload_path!);
    if (!data) throw new Error(error?.message ?? "no file");
    const p = JSON.parse(await data.text()) as IrPayload;
    const c = cov.get(r.ticker);
    const t0 = Date.now();
    const a = auditPayload(p, { sector: c?.sector, industry: c?.industry });
    appendFileSync(out, JSON.stringify({ ...a, builtAt: r.built_at, bytes: r.payload_bytes, ms: Date.now() - t0 }) + "\n");
  } catch (e) {
    appendFileSync(out, JSON.stringify({ ticker: r.ticker, error: (e as Error).message.slice(0, 200) }) + "\n");
  }
  if (++n % 25 === 0) log(`${n} of ${todo.length}`);
}
log(`audited ${n} payloads → ${out}`);
process.exit(0);
