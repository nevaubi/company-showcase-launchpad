import { describe, expect, it } from "vitest";
import { scanReceipts } from "./scan";

describe("supply read receipts", () => {
  const filings = [
    { accn: "0000000000-26-000010", form: "10-K", filed: "2026-02-20", doc: "a.htm" },
    { accn: "0000000000-26-000090", form: "10-Q", filed: "2026-10-30", doc: "b.htm" },
  ];
  it("writes one receipt per filing read, with the links that cite it", () => {
    const rows = [{ accn: "0000000000-26-000010", counterparty: "A" }, { accn: "0000000000-26-000010", counterparty: "B" }];
    expect(scanReceipts("ACME", filings, rows, "2026-11-27T14:00:00.000Z")).toEqual([
      { ticker: "ACME", accn: "0000000000-26-000010", form: "10-K", filed: "2026-02-20", links: 2, scanned_at: "2026-11-27T14:00:00.000Z" },
      { ticker: "ACME", accn: "0000000000-26-000090", form: "10-Q", filed: "2026-10-30", links: 0, scanned_at: "2026-11-27T14:00:00.000Z" },
    ]);
  });
  it("a read that names nobody still leaves its receipts", () => {
    const r = scanReceipts("ACME", filings, [], "2026-11-27T14:00:00.000Z");
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.links === 0)).toBe(true);
  });
});
