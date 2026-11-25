/**
 * Official FDIC current-quarter collector. Amounts only travel through native CSV.
 * JSON is used solely for identity/count/index checks, never financial values.
 * No database writes or publication pointers are changed by this module.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { NativeCsvReader } from "../../src/lib/sources/csv.ts";
import { OFFICIAL_USER_AGENT } from "../../src/lib/sources/refresh-plan";
import type { SourceColumn, SourceIngest, SourceJson } from "../../src/lib/sources/schema";

const FINANCIALS = "https://api.fdic.gov/banks/financials";
const IDENTITY = ["CERT", "REPDTE"];
const SOURCE_IDENTITY = [...IDENTITY, "ID"];
const MAX_FIELDS = 250;
const BASELINE_FIELDS = 2379;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const QUARTER_DATE = /^\d{4}(0331|0630|0930|1231)$/;
const CERTIFICATE = /^[1-9]\d{0,7}$/;
const NATIVE_FIELD = /^[A-Z][A-Z0-9_]{0,39}$/;

export const FDIC_BASELINE_DATASET_ID =
  "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";
export const FDIC_BASELINE_SOURCE_PATH =
  "01_financials/data/fdic_top500_all_native_quarterly_2000_latest.csv";
export const FDIC_CURRENT_DATASET = {
  id: "official_fdic_2026q2_cohort500_native_current_quarter",
  name: "FDIC · Current quarter · June 2026 cohort",
  sector: "01_financials",
  agency: "FDIC",
  source_id: "FDIC_FINANCIALS",
  source_url: FINANCIALS,
  description:
    "All returned current-quarter fields from the 2,379-field reviewed FDIC baseline, retaining the 500 insured institutions selected at June 30, 2026. Requested fields that FDIC does not return are listed explicitly in snapshot coverage.",
  grain: "Insured institution × reporting quarter",
  units: "Native FDIC field units; source strings are preserved without rescaling.",
  notes:
    "Fixed June 2026 cohort, not a current top-500 ranking or a public-company universe. Current reporting coverage may be smaller than 500. Missing certificates are disclosed without successor mapping or zero-fill. CERT identifies the insured institution; RSSDHCR identifies its regulatory parent. Income-field period bases remain field-specific. This single-quarter collection is separate from the historical all-quarter archive.",
  latest_snapshot_id: null,
};

export type FdicNativeRow = Record<string, string>;
export type FdicCohort = {
  report_date: "20260630";
  selection: string;
  certs: string[];
  original_sha256: string;
};
export type FdicIdentityPage = {
  total: number;
  indexName: string;
  indexCreatedAt: string | null;
  rows: FdicNativeRow[];
};
export type FdicRequestEvidence = {
  url: string;
  accept: string;
  accept_encoding: "identity";
  retrieved_at: string;
  attempt: number;
  status: number | null;
  content_type: string | null;
  bytes: number | null;
  sha256: string | null;
  body_file: string | null;
  response_headers: Record<string, string>;
  error?: string;
};
export type FdicSupportingFile = {
  filePath: string;
  contentType: string;
  provenance: Record<string, SourceJson>;
};
export type CollectFdicNativeInput = {
  /** Full columns from the verified historical native snapshot, not a projection. */
  columns: SourceColumn[];
  baselineSnapshotId: string;
  workDir: string;
  signal: AbortSignal;
  maxFields?: number;
  onProgress?: (progress: {
    phase: string;
    requests: number;
    fieldBlock?: number;
    fieldBlocks?: number;
  }) => void;
};
export type CollectFdicNativeResult = {
  filePath: string;
  retrievedAt: string;
  reportDate: string;
  rows: number;
  columns: SourceColumn[];
  ingest: SourceIngest;
  coverage: Record<string, SourceJson>;
  provenance: Record<string, SourceJson>;
  supportingFiles: FdicSupportingFile[];
  provenancePath: string;
};

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const nativeKey = (row: FdicNativeRow) => `${row.CERT}:${row.REPDTE}`;
const compareCert = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
const chunks = <T>(values: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
    values.slice(i * size, (i + 1) * size),
  );

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function certificate(value: unknown): string {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !CERTIFICATE.test(text))
    throw new Error("Invalid FDIC certificate identifier");
  return text;
}
function quarter(value: unknown): string {
  if (typeof value !== "string" || !QUARTER_DATE.test(value))
    throw new Error("FDIC report date must be a native quarter-end YYYYMMDD string");
  return value;
}
function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}
function uniqueFields(fields: readonly string[]): void {
  if (!fields.length || fields.some((field) => !NATIVE_FIELD.test(field)))
    throw new Error("Invalid native FDIC field code");
  if (new Set(fields).size !== fields.length) throw new Error("Duplicate native FDIC field code");
}

export function validateFdicCohort(value: unknown): FdicCohort {
  const input = object(value, "FDIC cohort");
  if (input.report_date !== "20260630")
    throw new Error("The reviewed FDIC cohort is fixed at 20260630");
  if (!Array.isArray(input.certs) || input.certs.length !== 500)
    throw new Error("The reviewed cohort must contain exactly 500 certificates");
  const certs = input.certs.map(certificate);
  if (new Set(certs).size !== certs.length)
    throw new Error("Duplicate certificate in the fixed FDIC cohort");
  if (typeof input.selection !== "string" || !input.selection.trim())
    throw new Error("The cohort selection rule is required");
  if (typeof input.original_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.original_sha256))
    throw new Error("The original cohort file hash is required");
  return {
    report_date: "20260630",
    selection: input.selection,
    certs: certs.sort(compareCert),
    original_sha256: input.original_sha256,
  };
}

/** ID is emitted automatically by FDIC; every requested block repeats CERT/REPDTE. */
export function fdicFieldBlocks(fields: readonly string[], maxFields = 200): string[][] {
  uniqueFields(fields);
  for (const key of SOURCE_IDENTITY)
    if (!fields.includes(key)) throw new Error(`FDIC baseline is missing ${key}`);
  boundedInteger(maxFields, 3, MAX_FIELDS, "FDIC field block size");
  const measurements = fields.filter((field) => !SOURCE_IDENTITY.includes(field));
  return measurements.length
    ? chunks(measurements, maxFields - IDENTITY.length).map((block) => [...IDENTITY, ...block])
    : [[...IDENTITY]];
}

export function fdicFinancialsUrl(input: {
  certs?: readonly string[];
  reportDate?: string;
  fields: readonly string[];
  offset: number;
  limit: number;
  format: "csv" | "json";
  latest?: boolean;
}): string {
  uniqueFields(input.fields);
  if (input.fields.length > MAX_FIELDS)
    throw new Error("FDIC requests are limited to 250 native fields");
  boundedInteger(input.limit, 1, 500, "FDIC page size");
  boundedInteger(input.offset, 0, 1_000_000, "FDIC page offset");
  const filters: string[] = [];
  if (input.certs) {
    if (!input.certs.length || input.certs.length > 500)
      throw new Error("FDIC certificate batches must contain 1–500 certificates");
    filters.push(`CERT:(${input.certs.map(certificate).join(" OR ")})`);
  }
  if (input.reportDate) filters.push(`REPDTE:${quarter(input.reportDate)}`);
  if (!input.latest && (!input.certs || !input.reportDate))
    throw new Error("A fixed cohort and reporting quarter are required");
  const url = new URL(FINANCIALS);
  if (filters.length) url.searchParams.set("filters", filters.join(" AND "));
  url.searchParams.set("fields", input.fields.join(","));
  url.searchParams.set("sort_by", input.latest ? "REPDTE" : "CERT");
  url.searchParams.set("sort_order", input.latest ? "DESC" : "ASC");
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  // The documented switch is necessary: Accept alone returned JSON in a live probe.
  url.searchParams.set("format", input.format);
  if (url.href.length > 7600)
    throw new Error(
      "FDIC request URL exceeds the bounded length; reduce its field or certificate block",
    );
  return url.href;
}

/** A narrowly guarded reader for the official property's published YAML layout. */
export function parseFdicDictionaryFields(text: string): Set<string> {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!/^type: object\nproperties:\n  data:\n    type: object\n    properties:\n/.test(normalized))
    throw new Error("Official FDIC dictionary layout changed; review before collection");
  const fields = [...normalized.matchAll(/^      ([A-Z][A-Z0-9_]{0,39}):\s*$/gm)].map(
    (match) => match[1],
  );
  uniqueFields(fields);
  return new Set(fields);
}

export function inspectFdicCsvBlock(
  text: string,
  requestedFields: readonly string[],
): { rows: FdicNativeRow[]; returnedFields: string[]; omittedFields: string[] } {
  uniqueFields(requestedFields);
  const parser = new NativeCsvReader(",");
  const parsed = [...parser.write(text), ...parser.close()];
  const header = parsed.shift();
  if (!header?.length) throw new Error("FDIC CSV has no native header");
  uniqueFields(header);
  const expected = new Set([...requestedFields, "ID"]);
  for (const field of SOURCE_IDENTITY)
    if (!header.includes(field))
      throw new Error(`FDIC response omitted required identity column ${field}`);
  for (const field of header)
    if (!expected.has(field)) throw new Error(`Unexpected native FDIC column ${field}`);
  const rows = parsed
    .filter((row) => row.length !== 0)
    .map((values, index) => {
      if (values.length !== header.length)
        throw new Error(`FDIC CSV row ${index + 1} has an inconsistent width`);
      return Object.fromEntries(header.map((field, i) => [field, values[i]]));
    });
  return {
    rows,
    returnedFields: header,
    omittedFields: requestedFields.filter((field) => !header.includes(field)),
  };
}

export function parseFdicCsv(text: string, requestedFields: readonly string[]): FdicNativeRow[] {
  const block = inspectFdicCsvBlock(text, requestedFields);
  if (block.omittedFields.length)
    throw new Error(`FDIC response omitted requested native column ${block.omittedFields[0]}`);
  return block.rows;
}

function checkedRows(
  rows: readonly FdicNativeRow[],
  certs: ReadonlySet<string>,
  reportDate: string,
): Map<string, FdicNativeRow> {
  const result = new Map<string, FdicNativeRow>();
  for (const row of rows) {
    const cert = certificate(row.CERT);
    if (!certs.has(cert))
      throw new Error(`Unexpected certificate ${cert} outside the requested key set`);
    if (quarter(row.REPDTE) !== reportDate)
      throw new Error(`Mixed reporting period for certificate ${cert}`);
    if (typeof row.ID !== "string" || !row.ID)
      throw new Error(`Missing native source ID for certificate ${cert}`);
    const key = nativeKey(row);
    if (result.has(key)) throw new Error(`Duplicate CERT + REPDTE row ${key}`);
    result.set(key, row);
  }
  return result;
}

/** All blocks must have exactly the independently enumerated current-quarter keys. */
export function joinFdicFieldBlocks(
  blocks: readonly (readonly FdicNativeRow[])[],
  fields: readonly string[],
  identities: readonly FdicNativeRow[],
  reportDate: string,
): string[][] {
  uniqueFields(fields);
  const fieldSet = new Set(fields);
  quarter(reportDate);
  if (!identities.length || !blocks.length)
    throw new Error("An empty current-quarter collection cannot be published");
  const certs = new Set(identities.map((row) => certificate(row.CERT)));
  const expected = checkedRows(identities, certs, reportDate);
  const merged = new Map([...expected].map(([key, row]) => [key, { ...row }]));
  for (const block of blocks) {
    const rows = checkedRows(block, certs, reportDate);
    if (rows.size !== expected.size || [...expected.keys()].some((key) => !rows.has(key)))
      throw new Error("FDIC field block has a different key set or missing rows");
    for (const [key, row] of rows) {
      const target = merged.get(key)!;
      for (const [field, value] of Object.entries(row)) {
        if (!fieldSet.has(field))
          throw new Error(`Unexpected FDIC field ${field} outside the reviewed baseline`);
        if (Object.hasOwn(target, field) && target[field] !== value)
          throw new Error(`Conflicting native FDIC ${field} for ${key}`);
        target[field] = value;
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => compareCert(a.CERT, b.CERT))
    .map((row) =>
      fields.map((field) => {
        if (!Object.hasOwn(row, field))
          throw new Error(`Missing baseline field ${field} for ${nativeKey(row)}`);
        return row[field];
      }),
    );
}

/** JSON may contain only identifiers, counts and the API's versioned index stamp. */
export function parseFdicIdentityPage(
  value: unknown,
  certs: readonly string[],
  reportDate: string,
  offset: number,
  limit: number,
): FdicIdentityPage {
  const input = object(value, "FDIC identity response");
  const meta = object(input.meta, "FDIC metadata");
  if (
    !Number.isSafeInteger(meta.total) ||
    (meta.total as number) < 0 ||
    (meta.total as number) > certs.length
  )
    throw new Error("FDIC identity total exceeds the exact cohort or is invalid");
  const total = meta.total as number;
  const index = object(meta.index, "FDIC index stamp");
  if (typeof index.name !== "string" || !index.name.trim())
    throw new Error("FDIC API did not return an index stamp");
  if (!Array.isArray(input.data)) throw new Error("FDIC identity response has no data array");
  if (input.data.length !== Math.max(0, Math.min(limit, total - offset)))
    throw new Error("FDIC identity page count is inconsistent with pagination metadata");
  const rows = input.data.map((entry) => {
    const data = object(object(entry, "FDIC identity entry").data, "FDIC identity data");
    if (Object.keys(data).some((field) => !SOURCE_IDENTITY.includes(field)))
      throw new Error("A financial or unrequested field entered the identity-only JSON path");
    const cert = certificate(data.CERT);
    if (typeof data.ID !== "string") throw new Error("FDIC source identity is missing");
    return { CERT: cert, REPDTE: quarter(data.REPDTE), ID: data.ID };
  });
  checkedRows(rows, new Set(certs), quarter(reportDate));
  return {
    total,
    indexName: index.name,
    indexCreatedAt: typeof index.createTimestamp === "string" ? index.createTimestamp : null,
    rows,
  };
}

/** This is a lossless CSV assembly, not an untouched original HTTP payload. */
export function writeFdicCsv(
  fields: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  uniqueFields(fields);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    [fields, ...rows]
      .map((row) => {
        if (row.length !== fields.length)
          throw new Error("Assembled FDIC row has an inconsistent width");
        return row.map(quote).join(",");
      })
      .join("\r\n") + "\r\n"
  );
}

async function responseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || !Number.isSafeInteger(Number(announced))))
    throw new Error("FDIC response has an invalid Content-Length");
  if (announced && Number(announced) > MAX_RESPONSE_BYTES)
    throw new Error("FDIC response exceeds the native block byte limit");
  if (!response.body) throw new Error("FDIC response has no body");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES)
        throw new Error("FDIC response exceeds the native block byte limit");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (announced !== null && Number(announced) !== total)
    throw new Error("FDIC response body length differs from Content-Length");
  return Buffer.concat(parts, total);
}

function requestHeaders(response: Response): Record<string, string> {
  const names = [
    "date",
    "etag",
    "last-modified",
    "content-type",
    "content-length",
    "content-encoding",
    "x-api-umbrella-request-id",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "retry-after",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      response.headers.get(name) === null ? [] : [[name, response.headers.get(name)!]],
    ),
  );
}

async function makeCollector(workDir: string, signal: AbortSignal) {
  const runDir = join(
    resolve(workDir),
    `fdic-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(join(runDir, "requests"), { recursive: true });
  const requests: FdicRequestEvidence[] = [];
  const supportingFiles: FdicSupportingFile[] = [];
  const hashes = new Set<string>();
  let lastRequestAt = 0;
  const request = async (
    url: string,
    accept: string,
  ): Promise<{ bytes: Uint8Array; evidence: FdicRequestEvidence }> => {
    if (new URL(url).origin !== "https://api.fdic.gov")
      throw new Error("FDIC collector only accepts official API URLs");
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted();
      const remaining = 750 - (Date.now() - lastRequestAt);
      if (remaining > 0) await delay(remaining, undefined, { signal });
      lastRequestAt = Date.now();
      const evidence: FdicRequestEvidence = {
        url,
        accept,
        accept_encoding: "identity",
        retrieved_at: new Date().toISOString(),
        attempt,
        status: null,
        content_type: null,
        bytes: null,
        sha256: null,
        body_file: null,
        response_headers: {},
      };
      let response: Response | undefined;
      try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
        response = await fetch(url, {
          headers: {
            Accept: accept,
            "Accept-Encoding": "identity",
            "User-Agent": OFFICIAL_USER_AGENT,
          },
          signal: requestSignal,
          redirect: "error",
        });
        evidence.status = response.status;
        evidence.content_type = response.headers.get("content-type");
        evidence.response_headers = requestHeaders(response);
        const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
        if (encoding && encoding !== "identity") {
          await response.body?.cancel();
          throw new Error(
            "FDIC response ignored identity encoding; exact downloaded bytes cannot be verified",
          );
        }
        const bytes = await responseBytes(response, requestSignal);
        evidence.retrieved_at = new Date().toISOString();
        evidence.bytes = bytes.length;
        evidence.sha256 = sha256(bytes);
        evidence.body_file = `requests/${evidence.sha256}.body`;
        const filePath = join(runDir, evidence.body_file);
        if (!hashes.has(evidence.sha256)) {
          await writeFile(filePath, bytes, { flag: "wx" });
          hashes.add(evidence.sha256);
          supportingFiles.push({
            filePath,
            contentType: evidence.content_type ?? "application/octet-stream",
            provenance: {
              source_url: url,
              retrieved_at: evidence.retrieved_at,
              direct_download_sha256_verified: true,
              kind: "fdic_official_http_response",
            },
          });
        }
        if (!response.ok) throw new Error(`FDIC official request returned HTTP ${response.status}`);
        const expectedType =
          accept === "text/csv"
            ? /^text\/csv\b/i
            : accept === "application/json"
              ? /^application\/json\b/i
              : /^(?:text\/|application\/)(?:x-)?(?:yaml|octet-stream|plain)/i;
        if (!expectedType.test(evidence.content_type ?? ""))
          throw new Error(`FDIC response content type did not match ${accept}`);
        requests.push(evidence);
        await appendFile(join(runDir, "requests.jsonl"), JSON.stringify(evidence) + "\n");
        return { bytes, evidence };
      } catch (error) {
        evidence.error = error instanceof Error ? error.message : String(error);
        requests.push(evidence);
        await appendFile(join(runDir, "requests.jsonl"), JSON.stringify(evidence) + "\n");
        signal.throwIfAborted();
        const retryable = !response || [408, 429, 500, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === 3) throw error;
        const retryAfter = response?.headers.get("retry-after");
        const seconds =
          retryAfter && /^\d+$/.test(retryAfter)
            ? Number(retryAfter)
            : retryAfter
              ? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000)
              : 0;
        await delay(
          Math.min(
            60_000,
            Math.max(1500 * 2 ** (attempt - 1), Number.isFinite(seconds) ? seconds * 1000 : 0),
          ),
          undefined,
          { signal },
        );
      }
    }
    throw new Error("FDIC request retries exhausted");
  };
  return { runDir, request, requests, supportingFiles };
}

/** Collects all reviewed native fields; any incomplete join throws before staging. */
export async function collectFdicNative(
  input: CollectFdicNativeInput,
): Promise<CollectFdicNativeResult> {
  input.signal.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(input.baselineSnapshotId))
    throw new Error("A verified baseline snapshot SHA is required");
  const fields = input.columns.map((column) => column.label);
  if (fields.length !== BASELINE_FIELDS)
    throw new Error(
      `FDIC native refresh requires all ${BASELINE_FIELDS} reviewed baseline columns`,
    );
  const blocks = fdicFieldBlocks(fields, input.maxFields ?? 200);
  // One CSV page spans the whole fixed cohort. This makes a missing header a
  // source-wide omission, not a page-dependent gap that we might accidentally fill.
  const pageSize = 500;
  const cohortBytes = await readFile(
    new URL("../data/fdic-native-cohort-2026q2.json", import.meta.url),
  );
  const cohort = validateFdicCohort(JSON.parse(cohortBytes.toString("utf8")));
  const collector = await makeCollector(input.workDir, input.signal);
  const { request, runDir, requests, supportingFiles } = collector;
  const provenancePath = join(runDir, "provenance.json");
  const startedAt = new Date().toISOString();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const progress = (phase: string, fieldBlock?: number) =>
    input.onProgress?.({
      phase,
      requests: requests.length,
      ...(fieldBlock === undefined ? {} : { fieldBlock, fieldBlocks: blocks.length }),
    });
  try {
    progress("official_dictionary");
    const dictionary = await request(
      "https://api.fdic.gov/banks/docs/risview_properties.yaml",
      "text/yaml",
    );
    const openapi = await request("https://api.fdic.gov/banks/docs/swagger.yaml", "text/yaml");
    const dictionaryFields = parseFdicDictionaryFields(decoder.decode(dictionary.bytes));
    for (const field of fields)
      if (field !== "ID" && !dictionaryFields.has(field))
        throw new Error(
          `Reviewed baseline field ${field} is absent from the current official dictionary`,
        );
    const discover = async () => {
      const result = await request(
        fdicFinancialsUrl({ fields: IDENTITY, offset: 0, limit: 1, format: "json", latest: true }),
        "application/json",
      );
      const value = object(JSON.parse(decoder.decode(result.bytes)), "FDIC latest-period response");
      const meta = object(value.meta, "FDIC latest-period metadata");
      const index = object(meta.index, "FDIC latest-period index");
      if (typeof index.name !== "string" || !index.name)
        throw new Error("FDIC latest-period index stamp is missing");
      if (!Array.isArray(value.data) || value.data.length !== 1)
        throw new Error("FDIC latest reporting quarter could not be discovered");
      const data = object(object(value.data[0], "FDIC latest row").data, "FDIC latest identity");
      if (Object.keys(data).some((field) => !SOURCE_IDENTITY.includes(field)))
        throw new Error("A financial field entered the identity-only discovery path");
      certificate(data.CERT);
      return { date: quarter(data.REPDTE), index: index.name };
    };
    progress("discover_quarter");
    const latest = await discover();
    if (latest.date < cohort.report_date)
      throw new Error("FDIC latest reporting quarter predates the fixed cohort");
    const certificateBatches = [cohort.certs];
    const enumerate = async (certs: string[]): Promise<FdicNativeRow[]> => {
      const rows: FdicNativeRow[] = [];
      let total: number | null = null;
      do {
        const offset = rows.length;
        const response = await request(
          fdicFinancialsUrl({
            certs,
            reportDate: latest.date,
            fields: IDENTITY,
            offset,
            limit: pageSize,
            format: "json",
          }),
          "application/json",
        );
        const page = parseFdicIdentityPage(
          JSON.parse(decoder.decode(response.bytes)),
          certs,
          latest.date,
          offset,
          pageSize,
        );
        if (page.indexName !== latest.index)
          throw new Error("FDIC index changed during collection; retry against one index version");
        if (total !== null && total !== page.total)
          throw new Error("FDIC pagination total changed during collection");
        total = page.total;
        rows.push(...page.rows);
        checkedRows(rows, new Set(certs), latest.date);
      } while (rows.length < total!);
      return rows;
    };
    progress("enumerate_current_cohort");
    const membership: FdicNativeRow[][] = [];
    for (const certs of certificateBatches) membership.push(await enumerate(certs));
    const identities = membership.flat();
    if (!identities.length)
      throw new Error("No institutions in the fixed cohort report the latest FDIC quarter");
    const fieldRows: FdicNativeRow[][] = [];
    const returnedFields = new Set(SOURCE_IDENTITY);
    const omittedFields: string[] = [];
    for (const [blockIndex, requestedFields] of blocks.entries()) {
      progress("collect_native_fields", blockIndex + 1);
      const rows: FdicNativeRow[] = [];
      for (const [batchIndex, certs] of certificateBatches.entries()) {
        const expected = membership[batchIndex];
        for (let offset = 0; offset < expected.length; offset += pageSize) {
          input.signal.throwIfAborted();
          const response = await request(
            fdicFinancialsUrl({
              certs,
              reportDate: latest.date,
              fields: requestedFields,
              offset,
              limit: pageSize,
              format: "csv",
            }),
            "text/csv",
          );
          const inspected = inspectFdicCsvBlock(decoder.decode(response.bytes), requestedFields);
          const page = inspected.rows;
          if (page.length !== Math.min(pageSize, expected.length - offset))
            throw new Error("FDIC native CSV page count differs from verified membership");
          checkedRows(page, new Set(certs), latest.date);
          if (inspected.omittedFields.length) {
            // A tiny-field independent JSON request proves absence for every exact
            // current-quarter key. If even a null-valued property is returned,
            // fail: there is no native CSV cell we can safely substitute for it.
            const proof = await request(
              fdicFinancialsUrl({
                certs,
                reportDate: latest.date,
                fields: [...IDENTITY, ...inspected.omittedFields],
                offset: 0,
                limit: 500,
                format: "json",
              }),
              "application/json",
            );
            const absent = parseFdicIdentityPage(
              JSON.parse(decoder.decode(proof.bytes)),
              certs,
              latest.date,
              0,
              500,
            );
            if (absent.indexName !== latest.index)
              throw new Error("FDIC index changed during omitted-field verification");
            joinFdicFieldBlocks([absent.rows], SOURCE_IDENTITY, identities, latest.date);
            omittedFields.push(...inspected.omittedFields);
          }
          for (const field of inspected.returnedFields) returnedFields.add(field);
          rows.push(...page);
        }
      }
      // Validate each complete block before retaining it for the final ordered join.
      joinFdicFieldBlocks(
        [rows],
        [...requestedFields.filter((field) => returnedFields.has(field)), "ID"],
        identities,
        latest.date,
      );
      fieldRows.push(rows);
    }
    progress("verify_membership_and_index");
    for (const [index, certs] of certificateBatches.entries()) {
      const end = await enumerate(certs);
      const before = membership[index].map((row) => `${nativeKey(row)}:${row.ID}`).sort();
      const after = end.map((row) => `${nativeKey(row)}:${row.ID}`).sort();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("FDIC reporting membership changed during collection");
    }
    const endLatest = await discover();
    if (endLatest.date !== latest.date || endLatest.index !== latest.index)
      throw new Error("FDIC latest quarter or index changed during collection");
    const currentFields = fields.filter((field) => returnedFields.has(field));
    const currentColumns = input.columns.filter((column) => returnedFields.has(column.label));
    const orderedRows = joinFdicFieldBlocks(fieldRows, currentFields, identities, latest.date);
    const csv = writeFdicCsv(currentFields, orderedRows);
    const filePath = join(runDir, `fdic-cohort-20260630-current-${latest.date}.csv`);
    await writeFile(filePath, csv, { flag: "wx" });
    const retrievedAt = new Date().toISOString();
    const present = new Set(identities.map((row) => row.CERT));
    const missing = cohort.certs.filter((cert) => !present.has(cert));
    const coverage: Record<string, SourceJson> = {
      source_ids: ["FDIC_FINANCIALS"],
      entity_type: "FDIC_certificate",
      entity_id_column: "CERT",
      identity_rule:
        "CERT identifies the insured institution; ID is the source record; RSSDHCR is a regulatory-parent identifier and is never substituted for CERT.",
      cohort_date: cohort.report_date,
      cohort_size: cohort.certs.length,
      cohort_selection: cohort.selection,
      reporting_institutions: orderedRows.length,
      missing_certificates: missing,
      missing_institution_policy:
        "No imputation, successor substitution, or zero-fill. Absence from the latest official reporting quarter is not an explanation of why a certificate is absent.",
      period_column: "REPDTE",
      period_frequency: "quarterly",
      period_index_is_native_text: true,
      periods: [latest.date],
      period_min: latest.date,
      period_max: latest.date,
      field_count: currentFields.length,
      requested_field_count: fields.length,
      returned_field_count: currentFields.length,
      requested_but_not_returned_fields: omittedFields,
      requested_but_not_returned_count: omittedFields.length,
      omitted_field_policy:
        "An omitted column has no invented blank or null cells. Each omission is independently verified absent from the official dictionary-known field request over every available current-quarter identity.",
      fdic_index_name: latest.index,
      api_consistency_check:
        "Exact CERT+REPDTE membership, totals, and API index name verified before and after collection. The API does not provide a transactional snapshot guarantee.",
      baseline_snapshot_id: input.baselineSnapshotId,
    };
    const provenance: Record<string, SourceJson> = {
      adapter: "fdic_native_csv_field_blocks_v1",
      source_url: FINANCIALS,
      official_documentation_url: "https://api.fdic.gov/banks/docs/",
      collected_started_at: startedAt,
      collected_finished_at: retrievedAt,
      report_date: latest.date,
      fdic_index_name: latest.index,
      baseline_dataset_id: FDIC_BASELINE_DATASET_ID,
      baseline_snapshot_id: input.baselineSnapshotId,
      baseline_columns_sha256: sha256(JSON.stringify(fields)),
      native_dictionary_sha256: dictionary.evidence.sha256,
      openapi_sha256: openapi.evidence.sha256,
      reviewed_cohort_sha256: sha256(cohortBytes),
      original_cohort_sha256: cohort.original_sha256,
      cohort_date: cohort.report_date,
      cohort_size: cohort.certs.length,
      cohort_selection: cohort.selection,
      reporting_institutions: orderedRows.length,
      missing_certificates: missing,
      assembled_csv_sha256: sha256(csv),
      assembled_rows: orderedRows.length,
      native_field_count: currentFields.length,
      requested_field_count: fields.length,
      requested_but_not_returned_fields: omittedFields,
      source_value_policy:
        "Exact native CSV cell strings. No numeric parsing, unit scaling, missing-value inference, or entity reassignment.",
      assembly:
        "All reviewed native fields requested in bounded blocks; only actual returned columns are retained. Omitted headers require independent all-row absence proof. Join uses only exact CERT+REPDTE. Source ID and repeated keys must agree. Returned CSV header order follows the verified baseline; original official response bytes are retained separately.",
      coverage,
      requests: requests.map((evidence) => ({ ...evidence })),
    };
    await writeFile(
      provenancePath,
      JSON.stringify({ status: "collected_not_published", ...provenance }, null, 2) + "\n",
      { flag: "wx" },
    );
    const indexOf = (field: string) => currentFields.indexOf(field);
    const ingest: SourceIngest = {
      format: "csv",
      encoding: "utf-8",
      delimiter: ",",
      header_rows: 1,
      dimensions: {
        entity_id: indexOf("CERT"),
        ...(indexOf("NAME") >= 0 ? { entity_name: indexOf("NAME") } : {}),
        period: indexOf("REPDTE"),
        ...(indexOf("STALP") >= 0 ? { geo_code: indexOf("STALP") } : {}),
      },
      constants: {
        source_url: FINANCIALS,
        ...(indexOf("STALP") >= 0 ? { geo_level: "state" } : {}),
      },
      null_values: [],
    };
    progress("collected_not_published");
    return {
      filePath,
      retrievedAt,
      reportDate: latest.date,
      rows: orderedRows.length,
      columns: currentColumns,
      ingest,
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
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          requests,
        },
        null,
        2,
      ) + "\n",
    ).catch(() => {});
    throw new Error(
      `FDIC native collection failed; request evidence retained at ${provenancePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
