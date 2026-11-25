import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/sources/catalog";
import {
  collectionForSegment,
  collectionPath,
  collectionSlug,
  datasetPath,
  legacyHref,
  legacyTarget,
  nativeParam,
} from "./addresses";

const SNAP = "a".repeat(64);
const FDIC = "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";
const to = (search: string) => {
  const target = legacyTarget(search);
  return target ? legacyHref(target) : null;
};

describe("collection addresses", () => {
  it("uses core's slugs for the collection pages", () => {
    expect(collectionSlug("01_financials")).toBe("banks");
    expect(collectionSlug("08_consumer_discretionary")).toBe("consumer-discretionary");
    expect(collectionPath("11_real_estate")).toBe("/app/alt-data/library/c/real-estate");
  });

  it("finds every collection by its slug", () => {
    const slugs = COLLECTIONS.map((c) => collectionSlug(c.id));
    expect(new Set(slugs).size).toBe(COLLECTIONS.length);
    for (const c of COLLECTIONS) expect(collectionForSegment(collectionSlug(c.id))?.id).toBe(c.id);
  });

  it("accepts the stored id, an older alias and any letter case, and names nothing for a wrong slug", () => {
    expect(collectionForSegment("01_financials")?.id).toBe("01_financials");
    expect(collectionForSegment("Real-Estate")?.id).toBe("11_real_estate");
    expect(collectionForSegment("macro")?.id).toBe("00_universal");
    expect(collectionForSegment("banks-and-stuff")).toBeNull();
    expect(collectionForSegment("%E0%A4%A")).toBeNull();
    expect(collectionForSegment("")).toBeNull();
  });
});

describe("old Alt data addresses", () => {
  it("sends a table link to the table page with its snapshot and filters", () => {
    expect(
      to(`?view=sources&source=${FDIC}&snapshot=${SNAP}&entity=%22628%22&geography=01095&period=20260630&q=bank&after=25`),
    ).toBe(datasetPath(FDIC, { snapshot: SNAP, entity: "628", geography: "01095", period: "20260630", q: "bank", after: 25 }));
  });

  it("keeps a hand-written identifier exactly as typed", () => {
    const target = legacyTarget(`?view=sources&source=${FDIC}&entity=628&period=1e3&geography=12.50`);
    expect(target).toEqual({ kind: "dataset", datasetId: FDIC, filters: { entity: "628", period: "1e3", geography: "12.50" } });
  });

  it("carries the links the assistant wrote before, unchanged", () => {
    // The old explorer link builder, as it stood at 2bf480b (src/lib/sources/research.ts, officialSourceHref).
    const old = defaultStringifySearch({ view: "sources", source: FDIC, snapshot: SNAP, after: 37, entity: "00123", geography: "01001", period: "FY 2026" });
    const href = to(old);
    expect(href).toBe(datasetPath(FDIC, { snapshot: SNAP, after: 37, entity: "00123", geography: "01001", period: "FY 2026" }));
    const url = new URL(href!, "https://example.test");
    expect(url.pathname).toBe(`/app/alt-data/library/d/${FDIC}`);
    expect(defaultParseSearch(url.search)).toEqual({ snapshot: SNAP, after: 37, entity: "00123", geography: "01001", period: "FY 2026" });
  });

  it("keeps identifiers that look like numbers or words as strings on the new page", () => {
    const href = datasetPath(FDIC, { entity: "628", geography: "true", period: "20260630" });
    expect(defaultParseSearch(new URL(href, "https://example.test").search)).toEqual({ entity: "628", geography: "true", period: "20260630" });
  });

  it("drops a malformed snapshot and a cursor that is not a row count", () => {
    expect(legacyTarget(`?view=sources&source=${FDIC}&snapshot=abc&after=-3`)).toEqual({ kind: "dataset", datasetId: FDIC, filters: {} });
    expect(legacyTarget(`?view=sources&source=${FDIC}&after=0`)).toEqual({ kind: "dataset", datasetId: FDIC, filters: {} });
  });

  it("lets a table win over a collection", () => {
    expect(to(`?view=sources&sector=01_financials&source=${FDIC}`)).toBe(datasetPath(FDIC));
  });

  it("sends a collection link to the collection whose stored id it names", () => {
    expect(to("?view=sources&sector=01_financials")).toBe("/app/alt-data/library/c/banks");
    expect(to("?view=sources&sector=%2204_energy%22")).toBe("/app/alt-data/library/c/energy");
  });

  it("sends an unknown collection, a bare view and filters without a table to the library", () => {
    expect(to("?view=sources&sector=99_nowhere")).toBe("/app/alt-data/library");
    expect(to("?view=sources")).toBe("/app/alt-data/library");
    expect(to("view=%22sources%22")).toBe("/app/alt-data/library");
    expect(to("?view=sources&entity=628&q=bank")).toBe("/app/alt-data/library");
  });

  it("leaves Company signals addresses where they are", () => {
    expect(legacyTarget("")).toBeNull();
    expect(legacyTarget("?d=bank")).toBeNull();
    expect(legacyTarget("?view=signals")).toBeNull();
  });

  it("reads values as the old router wrote them", () => {
    expect(nativeParam('"628"', 10)).toBe("628");
    expect(nativeParam("628", 10)).toBe("628");
    expect(nativeParam('"unterminated', 20)).toBe('"unterminated');
    expect(nativeParam("", 10)).toBeUndefined();
    expect(nativeParam("x".repeat(11), 10)).toBeUndefined();
    expect(nativeParam(null, 10)).toBeUndefined();
  });
});
