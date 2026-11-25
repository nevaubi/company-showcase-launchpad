// One filing, from the texts EDGAR serves for it to the rows that get stored. Pure, and shared by the two
// callers so they cannot drift apart: scripts/abs-ee.ts (any file size, streamed) and the scheduled job
// (small files, a few seconds a run).
import {
  classifyRecords,
  cmbsMetrics,
  cmbsRows,
  type CmbsAssetRow,
  type CmbsPropertyRow,
} from "./cmbs";
import {
  assetFiles,
  dealOf,
  familyOfClass,
  parseAbsHeader,
  parseFilingIndex,
  type AbsHeader,
  type DealIdentity,
  type IndexDocument,
} from "./edgar";
import { PARSER, type MetricRow } from "./metrics";
import type { AbsFileShape, AbsRecord } from "./xml";

/** The asset classes this reader version stores. */
export const READS: ReadonlySet<string> = new Set(["cmbs"]);
/** A file up to this size is read whatever its header says it is (an auto loan file is 30 to 220 MB). */
export const SMALL_FILE = 5_000_000;

export type FilingPlan =
  | { skip: string }
  | {
      skip?: undefined;
      header: AbsHeader;
      headerSha256: string;
      deal: DealIdentity;
      docs: IndexDocument[];
      file: IndexDocument;
    };

/**
 * What to read for a filing, from its header and its document list; `skip` says why there is nothing
 * to read. The header's asset class is the filer's label and has been seen wrong, so a small file is
 * read and judged by its own namespace; only a large file whose label names nothing this reader covers
 * is left on SEC's side.
 */
export function planFiling(
  accession: string,
  headerText: string,
  headerSha256: string,
  indexHtml: string,
): FilingPlan {
  const header = parseAbsHeader(headerText);
  if (header.accession !== accession) throw new Error(`header is for ${header.accession}`);
  const deal = dealOf(header);
  if (!deal) return { skip: "the header does not establish one issuing entity" };
  const docs = parseFilingIndex(indexHtml);
  const files = assetFiles(docs);
  if (!files.length) return { skip: "no EX-102 asset data file" };
  if (files.length > 1) return { skip: `unsupported: ${files.length} EX-102 files in one filing` };
  const labelled = header.assetClasses.map(familyOfClass);
  const covered = !labelled.length || labelled.some((f) => READS.has(f));
  if (!covered && (files[0].listed_bytes ?? Infinity) > SMALL_FILE)
    return {
      skip: `unsupported: asset class "${header.assetClasses.join("; ")}" is not read by ${PARSER}`,
    };
  return { header, headerSha256, deal, docs, file: files[0] };
}

export type StoredRows = {
  cmbs_assets: CmbsAssetRow[];
  cmbs_properties: CmbsPropertyRow[];
  metrics: MetricRow[];
};
export const ROW_KINDS = ["cmbs_assets", "cmbs_properties", "metrics"] as const;

export type FilingPayload =
  | { skip: string }
  | {
      skip?: undefined;
      sha256: string;
      bytes: number;
      /** header facts for abs_commit_load */
      filing: Record<string, unknown>;
      documents: Record<string, unknown>[];
      rows: StoredRows;
      /** row counts the store must hold, plus what the reader noticed (kept with the load) */
      counts: Record<string, unknown>;
    };

/** Takes a commercial mortgage file's records as they are read. Records of another asset class are counted by the reader and left alone. */
export function cmbsCollector() {
  const assets: CmbsAssetRow[] = [];
  const properties: CmbsPropertyRow[] = [];
  return {
    assets,
    properties,
    add(record: AbsRecord, family: AbsFileShape["family"]) {
      if (family !== "cmbs") return;
      const rows = cmbsRows(record);
      assets.push(rows.asset);
      properties.push(...rows.properties);
    },
  };
}

const tally = (
  rows: { unparsed: Record<string, unknown>; extra: Record<string, unknown> }[],
  key: "unparsed" | "extra",
) => {
  const t: Record<string, number> = {};
  for (const r of rows) for (const name of Object.keys(r[key])) t[name] = (t[name] ?? 0) + 1;
  return t;
};

/** Everything to store for a filing whose asset file has been read to the end. */
export function filingPayload(
  plan: Exclude<FilingPlan, { skip: string }>,
  shape: AbsFileShape,
  served: { bytes: number; sha256: string; retrievedAt: string },
  collected: ReturnType<typeof cmbsCollector>,
  decodeReplacements: number,
): FilingPayload {
  if (!READS.has(shape.family))
    return {
      skip: `unsupported: asset files in ${shape.namespace || "no namespace"} are not read by ${PARSER}`,
    };
  const { assets, properties } = collected;
  const notes = classifyRecords(assets, properties);
  const metrics = cmbsMetrics(assets, properties);
  const { header, deal, docs, file } = plan;
  return {
    sha256: served.sha256,
    bytes: served.bytes,
    filing: {
      ...deal,
      family: shape.family,
      asset_class: header.assetClasses.join("; ") || null,
      depositor_cik: header.depositorCik,
      sponsor_cik: header.sponsorCik,
      period_start: header.periodStart,
      period_end: header.periodEnd,
      accepted_at: header.acceptedAt,
      header_sha256: plan.headerSha256,
    },
    documents: docs.map((d) =>
      d.url === file.url
        ? {
            ...d,
            bytes: served.bytes,
            sha256: served.sha256,
            records: shape.records,
            namespace: shape.namespace,
            retrieved_at: served.retrievedAt,
          }
        : d,
    ),
    rows: { cmbs_assets: assets, cmbs_properties: properties, metrics },
    counts: {
      cmbs_assets: assets.length,
      cmbs_properties: properties.length,
      metrics: metrics.length,
      records: shape.records,
      attributes: shape.attributes,
      decode_replacements: decodeReplacements,
      notes,
      unparsed: { assets: tally(assets, "unparsed"), properties: tally(properties, "unparsed") },
      extra: { assets: tally(assets, "extra"), properties: tally(properties, "extra") },
    },
  };
}

/** How many times the decoder had to put U+FFFD for bytes that are not text in the declared encoding. */
export function countReplacements(text: string): number {
  let n = 0;
  for (let i = text.indexOf("�"); i >= 0; i = text.indexOf("�", i + 1)) n++;
  return n;
}
