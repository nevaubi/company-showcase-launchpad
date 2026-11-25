import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTO_FIELDS,
  autoCollector,
  delinquencyBucket,
  quantile,
  scoreBand,
  type AutoFamily,
} from "./auto";
import { fileSink, filingPayload, planFiling, READS } from "./filing";
import { BLANK, METRICS, PARSER, type MetricRow } from "./metrics";
import { createAbsReader, readAbsText, type AbsRecord } from "./xml";

const FIX = "src/test/fixtures/abs/";
const LOAN = readFileSync(`${FIX}autoloan-ex102-excerpt.xml`, "utf8");
const LEASE = readFileSync(`${FIX}autolease-ex102-excerpt.xml`, "utf8");
// computed from the same two excerpts by another program (Python, Decimal); see the fixtures' README
const EXPECTED = JSON.parse(readFileSync(`${FIX}auto-excerpt-figures.json`, "utf8"));

type Total = { sum: string | null; n: number };
type Split = Record<string, [number, string | null]>;

function figures(xml: string, family: AutoFamily) {
  const { shape, records } = readAbsText(xml);
  const c = autoCollector(family);
  for (const r of records) c.add(r);
  return { shape, rows: c.metrics() };
}
const pick = (rows: MetricRow[], metric: string, dim = "", bucket = "") =>
  rows.find((r) => r.metric === metric && r.dim === dim && r.bucket === bucket);
/** numeric text compared as a number written out exactly, so "39" equals "39.0000" */
const same = (a: string | null | undefined, b: string | null) =>
  a == null || b == null
    ? a == null && b == null
    : Number(a) === Number(b) && trimmed(a) === trimmed(b);
const trimmed = (t: string) => (t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t);

const record = (rec: number, fields: [string, string][]): AbsRecord => ({
  rec,
  tag: "assets",
  fields,
  blocks: [],
});
const loan = (rec: number, o: Record<string, string | undefined>): AbsRecord =>
  record(
    rec,
    Object.entries({
      assetNumber: `n${rec}`,
      reportingPeriodEndingDate: "09-30-2026",
      originalLoanAmount: "20000.00",
      reportingPeriodBeginningLoanBalanceAmount: "10500.00",
      reportingPeriodActualEndBalanceAmount: "10000.00",
      originalInterestRatePercentage: "0.05",
      obligorCreditScore: "700",
      obligorGeographicLocation: "TX",
      originalLoanTerm: "72",
      remainingTermToMaturityNumber: "40",
      currentDelinquencyStatus: "0",
      vehicleNewUsedCode: "1",
      vehicleManufacturerName: "FORD",
      paymentToIncomePercentage: "0.08",
      ...o,
    }).filter((e): e is [string, string] => e[1] !== undefined),
  );
const run = (family: AutoFamily, records: AbsRecord[]) => {
  const c = autoCollector(family);
  for (const r of records) c.add(r);
  return c.metrics();
};

function checkAgainst(rows: MetricRow[], family: AutoFamily, e: Record<string, unknown>) {
  const K =
    family === "auto_loan"
      ? { original: "original_balance", begin: "begin_balance", end: "end_balance" }
      : {
          original: "acquisition_cost",
          begin: "begin_securitization_value",
          end: "end_securitization_value",
        };
  const total = (metric: string, t: Total) => {
    const r = pick(rows, metric);
    expect(r, metric).toBeDefined();
    expect(same(r!.value, t.sum), `${metric}: ${r!.value} against ${t.sum}`).toBe(true);
    expect(r!.n, `${metric} n`).toBe(t.n);
  };
  expect(pick(rows, "records")).toMatchObject({
    value: String(e.records),
    n: e.records,
    n_missing: 0,
  });
  total(K.original, e.original as Total);
  total(K.begin, e.begin as Total);
  total(K.end, e.end as Total);
  total("charge_offs", e.charge_offs as Total);
  if (family === "auto_loan") total("recoveries", e.recoveries as Total);
  else {
    total("base_residual_active", e.base_residual_active as Total);
    total("contract_residual_active", e.contract_residual_active as Total);
  }
  for (const m of [
    "wa_original_rate",
    "wa_credit_score",
    "wa_original_term",
    "wa_remaining_term",
  ]) {
    const want = e[m] as { value: string | null; n: number } | undefined;
    const got = pick(rows, m);
    if (!want) {
      expect(got, m).toBeUndefined();
      continue;
    }
    expect(same(got!.value, want.value), `${m}: ${got!.value} against ${want.value}`).toBe(true);
    expect(got!.n, `${m} n`).toBe(want.n);
    expect(got!.n_missing, `${m} n_missing`).toBe((e.positive as number) - want.n);
  }
  for (const dim of [
    "delinquency",
    "score_band",
    "state",
    "new_used",
    "zero_balance_code",
    "make",
  ]) {
    const want = e[dim] as Split;
    const got = rows.filter((r) => r.dim === dim && r.metric === "records");
    expect(got.map((r) => r.bucket).sort(), dim).toEqual(Object.keys(want).sort());
    for (const [bucket, [n, amount]] of Object.entries(want)) {
      expect(pick(rows, "records", dim, bucket)!.n, `${dim} ${bucket}`).toBe(n);
      const end = pick(rows, K.end, dim, bucket)!;
      expect(same(end.value, amount), `${dim} ${bucket}: ${end.value} against ${amount}`).toBe(
        true,
      );
    }
  }
  const p = e.pti as Record<string, string | number | null>;
  for (const b of ["p25", "p50", "p75", "p99", "max"]) {
    const r = pick(rows, "payment_to_income", "quantile", b)!;
    expect(same(r.value, p[b] as string | null), `payment to income ${b}`).toBe(true);
    expect(r.n).toBe(p.n);
  }
  expect(pick(rows, "payment_to_income_over_one")).toMatchObject({
    value: String(p.over_one),
    n: p.n,
  });
}

describe("abs auto loan and lease figures", () => {
  it("bands a credit score only when it is a number from 300 to 900", () => {
    expect(scoreBand(undefined)).toBe(BLANK);
    expect(scoreBand("619")).toBe("under 620");
    expect(scoreBand("620")).toBe("620 to 659");
    expect(scoreBand(" 660 ")).toBe("660 to 719");
    expect(scoreBand("720.5")).toBe("720 and over");
    expect(scoreBand("900")).toBe("720 and over");
    // placeholders and other kinds of score are not a consumer score in this range
    for (const t of ["0", "299", "901", "9999", "None", "NONE", "No Score", "", "7 2 0"])
      expect(scoreBand(t), t).toBe("no valid score");
  });

  it("buckets days past due as the file states them", () => {
    expect(delinquencyBucket(undefined)).toBe(BLANK);
    expect(delinquencyBucket("0")).toBe("current");
    expect(delinquencyBucket("1")).toBe("1 to 29 days");
    expect(delinquencyBucket("29")).toBe("1 to 29 days");
    expect(delinquencyBucket("30")).toBe("30 to 59 days");
    expect(delinquencyBucket("60")).toBe("60 to 89 days");
    expect(delinquencyBucket("90")).toBe("90 to 119 days");
    expect(delinquencyBucket("120")).toBe("120 days or more");
    expect(delinquencyBucket("1939")).toBe("120 days or more");
    expect(delinquencyBucket("3A")).toBe("unreadable");
    expect(delinquencyBucket("-1")).toBe("unreadable");
  });

  it("takes a quantile by nearest rank, so it is always a value the file states", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile(["0.1"], 0.25)).toBe("0.1");
    const ten = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    expect(quantile(ten, 0.25)).toBe("3");
    expect(quantile(ten, 0.5)).toBe("5");
    expect(quantile(ten, 0.99)).toBe("10");
    expect(quantile(ten, 1)).toBe("10");
  });

  it("gives the figures another program computes from a real auto loan excerpt", () => {
    const { shape, rows } = figures(LOAN, "auto_loan");
    expect(shape).toMatchObject({ family: "auto_loan", records: 10, attributes: 0 });
    checkAgainst(rows, "auto_loan", EXPECTED.loan);
    // spelled out once, so the fixture's own numbers are in view
    expect(pick(rows, "end_balance")).toMatchObject({
      value: "189743.99",
      unit: "usd",
      n: 10,
      n_missing: 0,
    });
    expect(pick(rows, "charge_offs")).toMatchObject({ value: "709.78", n: 1, n_missing: 9 });
    expect(pick(rows, "wa_credit_score")).toMatchObject({
      value: "766.3488",
      unit: "score",
      n: 6,
      n_missing: 1,
    });
    expect(pick(rows, "records", "period_end", "2026-09-30")).toMatchObject({ n: 10 });
    expect(pick(rows, "payment_to_income_over_one")).toMatchObject({
      value: "1",
      n: 9,
      n_missing: 1,
    });
  });

  it("gives the figures another program computes from a real auto lease excerpt", () => {
    const { shape, rows } = figures(LEASE, "auto_lease");
    expect(shape).toMatchObject({ family: "auto_lease", records: 7, attributes: 0 });
    checkAgainst(rows, "auto_lease", EXPECTED.lease);
    expect(pick(rows, "end_securitization_value")).toMatchObject({ value: "313482.51", n: 7 });
    expect(pick(rows, "base_residual_active")).toMatchObject({
      value: "189805",
      n: 4,
      n_missing: 0,
    });
    // a lease file has no interest rate and no recoveries: those figures are not written at all
    expect(pick(rows, "wa_original_rate")).toBeUndefined();
    expect(pick(rows, "recoveries")).toBeUndefined();
  });

  it("counts a missing amount as missing, never as zero", () => {
    const rows = run("auto_loan", [
      loan(1, {}),
      loan(2, {
        reportingPeriodActualEndBalanceAmount: undefined,
        currentDelinquencyStatus: undefined,
      }),
      loan(3, { reportingPeriodActualEndBalanceAmount: "0.00" }),
    ]);
    expect(pick(rows, "end_balance")).toMatchObject({ value: "10000", n: 2, n_missing: 1 });
    expect(pick(rows, "original_balance")).toMatchObject({ value: "60000", n: 3, n_missing: 0 });
    // the record without an end balance is in its bucket, with no amount behind it
    expect(pick(rows, "records", "delinquency", BLANK)).toMatchObject({ n: 1 });
    expect(pick(rows, "end_balance", "delinquency", BLANK)).toMatchObject({
      value: null,
      n: 0,
      n_missing: 1,
    });
    // averages rest on the one record with a balance above zero
    expect(pick(rows, "wa_original_term")).toMatchObject({ value: "72", n: 1, n_missing: 0 });
  });

  it("leaves every figure empty for a file whose records state nothing it reads", () => {
    const rows = run("auto_lease", [record(1, [["assetNumber", "x"]])]);
    expect(pick(rows, "records")).toMatchObject({ value: "1", n: 1 });
    for (const m of [
      "acquisition_cost",
      "end_securitization_value",
      "charge_offs",
      "wa_credit_score",
    ])
      expect(pick(rows, m), m).toMatchObject({ value: null, n: 0 });
    expect(pick(rows, "payment_to_income", "quantile", "p50")).toMatchObject({
      value: null,
      n: 0,
      n_missing: 1,
    });
    expect(pick(rows, "records", "period_end", BLANK)).toMatchObject({ n: 1 });
  });

  it("reads padded numbers, keeps negative amounts, and weighs only balances above zero", () => {
    const rows = run("auto_loan", [
      loan(1, {
        originalInterestRatePercentage: " 000000000000.04890000",
        reportingPeriodActualEndBalanceAmount: "30000.00",
      }),
      loan(2, {
        originalInterestRatePercentage: "0.10",
        reportingPeriodActualEndBalanceAmount: "10000.00",
      }),
      loan(3, {
        originalInterestRatePercentage: "0.25",
        reportingPeriodActualEndBalanceAmount: "-3651.31",
        chargedoffPrincipalAmount: "-45.33",
      }),
    ]);
    expect(pick(rows, "end_balance")).toMatchObject({ value: "36348.69", n: 3 });
    expect(pick(rows, "charge_offs")).toMatchObject({ value: "-45.33", n: 1, n_missing: 2 });
    // (0.0489 x 30000 + 0.10 x 10000) / 40000; the negative balance carries no weight
    expect(pick(rows, "wa_original_rate")).toMatchObject({
      value: "0.061675",
      unit: "as_filed",
      n: 2,
      n_missing: 0,
    });
  });

  it("does not put two scales of payment-to-income on one footing", () => {
    // a filer that writes percent points: every value is above 1, and none is divided by 100
    const points = run("auto_loan", [
      loan(1, { paymentToIncomePercentage: "8.73" }),
      loan(2, { paymentToIncomePercentage: "11.02" }),
      loan(3, { paymentToIncomePercentage: "None" }),
    ]);
    expect(pick(points, "payment_to_income", "quantile", "p50")).toMatchObject({
      value: "8.73",
      unit: "as_filed",
      n: 2,
      n_missing: 1,
    });
    expect(pick(points, "payment_to_income", "quantile", "max")).toMatchObject({ value: "11.02" });
    expect(pick(points, "payment_to_income_over_one")).toMatchObject({ value: "2", n: 2 });
    expect(METRICS.payment_to_income.what).toMatch(/no average is stored/);
  });

  it("groups state and make by their trimmed upper-case text and nothing more", () => {
    const rows = run("auto_loan", [
      loan(1, { obligorGeographicLocation: "ct", vehicleManufacturerName: "Chevrolet " }),
      loan(2, { obligorGeographicLocation: "CT ", vehicleManufacturerName: "CHEVROLET" }),
      loan(3, { obligorGeographicLocation: undefined, vehicleManufacturerName: "CHEVY" }),
    ]);
    expect(pick(rows, "records", "state", "CT")).toMatchObject({ n: 2 });
    expect(pick(rows, "records", "state", BLANK)).toMatchObject({ n: 1 });
    expect(pick(rows, "records", "make", "CHEVROLET")).toMatchObject({ n: 2 });
    // spelling variants are not merged
    expect(pick(rows, "records", "make", "CHEVY")).toMatchObject({ n: 1 });
  });

  it("reads the first value of a repeated element", () => {
    const r = loan(1, {});
    r.fields.push(["obligorCreditScore", "500"], ["reportingPeriodActualEndBalanceAmount", "1.00"]);
    const rows = run("auto_loan", [r]);
    expect(pick(rows, "end_balance")).toMatchObject({ value: "10000", n: 1 });
    expect(pick(rows, "records", "score_band", "660 to 719")).toMatchObject({ n: 1 });
  });

  it("writes each figure once, under a definition, with the unit of that definition", () => {
    for (const [family, xml] of [
      ["auto_loan", LOAN],
      ["auto_lease", LEASE],
    ] as const) {
      const { rows } = figures(xml, family);
      const keys = rows.map((r) => `${r.metric}|${r.dim}|${r.bucket}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const r of rows) {
        const def = METRICS[r.metric];
        expect(def, r.metric).toBeDefined();
        expect(
          (def.families as readonly string[]).includes(family),
          `${r.metric} for ${family}`,
        ).toBe(true);
        expect(r.unit).toBe(def.unit);
        expect(r.n).toBeGreaterThanOrEqual(0);
        expect(r.n_missing).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("names, for each family, only elements the real files carry", () => {
    for (const [family, xml] of [
      ["auto_loan", LOAN],
      ["auto_lease", LEASE],
    ] as const) {
      const seen = new Set(readAbsText(xml).records.flatMap((r) => r.fields.map((f) => f[0])));
      for (const [what, element] of Object.entries(AUTO_FIELDS[family]))
        if (element) expect(seen.has(element), `${family} ${what}: ${element}`).toBe(true);
    }
  });
});

describe("abs filing: an auto file becomes pool figures, not rows", () => {
  const A = "0001104659-26-119913";
  const HEADER = readFileSync(`${FIX}autoloan.hdr.sgml`, "utf8");
  const INDEX = readFileSync(`${FIX}autoloan-index.htm`, "utf8");

  it("plans the filing: the trust is the deal, the EX-102 is the file, whatever its size", () => {
    expect(READS.has("auto_loan") && READS.has("auto_lease") && READS.has("cmbs")).toBe(true);
    const plan = planFiling(A, HEADER, "h", INDEX);
    if (plan.skip !== undefined) throw new Error(plan.skip);
    expect(plan.deal).toMatchObject({
      deal_id: "0002140699",
      issuer_name: "World Omni Select Auto Trust 2026-A",
      file_number: "333-283578-07",
    });
    expect(plan.header).toMatchObject({
      assetClasses: ["Auto loans"],
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      depositorCik: 1083199,
    });
    expect(plan.file).toMatchObject({ doc_type: "EX-102", listed_bytes: 79876850 });
    expect(plan.file.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1083199/000110465926119913/wosat2026aex102sep26.xml",
    );
  });

  it("stores figures and the file's evidence, and no asset rows", () => {
    const plan = planFiling(A, HEADER, "h", INDEX);
    if (plan.skip !== undefined) throw new Error(plan.skip);
    const sink = fileSink();
    const reader = createAbsReader((r) => sink.add(r, reader.shape().family));
    // any chunking gives the same result: the script streams a file of tens of megabytes
    for (let i = 0; i < LOAN.length; i += 4096) reader.write(LOAN.slice(i, i + 4096));
    const p = filingPayload(
      plan,
      reader.close(),
      { bytes: 36546, sha256: "s", retrievedAt: "2026-11-25T00:00:00Z" },
      sink,
      0,
    );
    if (p.skip !== undefined) throw new Error(p.skip);
    expect(p.filing).toMatchObject({
      deal_id: "0002140699",
      family: "auto_loan",
      asset_class: "Auto loans",
      period_end: "2026-09-30",
    });
    expect(p.rows.cmbs_assets).toEqual([]);
    expect(p.rows.cmbs_properties).toEqual([]);
    expect(p.rows.metrics).toEqual(figures(LOAN, "auto_loan").rows);
    expect(p.counts).toMatchObject({
      cmbs_assets: 0,
      cmbs_properties: 0,
      metrics: p.rows.metrics.length,
      records: 10,
      attributes: 0,
      decode_replacements: 0,
    });
    expect(p.documents.find((d) => d.doc_type === "EX-102")).toMatchObject({
      bytes: 36546,
      sha256: "s",
      records: 10,
      namespace: "http://www.sec.gov/edgar/document/absee/autoloan/assetdata",
    });
  });

  it("goes by the file's own namespace, not by the header's label", () => {
    // the same header in front of a lease file: the file decides
    const plan = planFiling(A, HEADER, "h", INDEX);
    if (plan.skip !== undefined) throw new Error(plan.skip);
    const sink = fileSink();
    const reader = createAbsReader((r) => sink.add(r, reader.shape().family));
    reader.write(LEASE);
    const p = filingPayload(
      plan,
      reader.close(),
      { bytes: 1, sha256: "s", retrievedAt: "t" },
      sink,
      0,
    );
    if (p.skip !== undefined) throw new Error(p.skip);
    expect(p.filing.family).toBe("auto_lease");
    expect(p.rows.metrics.some((m) => m.metric === "end_securitization_value")).toBe(true);
    expect(p.rows.metrics.some((m) => m.metric === "end_balance")).toBe(false);
  });

  it("still refuses a class it has no reader for, by name", () => {
    const plan = planFiling(A, HEADER, "h", INDEX);
    if (plan.skip !== undefined) throw new Error(plan.skip);
    const other = LOAN.replace("absee/autoloan/assetdata", "absee/rmbs/assetdata");
    const sink = fileSink();
    const reader = createAbsReader((r) => sink.add(r, reader.shape().family));
    reader.write(other);
    const p = filingPayload(
      plan,
      reader.close(),
      { bytes: 1, sha256: "s", retrievedAt: "t" },
      sink,
      0,
    );
    expect(p.skip).toMatch(new RegExp(`^unsupported: .*rmbs.* are not read by ${PARSER}$`));
  });
});
