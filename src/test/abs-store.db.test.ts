// The ABS-EE store's rules, run against a real PostgreSQL: all-or-nothing loads, no-op reruns, resuming a
// cut-off load, revisions, strict columns, and who may read or write. These rules live in the functions
// of migration 0067, so they are tested where they run.
//
// Skipped unless ABS_DB_URL names a scratch database on this machine whose name contains "proof" or
// "test" (the test drops and recreates the abs_* objects in it), for example:
//   ABS_DB_URL=postgres://postgres@127.0.0.1:54329/absproof bunx vitest run src/test/abs-store.db.test.ts
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAbsDb, type AbsDb } from "../../scripts/lib/abs-store";
import {
  cmbsMetrics,
  cmbsRows,
  classifyRecords,
  type CmbsAssetRow,
  type CmbsPropertyRow,
} from "@/lib/abs/cmbs";
import { readAbsText } from "@/lib/abs/xml";

const url = process.env.ABS_DB_URL ?? "";
const scratch =
  /^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\/[\w-]*(?:proof|test)[\w-]*$/.test(
    url,
  );
const MEMBER = "00000000-0000-0000-0000-0000000000aa";

// What production already has and the migration relies on.
const STUBS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.has_app_access(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _uid = '${MEMBER}'::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS public.job_runs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, ok boolean, items integer NOT NULL DEFAULT 0, detail jsonb);
`;
const DROP = `
DROP VIEW IF EXISTS public.abs_cmbs_assets_live, public.abs_cmbs_properties_live, public.abs_pool_metrics_live;
DROP TABLE IF EXISTS public.abs_pool_metrics, public.abs_cmbs_properties, public.abs_cmbs_assets, public.abs_documents, public.abs_loads, public.abs_filings, public.abs_deals CASCADE;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'abs\\_%' LOOP
    EXECUTE 'DROP FUNCTION ' || f.sig;
  END LOOP;
END $$;
`;

// Rows of a real excerpt, mapped by the same code the importer uses.
const records = readAbsText(
  readFileSync("src/test/fixtures/abs/cmbs-ex102-excerpt.xml", "utf8"),
).records;
const assets: CmbsAssetRow[] = [];
const properties: CmbsPropertyRow[] = [];
for (const r of records) {
  const x = cmbsRows(r);
  assets.push(x.asset);
  properties.push(...x.properties);
}
classifyRecords(assets, properties);
const metrics = cmbsMetrics(assets, properties);
const EXPECT = {
  cmbs_assets: assets.length,
  cmbs_properties: properties.length,
  metrics: metrics.length,
};
const SHA = "a".repeat(64);
const facts = (more: Record<string, unknown> = {}) => ({
  deal_id: "0002017898",
  issuer_cik: 2017898,
  issuer_name: "BANK5 Trust 2024-5YR6",
  file_number: "333-258342-04",
  family: "cmbs",
  asset_class: "Commercial mortgages",
  depositor_cik: 1013611,
  sponsor_cik: 835271,
  period_start: "2024-05-06",
  period_end: "2024-06-17",
  accepted_at: "2024-06-28 10:39:16 America/New_York",
  header_sha256: "b".repeat(64),
  ...more,
});
const DOCS = [
  {
    seq: 2,
    doc_type: "EX-102",
    name: "exh_102.xml",
    description: null,
    url: "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/exh_102.xml",
    listed_bytes: 345077,
    bytes: 345077,
    sha256: SHA,
    records: 6,
    namespace: "ns",
    retrieved_at: "2024-07-01T00:00:00Z",
  },
];
const A = "0001888524-24-009544";
const B = "0001888524-24-010502";
const AMEND = "0001888524-24-011111";
const EARLY = "0001888524-24-000007";

describe.skipIf(!scratch)("abs store on a real Postgres", () => {
  let admin: postgres.Sql;
  let db: AbsDb;
  const rows = async (q: string) => (await admin.unsafe(q)) as unknown as Record<string, unknown>[];
  const one = async (q: string) => Object.values((await rows(q))[0])[0];
  const checkClean = async () =>
    expect(
      (await db.rpc<{ problem: string; bad: string }[]>("abs_check")).filter(
        (r) => Number(r.bad) !== 0,
      ),
    ).toEqual([]);
  const putAll = async (load: number) => {
    expect(
      await db.rpc("abs_put_rows", { _load_id: load, _kind: "cmbs_assets", _rows: assets }),
    ).toBe(assets.length);
    expect(
      await db.rpc("abs_put_rows", { _load_id: load, _kind: "cmbs_properties", _rows: properties }),
    ).toBe(properties.length);
    expect(await db.rpc("abs_put_rows", { _load_id: load, _kind: "metrics", _rows: metrics })).toBe(
      metrics.length,
    );
  };
  const begin = (accession: string, parser = "abs-1", sha = SHA, force = false) =>
    db.rpc<{ skip: boolean; load_id: number }>("abs_begin_load", {
      _accession: accession,
      _parser: parser,
      _sha256: sha,
      _bytes: 345077,
      _force: force,
    });
  const store = async (accession: string, f = facts()) => {
    const b = await begin(accession);
    await putAll(b.load_id);
    return db.rpc<{ current: boolean; replaced: number | null; load_id: number }>(
      "abs_commit_load",
      { _load_id: b.load_id, _filing: f, _documents: DOCS, _expect: EXPECT },
    );
  };

  beforeAll(async () => {
    admin = postgres(url, { max: 1, onnotice: () => undefined });
    await admin.unsafe(DROP);
    await admin.unsafe(STUBS);
    await admin.unsafe(readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8"));
    db = await connectAbsDb();
  });
  afterAll(async () => {
    await db?.close();
    await admin?.end();
  });

  it("lists filings once: listing again changes nothing", async () => {
    const found = [
      {
        accession: A,
        list_cik: 2017898,
        form: "ABS-EE",
        filed: "2024-06-28",
        accepted_at: "2024-06-28T14:39:16.000Z",
      },
      {
        accession: B,
        list_cik: 2017898,
        form: "ABS-EE",
        filed: "2024-07-26",
        accepted_at: "2024-07-26T20:19:21.000Z",
      },
      {
        accession: AMEND,
        list_cik: 2017898,
        form: "ABS-EE/A",
        filed: "2024-08-02",
        accepted_at: "2024-08-02T15:00:00.000Z",
      },
      {
        accession: EARLY,
        list_cik: 2017898,
        form: "ABS-EE",
        filed: "2024-06-20",
        accepted_at: "2024-06-20T15:00:00.000Z",
      },
    ];
    expect(await db.rpc("abs_register_filings", { _rows: found })).toEqual({ listed: 4, known: 0 });
    expect(await db.rpc("abs_register_filings", { _rows: found })).toEqual({ listed: 0, known: 4 });
    const states = await db.rpc<{ accession: string; status: string }[]>("abs_filing_states", {
      _list_cik: 2017898,
    });
    expect(states.map((s) => [s.accession, s.status])).toEqual([
      [EARLY, "listed"],
      [A, "listed"],
      [B, "listed"],
      [AMEND, "listed"],
    ]);
    await expect(
      db.rpc("abs_register_filings", {
        _rows: [{ accession: "bad", list_cik: 1, form: "ABS-EE", filed: "2024-01-01" }],
      }),
    ).rejects.toThrow(/abs_filings_accession_check/);
    await expect(
      db.rpc("abs_register_filings", {
        _rows: [
          { accession: "0000000001-24-000001", list_cik: 1, form: "10-D", filed: "2024-01-01" },
        ],
      }),
    ).rejects.toThrow(/abs_filings_form_check/);
  });

  it("stores a filing all at once, with values exactly as filed", async () => {
    const done = await store(A);
    expect(done).toMatchObject({ current: true, replaced: null });
    expect(await one("select count(*)::int from abs_cmbs_assets_live")).toBe(6);
    expect(await one("select count(*)::int from abs_cmbs_properties_live")).toBe(6);
    const loan = (
      await rows(
        "select kind, asset_number, period_end::text, original_loan_amount::text, period_rate::text, interest_only, maturity_date::text, extra->>'underwritingIndicator' as uw, cover_period_end::text, is_current from abs_cmbs_assets_live where rec = 1",
      )
    )[0];
    expect(loan).toEqual({
      kind: "loan",
      asset_number: "3",
      period_end: "2024-06-11",
      original_loan_amount: "30000000.00",
      period_rate: "0.06844",
      interest_only: true,
      maturity_date: "2029-02-11",
      uw: "true",
      cover_period_end: "2024-06-17",
      is_current: true,
    });
    expect(
      await one(
        "select value::text from abs_pool_metrics_live where metric = 'wa_period_rate' and dim = ''",
      ),
    ).toBe("0.068879726");
    // the header's Eastern acceptance time is the same instant the index gave in UTC
    expect(
      await one(
        `select (accepted_at = '2024-06-28T14:39:16Z')::text from abs_filings where accession = '${A}'`,
      ),
    ).toBe("true");
    expect((await rows("select deal_id, family, issuer_name from abs_deals"))[0]).toEqual({
      deal_id: "0002017898",
      family: "cmbs",
      issuer_name: "BANK5 Trust 2024-5YR6",
    });
    expect(
      await one(
        `select count(*)::int from abs_documents where accession = '${A}' and sha256 = '${SHA}'`,
      ),
    ).toBe(1);
    await checkClean();
  });

  it("does nothing when the same filing is stored again", async () => {
    const before = await rows(
      "select load_id, status, finished_at::text from abs_loads order by load_id",
    );
    const stamp = await one("select max(xmin::text::bigint) from abs_cmbs_assets");
    expect(await begin(A)).toMatchObject({ skip: true });
    expect(
      await rows("select load_id, status, finished_at::text from abs_loads order by load_id"),
    ).toEqual(before);
    expect(await one("select max(xmin::text::bigint) from abs_cmbs_assets")).toBe(stamp);
    await checkClean();
  });

  it("shows nothing of a load that was cut off, and starts it over on the next attempt", async () => {
    const cut = await begin(B);
    await db.rpc("abs_put_rows", {
      _load_id: cut.load_id,
      _kind: "cmbs_assets",
      _rows: assets.slice(0, 4),
    });
    // the process dies here: no commit
    expect(
      await one(`select count(*)::int from abs_cmbs_assets where load_id = ${cut.load_id}`),
    ).toBe(4);
    expect(
      await one(`select count(*)::int from abs_cmbs_assets_live where accession = '${B}'`),
    ).toBe(0);
    expect(await one(`select status from abs_filings where accession = '${B}'`)).toBe("listed");
    await checkClean();
    // next run
    const again = await begin(B);
    expect(again.skip).toBe(false);
    expect(again.load_id).not.toBe(cut.load_id);
    expect(await one(`select status from abs_loads where load_id = ${cut.load_id}`)).toBe(
      "abandoned",
    );
    expect(
      await one(`select count(*)::int from abs_cmbs_assets where load_id = ${cut.load_id}`),
    ).toBe(0);
    await expect(
      db.rpc("abs_put_rows", { _load_id: cut.load_id, _kind: "cmbs_assets", _rows: assets }),
    ).rejects.toThrow(/is not open/);
    await putAll(again.load_id);
    await db.rpc("abs_commit_load", {
      _load_id: again.load_id,
      _filing: facts({
        period_start: "2024-06-18",
        period_end: "2024-07-17",
        accepted_at: "2024-07-26 16:19:21 America/New_York",
      }),
      _documents: DOCS,
      _expect: EXPECT,
    });
    expect(
      await one(`select count(*)::int from abs_cmbs_assets_live where accession = '${B}'`),
    ).toBe(6);
    await checkClean();
  });

  it("makes a repeated chunk harmless and refuses to commit a load whose rows do not add up", async () => {
    const b = await begin(B, "abs-2");
    expect(
      await db.rpc("abs_put_rows", { _load_id: b.load_id, _kind: "cmbs_assets", _rows: assets }),
    ).toBe(6);
    expect(
      await db.rpc("abs_put_rows", { _load_id: b.load_id, _kind: "cmbs_assets", _rows: assets }),
    ).toBe(0);
    await expect(
      db.rpc("abs_commit_load", {
        _load_id: b.load_id,
        _filing: facts(),
        _documents: DOCS,
        _expect: EXPECT,
      }),
    ).rejects.toThrow(/holds .* but the reader counted/);
    // the refused load changed nothing a reader sees: the first load of B is still the data
    expect(
      await one(
        `select l.parser from abs_filings f join abs_loads l using (load_id) where f.accession = '${B}'`,
      ),
    ).toBe("abs-1");
    expect(
      await one(`select count(*)::int from abs_cmbs_properties_live where accession = '${B}'`),
    ).toBe(6);
    await checkClean();
  });

  it("replaces a filing's rows in one step when it is stored again by a newer reader", async () => {
    const old = Number(await one(`select load_id from abs_filings where accession = '${B}'`));
    const b = await begin(B, "abs-2");
    await putAll(b.load_id);
    const done = await db.rpc<{ replaced: number }>("abs_commit_load", {
      _load_id: b.load_id,
      _filing: facts({
        period_start: "2024-06-18",
        period_end: "2024-07-17",
        accepted_at: "2024-07-26 16:19:21 America/New_York",
      }),
      _documents: DOCS,
      _expect: EXPECT,
    });
    expect(done.replaced).toBe(old);
    expect(await one(`select status from abs_loads where load_id = ${old}`)).toBe("replaced");
    expect(await one(`select count(*)::int from abs_cmbs_assets where load_id = ${old}`)).toBe(0);
    expect(await one(`select count(*)::int from abs_cmbs_assets where accession = '${B}'`)).toBe(6);
    expect(
      await rows(
        `select status, count(*)::int n from abs_loads where accession = '${B}' group by 1 order by 1`,
      ),
    ).toEqual([
      { status: "abandoned", n: 2 },
      { status: "committed", n: 1 },
      { status: "replaced", n: 1 },
    ]);
    await checkClean();
  });

  it("keeps every revision and marks the one SEC accepted last as current, in whichever order they are stored", async () => {
    // an amendment of A's period, accepted later
    const amended = await store(
      AMEND,
      facts({ accepted_at: "2024-08-02 11:00:00 America/New_York" }),
    );
    expect(amended.current).toBe(true);
    expect(
      await rows(
        `select accession, is_current, superseded_by from abs_filings where period_end = '2024-06-17' order by accession`,
      ),
    ).toEqual([
      { accession: A, is_current: false, superseded_by: AMEND },
      { accession: AMEND, is_current: true, superseded_by: null },
    ]);
    // both revisions keep their rows; a reader of current data sees one
    expect(
      await one(
        "select count(*)::int from abs_cmbs_assets_live where cover_period_end = '2024-06-17'",
      ),
    ).toBe(12);
    expect(
      await one(
        "select count(*)::int from abs_cmbs_assets_live where cover_period_end = '2024-06-17' and is_current",
      ),
    ).toBe(6);
    // an earlier filing of the same period stored afterwards does not take over
    const early = await store(
      EARLY,
      facts({
        accepted_at: "2024-06-20 11:00:00 America/New_York",
        issuer_name: "BANK5 Trust 2024-5YR6 (first name)",
      }),
    );
    expect(early.current).toBe(false);
    // the deal keeps the name of its newest filing; each filing keeps the name it was filed under
    expect(await one("select issuer_name from abs_deals")).toBe("BANK5 Trust 2024-5YR6");
    expect(await one(`select issuer_name from abs_filings where accession = '${EARLY}'`)).toBe(
      "BANK5 Trust 2024-5YR6 (first name)",
    );
    expect(
      await rows(
        `select accession, is_current, superseded_by from abs_filings where period_end = '2024-06-17' order by accession`,
      ),
    ).toEqual([
      { accession: EARLY, is_current: false, superseded_by: AMEND },
      { accession: A, is_current: false, superseded_by: AMEND },
      { accession: AMEND, is_current: true, superseded_by: null },
    ]);
    await checkClean();
  });

  it("refuses a file of another asset class for a deal, instead of changing what the deal is", async () => {
    const b = await begin(A, "abs-3");
    await putAll(b.load_id);
    await expect(
      db.rpc("abs_commit_load", {
        _load_id: b.load_id,
        _filing: facts({ family: "auto_loan" }),
        _documents: DOCS,
        _expect: EXPECT,
      }),
    ).rejects.toThrow(/deal 0002017898 holds cmbs files; this file is auto_loan/);
    expect(await one("select family from abs_deals")).toBe("cmbs");
    expect(
      await one(
        `select l.parser from abs_filings f join abs_loads l using (load_id) where f.accession = '${A}'`,
      ),
    ).toBe("abs-1");
    await checkClean();
  });

  it("refuses a column the table does not have, an unknown kind and a filing that is not listed", async () => {
    const b = await begin(A, "abs-9");
    await expect(
      db.rpc("abs_put_rows", {
        _load_id: b.load_id,
        _kind: "cmbs_assets",
        _rows: [{ ...assets[0], orignal_loan_amount: "1" }],
      }),
    ).rejects.toThrow(/has no column "orignal_loan_amount"/);
    await expect(
      db.rpc("abs_put_rows", { _load_id: b.load_id, _kind: "loans", _rows: [] }),
    ).rejects.toThrow(/unknown kind/);
    await expect(
      db.rpc("abs_put_rows", {
        _load_id: b.load_id,
        _kind: "metrics",
        _rows: [{ metric: "records", value: "1", unit: "furlongs" }],
      }),
    ).rejects.toThrow(/abs_pool_metrics_unit_check/);
    await expect(begin("0009999999-24-000001")).rejects.toThrow(/is not listed/);
    await expect(
      db.rpc("abs_commit_load", {
        _load_id: b.load_id,
        _filing: { deal_id: null },
        _documents: [],
        _expect: { cmbs_assets: 0, cmbs_properties: 0, metrics: 0 },
      }),
    ).rejects.toThrow(/need deal_id, issuer_name and family/);
    // a failed attempt is noted without touching the stored filing
    await db.rpc("abs_mark_filing", { _accession: A, _status: "failed", _detail: "network" });
    expect(
      (
        await rows(
          `select status, attempts, status_detail from abs_filings where accession = '${A}'`,
        )
      )[0],
    ).toEqual({ status: "loaded", attempts: 1, status_detail: "network" });
    await expect(
      db.rpc("abs_mark_filing", { _accession: A, _status: "loaded", _detail: "x" }),
    ).rejects.toThrow(/skipped or failed/);
    await checkClean();
  });

  it("finds a stored value that differs from the source, and none when they agree", async () => {
    expect(
      await db.rpc("abs_verify_rows", { _accession: AMEND, _kind: "cmbs_assets", _rows: assets }),
    ).toBe(0);
    expect(
      await db.rpc("abs_verify_rows", {
        _accession: AMEND,
        _kind: "cmbs_properties",
        _rows: properties,
      }),
    ).toBe(0);
    expect(
      await db.rpc("abs_verify_rows", { _accession: AMEND, _kind: "metrics", _rows: metrics }),
    ).toBe(0);
    // the same number written with another scale is the same value
    expect(
      await db.rpc("abs_verify_rows", {
        _accession: AMEND,
        _kind: "cmbs_assets",
        _rows: [{ ...assets[0], original_loan_amount: "30000000" }],
      }),
    ).toBe(0);
    expect(
      await db.rpc("abs_verify_rows", {
        _accession: AMEND,
        _kind: "cmbs_assets",
        _rows: [{ ...assets[0], original_loan_amount: "30000000.01" }, assets[1]],
      }),
    ).toBe(1);
    expect(
      await db.rpc("abs_verify_rows", {
        _accession: AMEND,
        _kind: "cmbs_assets",
        _rows: [{ ...assets[0], extra: {} }],
      }),
    ).toBe(1);
    await expect(
      db.rpc("abs_verify_rows", {
        _accession: "0009999999-24-000001",
        _kind: "cmbs_assets",
        _rows: [],
      }),
    ).rejects.toThrow(/is not loaded/);
  });

  it("hands the scheduled job one waiting filing at a time, least tried first, and counts the attempt before any work", async () => {
    const J1 = "0001888524-25-000001";
    const J2 = "0001888524-25-000002";
    const OTHER = "0000000777-25-000001";
    await db.rpc("abs_register_filings", {
      _rows: [
        {
          accession: J1,
          list_cik: 2017898,
          form: "ABS-EE",
          filed: "2025-01-20",
          accepted_at: "2025-01-20T15:00:00Z",
        },
        {
          accession: J2,
          list_cik: 2017898,
          form: "ABS-EE",
          filed: "2025-02-20",
          accepted_at: "2025-02-20T15:00:00Z",
        },
        {
          accession: OTHER,
          list_cik: 777,
          form: "ABS-EE",
          filed: "2025-01-05",
          accepted_at: "2025-01-05T15:00:00Z",
        },
      ],
    });
    const claim = (watch: unknown[], max = 3) =>
      db.rpc<{ accession: string; list_cik: number; attempt: number } | null>("abs_claim_next", {
        _watch: watch,
        _max_attempts: max,
      });
    // only watched CIKs, and only from the day wanted
    expect(await claim([{ cik: 999, from: null }])).toBeNull();
    expect(await claim([{ cik: 2017898, from: "2025-03-01" }])).toBeNull();
    expect(await claim([{ cik: 2017898, from: "2025-02-01" }])).toMatchObject({
      accession: J2,
      list_cik: 2017898,
      attempt: 1,
    });
    expect(
      (await rows(`select status, attempts from abs_filings where accession = '${J2}'`))[0],
    ).toEqual({ status: "failed", attempts: 1 });
    // a filing nobody tried yet goes before one that was tried
    expect(await claim([{ cik: 2017898, from: "2025-01-01" }])).toMatchObject({
      accession: J1,
      attempt: 1,
    });
    expect(await claim([{ cik: 2017898, from: "2025-01-01" }])).toMatchObject({
      accession: J1,
      attempt: 2,
    });
    expect(await claim([{ cik: 2017898, from: "2025-01-01" }])).toMatchObject({
      accession: J2,
      attempt: 2,
    });
    // SEC was down for that attempt: it is given back
    await db.rpc("abs_release_filing", {
      _accession: J2,
      _detail: "SEC answered 503; not counted as an attempt",
    });
    expect(
      (await rows(`select status, attempts from abs_filings where accession = '${J2}'`))[0],
    ).toEqual({ status: "listed", attempts: 1 });
    // after the last allowed attempt a filing is left alone
    for (const want of [J2, J1, J2])
      expect(await claim([{ cik: 2017898, from: "2025-01-01" }])).toMatchObject({
        accession: want,
      });
    expect(await claim([{ cik: 2017898, from: "2025-01-01" }])).toBeNull();
    expect(
      await rows(
        `select accession, status, attempts from abs_filings where accession in ('${J1}', '${J2}') order by 1`,
      ),
    ).toEqual([
      { accession: J1, status: "failed", attempts: 3 },
      { accession: J2, status: "failed", attempts: 3 },
    ]);
    // releasing never touches a stored filing
    await db.rpc("abs_release_filing", { _accession: A, _detail: "x" });
    expect(await one(`select status from abs_filings where accession = '${A}'`)).toBe("loaded");
    await checkClean();
  });

  it("stores a whole filing in one call, all or nothing, and does nothing the second time", async () => {
    const J1 = "0001888524-25-000001";
    const args = (rowsArg: unknown) => ({
      _accession: J1,
      _parser: "abs-1",
      _sha256: "c".repeat(64),
      _bytes: 22391,
      _filing: facts({
        period_start: "2024-12-18",
        period_end: "2025-01-17",
        accepted_at: "2025-01-20 10:00:00 America/New_York",
      }),
      _documents: DOCS,
      _rows: rowsArg,
      _expect: EXPECT,
    });
    const before = await db.rpc<Record<string, unknown>>("abs_summary");
    // rows that do not add up: the whole call is undone, including the load it opened
    await expect(
      db.rpc(
        "abs_store_filing",
        args({ cmbs_assets: assets.slice(0, 3), cmbs_properties: properties, metrics }),
      ),
    ).rejects.toThrow(/holds .* but the reader counted/);
    await expect(
      db.rpc(
        "abs_store_filing",
        args({ cmbs_assets: [{ ...assets[0], nope: 1 }], cmbs_properties: [], metrics: [] }),
      ),
    ).rejects.toThrow(/has no column "nope"/);
    expect(await db.rpc("abs_summary")).toEqual(before);
    expect(await one(`select count(*)::int from abs_loads where accession = '${J1}'`)).toBe(0);
    const done = await db.rpc<{ skip: boolean; current: boolean; counts: Record<string, number> }>(
      "abs_store_filing",
      args({ cmbs_assets: assets, cmbs_properties: properties, metrics }),
    );
    expect(done).toMatchObject({
      skip: false,
      current: true,
      counts: { cmbs_assets: 6, cmbs_properties: 6 },
    });
    expect(
      (
        await rows(
          `select status, status_detail, attempts from abs_filings where accession = '${J1}'`,
        )
      )[0],
    ).toEqual({
      status: "loaded",
      status_detail: null,
      attempts: 3,
    });
    expect(
      await one(`select count(*)::int from abs_cmbs_assets_live where accession = '${J1}'`),
    ).toBe(6);
    const again = await db.rpc<{ skip: boolean }>(
      "abs_store_filing",
      args({ cmbs_assets: assets, cmbs_properties: properties, metrics }),
    );
    expect(again.skip).toBe(true);
    expect(await one(`select count(*)::int from abs_loads where accession = '${J1}'`)).toBe(1);
    await checkClean();
  });

  it("can be applied again over a store that holds data, without error and without changing a row", async () => {
    const digest = () =>
      one(`select md5(string_agg(d, '|' order by t)) from (
        select 'a' t, md5(string_agg(x::text || xmin::text, ',' order by load_id, rec)) d from abs_cmbs_assets x
        union all select 'f', md5(string_agg(x::text || xmin::text, ',' order by accession)) from abs_filings x
        union all select 'l', md5(string_agg(x::text || xmin::text, ',' order by load_id)) from abs_loads x) s`);
    const before = await digest();
    await admin.unsafe(readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8"));
    expect(await digest()).toBe(before);
    await checkClean();
    expect(
      await db.rpc("abs_verify_rows", { _accession: AMEND, _kind: "cmbs_assets", _rows: assets }),
    ).toBe(0);
  });

  it("lets members read and nobody but the service role write or run the functions", async () => {
    const as = async <T>(role: string, uid: string | null, q: string) =>
      admin.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        if (uid) await tx.unsafe(`set local request.jwt.claim.sub = '${uid}'`);
        return (await tx.unsafe(q)) as unknown as T;
      });
    expect(
      (
        await as<{ n: number }[]>(
          "authenticated",
          MEMBER,
          "select count(*)::int n from abs_cmbs_assets_live",
        )
      )[0].n,
    ).toBeGreaterThan(0);
    expect(
      (
        await as<{ n: number }[]>(
          "authenticated",
          MEMBER,
          "select count(*)::int n from abs_filings",
        )
      )[0].n,
    ).toBe(7);
    // signed in without app access: row security shows nothing
    expect(
      (
        await as<{ n: number }[]>(
          "authenticated",
          "00000000-0000-0000-0000-0000000000bb",
          "select count(*)::int n from abs_cmbs_assets_live",
        )
      )[0].n,
    ).toBe(0);
    expect(
      (
        await as<{ n: number }[]>(
          "authenticated",
          "00000000-0000-0000-0000-0000000000bb",
          "select count(*)::int n from abs_deals",
        )
      )[0].n,
    ).toBe(0);
    for (const q of [
      "select count(*) from abs_loads",
      "insert into abs_deals (deal_id, issuer_name, family) values ('x', 'x', 'cmbs')",
      "update abs_cmbs_assets set original_loan_amount = 0",
      "delete from abs_filings",
      "select abs_summary()",
      "select * from abs_check()",
      `select abs_begin_load('${A}', 'p', '${SHA}', 1, true)`,
      `select abs_mark_filing('${A}', 'failed', 'x')`,
      "select * from abs_rows_metrics(1, 'x', '[]'::jsonb)",
    ])
      await expect(as("authenticated", MEMBER, q), q).rejects.toThrow(/permission denied/);
    for (const q of [
      "select count(*) from abs_deals",
      "select count(*) from abs_cmbs_assets_live",
      "select abs_summary()",
    ])
      await expect(as("anon", null, q), q).rejects.toThrow(/permission denied/);
  });

  it("ends with every invariant holding and totals that match what was stored", async () => {
    await checkClean();
    const s = await db.rpc<Record<string, unknown>>("abs_summary");
    expect(s).toMatchObject({
      deals: 1,
      filings: { loaded: 5, failed: 1, listed: 1 },
      current: 3,
      superseded: 2,
      cmbs_assets: 30,
      cmbs_properties: 30,
      metrics: 5 * metrics.length,
    });
    // one open load is left from the refusal test; nothing of it is visible
    expect((s.loads as Record<string, number>).committed).toBe(5);
    expect(
      await one(
        "select count(*)::int from abs_cmbs_assets a join abs_loads l using (load_id) where l.status = 'open'",
      ),
    ).toBe(0);
  });
});
