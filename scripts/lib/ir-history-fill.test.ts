import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FILL_STAGE_KEY, fillDigest, unpackStagedFill } from "./ir-history-fill";
import { packFillDoc, reduceDocument } from "../../src/lib/ir/table-fill-cache";

describe("private IR cache promotion", () => {
  const body = packFillDoc(reduceDocument("<table><tr><td>Revenue</td><td>15</td></tr></table>"));
  const d = {
    id: "wfc-doc",
    ticker: "WFC",
    accn: "0000072971-24-000218",
    source_url: "https://www.sec.gov/Archives/report.htm",
    sha256: "1".repeat(64),
  };
  const stage = {
    documentId: d.id,
    ticker: d.ticker,
    accession: d.accn,
    sourceUrl: d.source_url,
    storedSha256: d.sha256,
    canonicalSha256: "2".repeat(64),
    sha256: fillDigest(body),
    bytes: Buffer.byteLength(body),
    encoding: "gzip+base64",
    data: gzipSync(body).toString("base64"),
  };
  const key = FILL_STAGE_KEY + d.ticker + ":" + d.id;
  it("keeps validated bytes under the corresponding native document identity", () => {
    expect(unpackStagedFill(stage, d, key)).toBe(body);
    expect(() => unpackStagedFill({ ...stage, ticker: "JPM" }, d, key)).toThrow();
    expect(() => unpackStagedFill({ ...stage, sha256: "0".repeat(64) }, d, key)).toThrow();
  });
});
