import { describe, expect, it } from "vitest";
import { mergeStore, passages, storeRow, type StoreDoc } from "./store";

const doc = (over: Partial<StoreDoc> = {}): StoreDoc => ({
  id: "32d9a99e210cb699",
  ticker: "AAPL",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000024/a8-kex991q4202609262026.htm",
  title: "8-K 2026-11-02 a8-kex991q4202609262026.htm (Items 2.02,9.01)",
  doc_type: "release",
  fiscal_label: "Q4 FY26",
  period_end: "2026-09-26",
  published: "2026-11-02",
  ext: ".htm",
  bytes: 172148,
  storage_path: "AAPL/32d9a99e210cb699-a8-kex991q4202609262026.htm",
  text_path: "AAPL/text/32d9a99e210cb699-v2.json",
  pages: 1,
  fetched_at: "2026-11-03T10:28:58+00:00",
  ...over,
});

describe("IR store", () => {
  it("maps store documents to library rows", () => {
    const r = storeRow(doc());
    expect(r.id).toBe("store:32d9a99e210cb699");
    expect(r.kind).toBe("press-release");
    expect(r.accn).toBe("0000320193-26-000024");
    expect(r.ext).toBe("htm");
    expect(r.filed).toBe("2026-11-02");
  });

  it("skips documents the app library already has and unstored ones", () => {
    const app = [{ ...storeRow(doc()), id: "app-1", source: "sec" }];
    expect(mergeStore(app, [doc()])).toHaveLength(0);
    expect(
      mergeStore([], [doc(), doc({ id: "b", url: "https://x", storage_path: null })]),
    ).toHaveLength(1);
  });

  it("finds passages with page numbers", () => {
    const hits = passages(["nothing here", "Revenue grew 8% on iPhone demand"], "iphone", 10);
    expect(hits).toEqual([{ page: 2, text: "rew 8% on iPhone demand" }]);
  });
});
