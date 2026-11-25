/** Official exchange monthly revenue. All financial values stay JSON strings. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OFFICIAL_USER_AGENT } from "../../src/lib/sources/refresh-plan";
import type { SourceColumn, SourceIngest, SourceJson } from "../../src/lib/sources/schema";

export type TaiwanRevenueMarket = "TWSE" | "TPEX";
export const TAIWAN_REVENUE_FIELDS = [
  "出表日期",
  "資料年月",
  "公司代號",
  "公司名稱",
  "產業別",
  "營業收入-當月營收",
  "營業收入-上月營收",
  "營業收入-去年當月營收",
  "營業收入-上月比較增減(%)",
  "營業收入-去年同月增減(%)",
  "累計營業收入-當月累計營收",
  "累計營業收入-去年累計營收",
  "累計營業收入-前期比較增減(%)",
  "備註",
] as const;
const CALENDAR_REFERENCE = "https://www.ris.gov.tw/documents/html/8/1/219.html";
const SOURCES = {
  TWSE: {
    url: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
    specification: "https://openapi.twse.com.tw/v1/swagger.json",
    path: "/opendata/t187ap05_L",
  },
  TPEX: {
    url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O",
    specification: "https://www.tpex.org.tw/openapi/swagger.json",
    path: "/mopsfin_t187ap05_O",
  },
} as const;

export const TAIWAN_REVENUE_DATASETS = Object.fromEntries(
  (["TWSE", "TPEX"] as const).map((market) => [
    market,
    {
      id: `official_${market.toLowerCase()}_monthly_revenue_native_current`,
      name: `${market === "TPEX" ? "TPEx" : market} · Reported monthly revenue · All industries`,
      sector: "00_universal",
      agency: market === "TPEX" ? "Taipei Exchange" : "Taiwan Stock Exchange",
      source_id: `${market}_MONTHLY`,
      source_url: SOURCES[market].url,
      description: `Reported monthly revenue: every returned issuer row and all 14 native Chinese fields from the official ${market} endpoint. All returned industries are included, separately from historical technology subsets. Exchange population completeness is not independently established.`,
      grain: "Exchange-listed issuer × reported month",
      units:
        "Exact reported strings. Percentages are explicitly labeled in source headers; currency and monetary scale are not stated in this JSON schema.",
      notes:
        "Issuer identity uses the native company code within this exchange only. No parent, ADR, or US-company mapping is inferred. Original ROC month and table dates remain in native fields. The Gregorian search index adds 1911 to the ROC year using the Taiwan Ministry of the Interior calendar table; no financial value is converted. All returned industries are included. The endpoint has no pagination or independent total-count field, so coverage describes the complete returned array rather than asserting every eligible issuer has filed.",
      latest_snapshot_id: null,
    },
  ]),
) as Record<
  TaiwanRevenueMarket,
  {
    id: string;
    name: string;
    sector: string;
    agency: string;
    source_id: string;
    source_url: string;
    description: string;
    grain: string;
    units: string;
    notes: string;
    latest_snapshot_id: null;
  }
>;

export type TaiwanRevenueParsed = {
  rows: string[][];
  companyCodes: string[];
  nativePeriod: string;
  period: string;
  nativeReportDates: string[];
  emptyCounts: number[];
};
export type CollectTaiwanRevenueInput = {
  market: TaiwanRevenueMarket;
  workDir: string;
  signal: AbortSignal;
  /** Defaults to the most recent completed month in Asia/Taipei; old feeds fail closed. */
  expectedPeriod?: string;
  previousCompanyCodes?: string[];
};
export type CollectTaiwanRevenueResult = {
  filePath: string;
  retrievedAt: string;
  rows: number;
  columns: SourceColumn[];
  ingest: SourceIngest;
  nativePeriod: string;
  period: string;
  coverage: Record<string, SourceJson>;
  provenance: Record<string, SourceJson>;
  supportingFiles: {
    filePath: string;
    contentType: string;
    provenance: Record<string, SourceJson>;
  }[];
  provenancePath: string;
};

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/**
 * Strict subset of JSON: array of objects whose keys and values are strings.
 * Numeric tokens are rejected before JSON.parse ever sees them. Duplicate keys
 * also fail instead of overwriting a publisher's value. JSON.parse is used only
 * to decode a single validated string token's escapes.
 */
export function parseStringRecordArray(text: string): Record<string, string>[] {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(text[i] ?? "x")) i++;
  };
  const punctuation = (expected: string) => {
    whitespace();
    if (text[i] !== expected) throw new Error(`Expected JSON ${expected} at offset ${i}`);
    i++;
  };
  const string = (): string => {
    whitespace();
    if (text[i] !== '"')
      throw new Error(`Native JSON must contain string values only at offset ${i}`);
    const start = i++;
    for (;;) {
      if (i >= text.length) throw new Error("Unterminated native JSON string");
      const char = text[i++];
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === '"') break;
    }
    const value: unknown = JSON.parse(text.slice(start, i));
    if (typeof value !== "string") throw new Error("Native JSON value is not a string");
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
      throw new Error("Invalid Unicode surrogate in native JSON string");
    return value;
  };
  const rows: Record<string, string>[] = [];
  punctuation("[");
  whitespace();
  if (text[i] !== "]")
    for (;;) {
      punctuation("{");
      whitespace();
      const row: Record<string, string> = Object.create(null);
      if (text[i] !== "}")
        for (;;) {
          const key = string();
          if (Object.hasOwn(row, key)) throw new Error(`Duplicate native JSON property ${key}`);
          punctuation(":");
          row[key] = string();
          whitespace();
          if (text[i] !== ",") break;
          i++;
        }
      punctuation("}");
      rows.push(row);
      if (rows.length > 25_000)
        throw new Error("Native revenue response exceeds the reviewed row bound");
      whitespace();
      if (text[i] !== ",") break;
      i++;
    }
  punctuation("]");
  whitespace();
  if (i !== text.length) throw new Error("Trailing content after the native JSON array");
  return rows;
}

export function rocMonthToGregorian(value: string): string {
  const match = /^(\d{3})(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) < 1) throw new Error("Invalid native ROC year/month");
  // Only the calendar year is parsed. No financial field enters this path.
  return `${Number(match[1]) + 1911}-${match[2]}`;
}
function rocDateToGregorian(value: string): string {
  const match = /^(\d{3})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match || Number(match[1]) < 1) throw new Error("Invalid native ROC table date");
  const year = Number(match[1]) + 1911;
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3])));
  const result = `${year}-${match[2]}-${match[3]}`;
  if (date.toISOString().slice(0, 10) !== result)
    throw new Error("Invalid native ROC calendar date");
  return result;
}
export function lastClosedTaipeiMonth(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid retrieval time");
  const taipei = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

export function parseTaiwanRevenue(
  text: string,
  options: { expectedPeriod: string; asOfDate: string },
): TaiwanRevenueParsed {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.expectedPeriod))
    throw new Error("A valid expected reporting period is required");
  const records = parseStringRecordArray(text);
  if (!records.length) throw new Error("An empty revenue population cannot be published");
  const fields = new Set<string>(TAIWAN_REVENUE_FIELDS);
  const keys = new Set<string>();
  const companyCodes: string[] = [];
  const reportDates = new Set<string>();
  let nativePeriod = "";
  const emptyCounts = Array(TAIWAN_REVENUE_FIELDS.length).fill(0) as number[];
  const rows = records.map((row, index) => {
    const missing = TAIWAN_REVENUE_FIELDS.filter((field) => !Object.hasOwn(row, field));
    if (missing.length)
      throw new Error(`Native row ${index + 1} omitted required fields: ${missing.join(", ")}`);
    const unexpected = Object.keys(row).filter((field) => !fields.has(field));
    if (unexpected.length)
      throw new Error(`Unexpected native schema fields: ${unexpected.join(", ")}`);
    const period = rocMonthToGregorian(row["資料年月"]);
    if (period !== options.expectedPeriod)
      throw new Error(
        `Unexpected or mixed native reporting period ${row["資料年月"]}; expected ${options.expectedPeriod}`,
      );
    if (nativePeriod && nativePeriod !== row["資料年月"])
      throw new Error("Mixed native ROC reporting periods");
    nativePeriod = row["資料年月"];
    const code = row["公司代號"];
    if (!/^\d{4,6}$/.test(code))
      throw new Error(`Unrecognized native issuer code in row ${index + 1}`);
    if (!row["公司名稱"].trim()) throw new Error(`Missing native issuer name in row ${index + 1}`);
    const key = `${code}:${nativePeriod}`;
    if (keys.has(key)) throw new Error(`Duplicate native company + reported-month identity ${key}`);
    keys.add(key);
    companyCodes.push(code);
    const tableDate = rocDateToGregorian(row["出表日期"]);
    if (tableDate > options.asOfDate) throw new Error("Native table date is in the future");
    if (tableDate.slice(0, 7) <= period)
      throw new Error("Native table date does not follow the completed reporting month");
    reportDates.add(row["出表日期"]);
    return TAIWAN_REVENUE_FIELDS.map((field, position) => {
      if (row[field] === "") emptyCounts[position]++;
      return row[field];
    });
  });
  return {
    rows,
    companyCodes,
    nativePeriod,
    period: options.expectedPeriod,
    nativeReportDates: [...reportDates].sort(),
    emptyCounts,
  };
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} is not an object`);
  return value as Record<string, any>;
}
/** The current official specifications declare every native revenue field a string. */
export function validateTaiwanRevenueSchema(market: TaiwanRevenueMarket, value: unknown): void {
  const spec = record(value, "Official specification");
  const path = record(
    record(spec.paths, "Official paths")[SOURCES[market].path],
    "Official revenue path",
  );
  const operation = record(path.get, "Official revenue operation");
  if (
    (Array.isArray(operation.parameters) && operation.parameters.length) ||
    (Array.isArray(path.parameters) && path.parameters.length)
  )
    throw new Error("Revenue endpoint parameters/pagination changed; review required");
  const response = record(
    record(operation.responses, "Official responses")["200"],
    "Official success response",
  );
  const schema =
    market === "TWSE"
      ? record(response.schema, "Official native schema")
      : record(
          record(
            record(spec.components, "Official components").schemas,
            "Official component schemas",
          ).mopsfin_t187ap05_O,
          "Official native schema",
        );
  const properties = record(schema.properties, "Official native properties");
  const expected = new Set<string>(TAIWAN_REVENUE_FIELDS);
  if (
    Object.keys(properties).length !== expected.size ||
    Object.keys(properties).some((key) => !expected.has(key))
  )
    throw new Error("Official native revenue schema changed");
  for (const field of expected)
    if (record(properties[field], "Official property").type !== "string")
      throw new Error(`Official native field type changed: ${field}`);
  if (market === "TPEX") {
    const ref = response.content?.["application/json"]?.schema?.$ref;
    if (ref !== "#/components/schemas/mopsfin_t187ap05_O")
      throw new Error("Official TPEx response schema reference changed");
  }
}

export function taiwanRevenueCsv(rows: readonly (readonly string[])[]): string {
  return (
    [[...TAIWAN_REVENUE_FIELDS], ...rows]
      .map((row) => {
        if (row.length !== TAIWAN_REVENUE_FIELDS.length)
          throw new Error("Native revenue CSV width changed");
        return row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
      })
      .join("\r\n") + "\r\n"
  );
}

export async function collectTaiwanRevenue(
  input: CollectTaiwanRevenueInput,
): Promise<CollectTaiwanRevenueResult> {
  input.signal.throwIfAborted();
  if (!Object.hasOwn(SOURCES, input.market)) throw new Error("Unsupported Taiwan revenue market");
  const source = SOURCES[input.market];
  const runDir = join(
    resolve(input.workDir),
    `${input.market.toLowerCase()}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(runDir, { recursive: true });
  const provenancePath = join(runDir, "provenance.json");
  const requests: Record<string, SourceJson>[] = [];
  const supportingFiles: CollectTaiwanRevenueResult["supportingFiles"] = [];
  const download = async (url: string) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      input.signal.throwIfAborted();
      const evidence: Record<string, SourceJson> = {
        url,
        attempt,
        requested_at: new Date().toISOString(),
        accept: "application/json",
        accept_encoding: "identity",
      };
      let response: Response | undefined;
      try {
        const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]);
        response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": OFFICIAL_USER_AGENT,
          },
          signal,
          redirect: "error",
        });
        evidence.status = response.status;
        evidence.content_type = response.headers.get("content-type");
        evidence.response_headers = Object.fromEntries(
          [
            "date",
            "etag",
            "last-modified",
            "content-type",
            "content-length",
            "content-encoding",
            "retry-after",
          ].flatMap((name) =>
            response!.headers.get(name) === null ? [] : [[name, response!.headers.get(name)!]],
          ),
        );
        const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
        if (encoding && encoding !== "identity") {
          await response.body?.cancel();
          throw new Error(
            "Exchange response ignored identity encoding; exact downloaded bytes cannot be verified",
          );
        }
        if (!response.body) throw new Error("Official revenue response has no body");
        const parts: Uint8Array[] = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            signal.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (size > 8 * 1024 * 1024)
              throw new Error("Official revenue response exceeds the bounded byte limit");
            parts.push(next.value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const bytes = Buffer.concat(parts, size);
        const digest = hash(bytes);
        const filePath = join(runDir, `${digest}.json`);
        await writeFile(filePath, bytes, { flag: "wx" }).catch(async (error) => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        });
        evidence.sha256 = digest;
        evidence.bytes = size;
        evidence.retrieved_at = new Date().toISOString();
        evidence.body_file = `${digest}.json`;
        supportingFiles.push({
          filePath,
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          provenance: {
            source_url: url,
            retrieved_at: evidence.retrieved_at,
            direct_download_sha256_verified: true,
            kind: "taiwan_exchange_official_response",
          },
        });
        if (!response.ok) throw new Error(`Official exchange returned HTTP ${response.status}`);
        if (!/^application\/json\b/i.test(response.headers.get("content-type") ?? ""))
          throw new Error("Official exchange did not return JSON");
        const declared = response.headers.get("content-length");
        if (
          declared !== null &&
          (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))
        )
          throw new Error("Official response has an invalid Content-Length");
        if (declared !== null && Number(declared) !== size)
          throw new Error("Official response body length differs from Content-Length");
        requests.push(evidence);
        return { bytes, digest, retrievedAt: evidence.retrieved_at as string };
      } catch (error) {
        evidence.error = error instanceof Error ? error.message : String(error);
        requests.push(evidence);
        await writeFile(
          provenancePath,
          JSON.stringify({ status: "collecting_not_published", requests }, null, 2),
        );
        input.signal.throwIfAborted();
        if (
          attempt === 3 ||
          (response && ![408, 429, 500, 502, 503, 504].includes(response.status))
        )
          throw error;
        const after = response?.headers.get("retry-after");
        const wait =
          after && /^\d+$/.test(after)
            ? Math.min(60_000, Number(after) * 1000)
            : 1500 * 2 ** (attempt - 1);
        await delay(wait, undefined, { signal: input.signal });
      }
    }
    throw new Error("Official exchange request retries exhausted");
  };
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const specification = await download(source.specification);
    validateTaiwanRevenueSchema(input.market, JSON.parse(decoder.decode(specification.bytes)));
    const native = await download(source.url);
    const retrieved = new Date(native.retrievedAt);
    const expectedPeriod = input.expectedPeriod ?? lastClosedTaipeiMonth(retrieved);
    const asOfDate = new Date(retrieved.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    const parsed = parseTaiwanRevenue(decoder.decode(native.bytes), { expectedPeriod, asOfDate });
    const previous = [...new Set(input.previousCompanyCodes ?? [])];
    const current = new Set(parsed.companyCodes);
    const previousSet = new Set(previous);
    const absent = previous.filter((code) => !current.has(code));
    const added = previous.length
      ? parsed.companyCodes.filter((code) => !previousSet.has(code))
      : [];
    const csv = taiwanRevenueCsv(parsed.rows);
    const filePath = join(
      runDir,
      `${input.market.toLowerCase()}-monthly-revenue-${parsed.nativePeriod}.csv`,
    );
    await writeFile(filePath, csv, { flag: "wx" });
    const coverage: Record<string, SourceJson> = {
      source_ids: [`${input.market}_MONTHLY`],
      market: input.market,
      entity_type: "exchange_listed_issuer",
      entity_id_column: "公司代號",
      identity_rule:
        "Native issuer code within the named exchange + native reported month. No parent, ADR, US-company, or cross-exchange identity inference.",
      population_role: "all_returned_issuers_all_industries",
      reported_issuer_count: parsed.rows.length,
      reported_company_codes: parsed.companyCodes,
      previous_population_compared: previous.length > 0,
      previously_reported_codes_absent: absent,
      newly_reported_codes: added,
      population_change_policy:
        "Source absence is recorded without asserting a cause or inserting a missing issuer row.",
      completeness_basis:
        "Complete returned response: the successful unpaginated JSON array is parsed through its closing bracket and every row is preserved. Exchange population completeness is not independently established; the API provides no independent total-count field.",
      previous_reported_issuer_count: previous.length || null,
      reported_issuer_count_change: previous.length ? parsed.rows.length - previous.length : null,
      reported_population_decreased: previous.length > 0 && parsed.rows.length < previous.length,
      native_period_field: "資料年月",
      native_period: parsed.nativePeriod,
      native_table_dates: parsed.nativeReportDates,
      period_frequency: "monthly",
      period_index_is_native_text: false,
      periods: [parsed.period],
      period_index_rule:
        "Gregorian search index only: ROC year + 1911, month unchanged. Original 資料年月 cells remain exact native text.",
      calendar_reference: CALENDAR_REFERENCE,
      field_count: TAIWAN_REVENUE_FIELDS.length,
      requested_field_count: TAIWAN_REVENUE_FIELDS.length,
      returned_field_count: TAIWAN_REVENUE_FIELDS.length,
      requested_but_not_returned_fields: [],
      requested_but_not_returned_count: 0,
      empty_string_counts_by_column: parsed.emptyCounts,
      monetary_currency: "not_asserted_by_json_schema",
      monetary_scale: "not_asserted_by_json_schema",
    };
    const provenance: Record<string, SourceJson> = {
      adapter: "taiwan_exchange_native_string_json_v1",
      source_url: source.url,
      specification_url: source.specification,
      specification_sha256: specification.digest,
      source_json_sha256: native.digest,
      assembled_csv_sha256: hash(csv),
      assembled_rows: parsed.rows.length,
      native_field_count: TAIWAN_REVENUE_FIELDS.length,
      retrieved_at: native.retrievedAt,
      source_value_policy:
        "Every native JSON value must be a string; numeric, null, boolean and structured values fail before coercion. Exact decoded native strings are written to CSV, without numeric conversion or missing-value inference.",
      assembly:
        "The raw original JSON response and official schema are archived separately. CSV preserves all native keys in reviewed order and every returned row; it is a lossless string projection, not an original CSV download.",
      calendar_rule:
        "Taiwan Ministry of the Interior year table: ROC1=1912, ROC115=2026. Only the indexed calendar year is translated; source period cells and all financial values are unchanged.",
      calendar_reference: CALENDAR_REFERENCE,
      coverage,
      requests,
    };
    await writeFile(
      provenancePath,
      JSON.stringify({ status: "collected_not_published", ...provenance }, null, 2) + "\n",
    );
    const columns: SourceColumn[] = TAIWAN_REVENUE_FIELDS.map((field, index) => ({
      key: `col${String(index + 1).padStart(4, "0")}`,
      label: field,
      type: "string",
      native_type: "string",
      ...(field.includes("(%)")
        ? { unit: "Percent", unit_evidence: "Explicit (%) in the official native field label" }
        : {}),
      ...(field === "資料年月"
        ? {
            description:
              "Native ROC year and month, preserved exactly. The Gregorian search index is separately derived by adding 1911 to the ROC year.",
            period_basis: "Native ROC year/month",
          }
        : {}),
    }));
    const ingest: SourceIngest = {
      format: "csv",
      encoding: "utf-8",
      delimiter: ",",
      header_rows: 1,
      dimensions: { entity_id: 2, entity_name: 3 },
      constants: { period: parsed.period, source_url: source.url },
      null_values: [],
    };
    return {
      filePath,
      retrievedAt: native.retrievedAt,
      rows: parsed.rows.length,
      columns,
      ingest,
      nativePeriod: parsed.nativePeriod,
      period: parsed.period,
      coverage,
      provenance,
      supportingFiles,
      provenancePath,
    };
  } catch (error) {
    await writeFile(
      provenancePath,
      JSON.stringify(
        {
          status: "failed_not_published",
          market: input.market,
          error: error instanceof Error ? error.message : String(error),
          requests,
        },
        null,
        2,
      ) + "\n",
    ).catch(() => {});
    throw new Error(
      `Taiwan native collection failed; evidence retained at ${provenancePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
