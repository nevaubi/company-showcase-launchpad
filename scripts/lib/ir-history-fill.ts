import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { unpackFillDoc } from "../../src/lib/ir/table-fill-cache";

export const HISTORY_FILL_JOB = "ir-history-fill:";
export const FILL_STAGE_KEY = "ir:verified-fill:v1:";
export const FILL_ATTEMPTS = 8;
const SHA256 = /^[a-f0-9]{64}$/;
export const fillDigest = (body: string) => createHash("sha256").update(body).digest("hex");

export interface StagedFill {
  ticker: string;
  documentId: string;
  accession: string;
  sourceUrl: string;
  storedSha256: string;
  canonicalSha256: string;
  sha256: string;
  bytes: number;
  encoding: string;
  data: string;
}

export interface NativeDocument {
  id: string;
  ticker: string;
  accn: string | null;
  source_url: string;
  sha256: string | null;
}

/** Only a cache of the verified native document may enter the private normalized-document bucket. */
export function unpackStagedFill(s: StagedFill, doc: NativeDocument, key: string): string {
  const expectedKey = FILL_STAGE_KEY + doc.ticker + ":" + doc.id;
  if (
    key !== expectedKey ||
    s.documentId !== doc.id ||
    s.ticker !== doc.ticker ||
    s.accession !== doc.accn ||
    s.sourceUrl !== doc.source_url ||
    s.storedSha256 !== doc.sha256 ||
    !SHA256.test(s.storedSha256) ||
    !SHA256.test(s.canonicalSha256) ||
    !SHA256.test(s.sha256) ||
    s.encoding !== "gzip+base64" ||
    !Number.isInteger(s.bytes) ||
    s.bytes < 1 ||
    s.bytes > 8_000_000 ||
    typeof s.data !== "string" ||
    s.data.length > 6_000_000
  )
    throw new Error("Staged table does not match its native source record");
  const parsed = gunzipSync(Buffer.from(s.data, "base64"), { maxOutputLength: s.bytes });
  if (parsed.length !== s.bytes || createHash("sha256").update(parsed).digest("hex") !== s.sha256)
    throw new Error("Normalized table checksum mismatch");
  const body = parsed.toString("utf8");
  if (!unpackFillDoc(body)) throw new Error("Unsupported normalized table format");
  return body;
}
