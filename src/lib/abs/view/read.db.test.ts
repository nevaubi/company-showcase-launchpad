// The view's reads on a real PostgreSQL (set ABS_DB_URL to a scratch database with migration 0067, the
// import proof's stubs and real filings stored by scripts/abs-ee.ts). Run as a signed-in member, row
// security in force. Where the optional SQL functions of the round 4 part of migration 0069 are present
// (abs_monitor, abs_deal), the payloads must agree with them field for field.
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readDeal, readMonitor } from "../read.server";
import { pgReadClient } from "./pg-client";
import { FAMILIES } from "./codes";
import type { DealPayload, MonitorPayload } from "./types";

const url = process.env.ABS_DB_URL;
const MEMBER = "00000000-0000-0000-0000-0000000000aa";
const sql = url ? postgres(url, { max: 2, onnotice: () => undefined }) : null;
afterAll(async () => {
  await sql?.end();
});

const asMember = async (query: string) =>
  sql!.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx.unsafe(`set local request.jwt.claim.sub = '${MEMBER}'`);
    return tx.unsafe(query);
  });

describe.skipIf(!url)("reads on the local database", () => {
  it("returns nothing to a caller without app access", async () => {
    const outsider = pgReadClient(sql!, "00000000-0000-0000-0000-0000000000bb");
    const m = await readMonitor(outsider, "cmbs");
    expect(m.deals).toHaveLength(0);
    expect(await readDeal(outsider, "0001752363")).toBeNull();
  });

  it("agrees with abs_monitor() and abs_deal() where those functions exist", async () => {
    const present = await sql!`select count(*)::int as n from pg_proc where proname in ('abs_monitor', 'abs_deal')`;
    if (present[0].n < 2) return;
    const db = pgReadClient(sql!, MEMBER);
    for (const family of FAMILIES) {
      const mine = await readMonitor(db, family);
      const [{ r }] = (await asMember(`select abs_monitor('${family}') as r`)) as unknown as { r: MonitorPayload }[];
      expect(mine.deals.map((d) => d.deal_id)).toEqual(r.deals.map((d) => d.deal_id));
      for (const [i, d] of mine.deals.entries()) {
        const o = r.deals[i];
        expect(d.files).toEqual(o.files);
        expect(d.trend).toEqual(o.trend);
        expect(d.latest?.accession ?? null).toEqual(o.latest?.accession ?? null);
        if (d.latest && o.latest) {
          expect(d.latest.split).toEqual(o.latest.split);
          for (const [k, v] of Object.entries(d.latest.totals)) expect(v).toEqual(o.latest.totals[k]);
        }
        expect(d.offering?.accession ?? null).toEqual(o.offering?.accession ?? null);
      }
    }
    const ids = (await sql!`select deal_id from abs_deals order by deal_id`).map((x) => String(x.deal_id));
    for (const id of ids) {
      const mine = (await readDeal(db, id))!;
      const [{ r }] = (await asMember(`select abs_deal('${id}') as r`)) as unknown as { r: DealPayload }[];
      expect(mine.filings.map((f) => f.accession)).toEqual(r.filings.map((f) => f.accession));
      for (const [i, f] of mine.filings.entries()) {
        const o = r.filings[i];
        for (const k of ["records_end", "period_ends", "records_after_filing", "cover_after_filing", "is_current", "superseded_by", "alone_amendment"] as const)
          expect(f[k]).toEqual(o[k]);
        expect(f.figures).toEqual(o.figures);
        expect(f.file?.sha256 ?? null).toEqual(o.file?.sha256 ?? null);
      }
      expect(mine.shown).toEqual(r.shown);
      expect(mine.breakdowns).toEqual(r.breakdowns);
      expect(mine.loans.map((l) => [l.rec, l.sched_end_balance, l.payment_status_code])).toEqual(
        r.loans.map((l) => [l.rec, l.sched_end_balance, l.payment_status_code]),
      );
      expect(mine.properties.map((p) => [p.rec, p.seq, p.loan_asset_number, p.link])).toEqual(
        r.properties.map((p) => [p.rec, p.seq, p.loan_asset_number, p.link]),
      );
    }
  }, 120_000);
});
