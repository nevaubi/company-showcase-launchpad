// Writes the fixtures of this folder: the payloads of the view's two reads (src/lib/abs/read.server.ts)
// run on a local PostgreSQL that the real importer filled offline from SEC files (migration 0067, the
// stubs of the import proof, `scripts/abs-ee.ts run --offline` for CIKs 1752363, 2126256, 2140699,
// 2149768 and 2158812). The reads run as a signed-in member, row security in force.
//
//   ABS_DB_URL=postgres://postgres@127.0.0.1:54329/r4_abs_test bun src/test/fixtures/abs-view/export.ts
//
// Times that belong to the local load and not to the filings (when a row was stored or a file
// retrieved here) are pinned to one value, so a new export differs only where the data differs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { readDeal, readMonitor } from "../../../lib/abs/read.server";
import { pgReadClient } from "../../../lib/abs/view/pg-client";
import { FAMILIES } from "../../../lib/abs/view/codes";

export const MEMBER = "00000000-0000-0000-0000-0000000000aa";
export const PINNED = "2026-11-25T19:42:00+00:00";
const VOLATILE = new Set(["loaded_at", "updated_at", "retrieved_at", "newest_loaded_at"]);

export function pin<T>(value: T): T {
  if (Array.isArray(value)) return value.map(pin) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = VOLATILE.has(k) && v != null ? PINNED : pin(v);
    return out as T;
  }
  return value;
}

async function main() {
  const url = process.env.ABS_DB_URL;
  if (!url) throw new Error("set ABS_DB_URL to the local test database");
  const out = dirname(fileURLToPath(import.meta.url));
  mkdirSync(out, { recursive: true });
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    const db = pgReadClient(sql, MEMBER);
    for (const family of FAMILIES) {
      const payload = pin(await readMonitor(db, family));
      writeFileSync(join(out, `monitor_${family}.json`), JSON.stringify(payload));
      console.log(`monitor_${family}.json`, payload.deals.length, "deals");
    }
    const ids = (await sql`select deal_id from abs_deals order by deal_id`).map((r) => String(r.deal_id));
    for (const id of ids) {
      const payload = pin(await readDeal(db, id));
      writeFileSync(join(out, `deal_${id.replace(/[^0-9A-Za-z.-]/g, "_")}.json`), JSON.stringify(payload));
      console.log(`deal_${id}.json`, payload?.filings.length, "filings");
    }
    console.log("selects run:", db.calls.length);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
