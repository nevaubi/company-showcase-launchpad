import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { linkColumns, screenRows, selectSupplyLinks } from "./read";

const ROOT = join(__dirname, "../../..");

/**
 * Files that may name the `supply_links` table. Everything else reads it through `read.ts`, which verifies each row's
 * claims against its own sentence. Keep this list short; a new entry needs a reason.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/supply/read.ts": "the shared, screened read path",
  "src/lib/supply/extract.server.ts": "writes the table (delete and insert per filer)",
  "scripts/supply-revalidate.ts": "reports what the read-time checks remove, so it must read stored rows unscreened",
  "src/lib/jobs/data-freshness.ts": "freshness key only, no query",
  "src/lib/coverage/corpora.ts": "the coverage ledger's corpus id only, no query (counts come from corpus_measure in the database)",
  "src/integrations/supabase/types.ts": "generated database types",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("supply_links readers", () => {
  it("no file outside the allow list names the table", () => {
    const offenders = [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts"))]
      .map((p) => relative(ROOT, p))
      .filter((p) => !(p in ALLOWED))
      .filter((p) => /["'`]supply_links["'`]/.test(readFileSync(join(ROOT, p), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("every allowed file exists, so the list cannot go stale", () => {
    for (const p of Object.keys(ALLOWED)) expect(statSync(join(ROOT, p)).isFile()).toBe(true);
  });
});

describe("linkColumns", () => {
  it("adds what verification needs whenever a claim column is read", () => {
    expect(linkColumns("ticker, counterparty_ticker, relation, filed")).toEqual({ select: "ticker,counterparty_ticker,relation,filed", screen: false });
    expect(linkColumns("regions")).toEqual({ select: "regions,quote,detail,relation,counterparty", screen: true });
    expect(linkColumns("id,amount_usd,quote")).toEqual({ select: "id,amount_usd,quote,detail,relation,counterparty", screen: true });
    expect(linkColumns("*")).toEqual({ select: "*", screen: true });
  });
});

describe("screened reads", () => {
  const raw = {
    id: "w1",
    relation: "customer",
    counterparty: "Bosch",
    detail: "",
    quote: "Bosch accounted for 12% of our $2.5 billion revenue, and Bosch is our sole supplier of sensors in China.",
    amount_usd: 2.5e9,
    single_source: true,
    regions: ["China", "Germany"],
  };
  it("never hands out a raw claim", async () => {
    // a stand-in client that records the select list and returns the stored row as the database would
    let selected = "";
    const q = { eq: () => q, limit: () => q, then: (ok: (v: unknown) => void) => ok({ data: [raw], error: null }) };
    const db = { from: () => ({ select: (s: string) => ((selected = s), q) }) };
    const { data } = await selectSupplyLinks<typeof raw & { flow_usd: number | null; dependency: boolean }>(db as never, "id,amount_usd,single_source,regions", (x) => (x as unknown as typeof q).eq() as never);
    expect(selected).toBe("id,amount_usd,single_source,regions,quote,detail,relation,counterparty");
    // the $2.5 billion is the filer's own revenue, a customer is never the filer's sole source, Germany is not named
    expect(data?.[0]).toMatchObject({ amount_usd: null, flow_usd: null, single_source: false, dependency: true, regions: ["China"] });
  });
  it("passes rows without claims through unchanged", () => {
    const rows = [{ ticker: "A", relation: "customer" }];
    expect(screenRows(rows, false)).toBe(rows);
  });
});
