import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { collectionBySlug, collectionIdFromSlug, collectionSlug, COLLECTION_SLUGS, COLLECTIONS, LIBRARY_COLLECTIONS } from "./collections";
import {
  collectionHref,
  datasetHref,
  libraryHref,
  LIBRARY_PATH,
  recordHref,
  soleBankCertificate,
  sourceCollectionForSector,
} from "./links";

const SNAP = "cc6fa800".padEnd(64, "0");
const FDIC = "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";
/** What the router hands a route for an address: decoded path segments and its own search parser. */
function open(href: string) {
  const url = new URL(href, "https://filedunder.example");
  return { segments: url.pathname.split("/").map(decodeURIComponent), search: defaultParseSearch(url.search) };
}

describe("source explorer context links", () => {
  it("links a company bank view only through one explicit stored institution certificate", () => {
    expect(
      soleBankCertificate([
        { dataset: "bank", meta: { cert: 628 } },
        { dataset: "bank", meta: { cert: 628 } },
      ]),
    ).toBe("628");
    expect(
      soleBankCertificate([
        { dataset: "bank", meta: { cert: 628 } },
        { dataset: "bank", meta: { cert: 3510 } },
      ]),
    ).toBeNull();
    expect(soleBankCertificate([{ dataset: "deposits", meta: { cert: 628 } }])).toBeNull();
    expect(
      soleBankCertificate([{ dataset: "bank", meta: { cert: "628 OR CERT:3510" } }]),
    ).toBeNull();
  });

  it("maps known sector scopes without guessing an industry or company relationship", () => {
    expect(sourceCollectionForSector("Financials")).toBe("01_financials");
    expect(sourceCollectionForSector("Information Technology")).toBe("02_technology");
    expect(sourceCollectionForSector("Communication Services")).toBe("10_communications");
    expect(sourceCollectionForSector("Regional Banks")).toBeNull();
  });
});

describe("Data library addresses", () => {
  it("opens a record of a pinned snapshot at the table page", () => {
    const href = recordHref(FDIC, SNAP, 48517);
    expect(href).toBe(`${LIBRARY_PATH}/d/${FDIC}?snapshot=${SNAP}&row=48517`);
    expect(open(href)).toEqual({ segments: ["", "app", "alt-data", "library", "d", FDIC], search: { snapshot: SNAP, row: 48517 } });
  });

  it("round-trips native filters through the router's own parser, digits and leading zeros intact", () => {
    for (const filters of [
      { entity: "628", geography: "01095", period: "20260930" },
      { entity: "000123", geography: "00101", period: "2026Q2" },
      { entity: "null", geography: "true", period: "false" },
      { entity: "900719925474099312345678901234567890", geography: "48201", period: "FY 2026" },
    ]) {
      const href = datasetHref(FDIC, { snapshot: SNAP, after: 9, ...filters });
      expect(open(href).search).toEqual({ snapshot: SNAP, after: 9, ...filters });
    }
  });

  it("encodes a dataset id that is not a plain path segment and leaves out empty values", () => {
    const href = datasetHref("collection/file name", { snapshot: undefined, q: "", after: 0 });
    expect(href).toBe(`${LIBRARY_PATH}/d/collection%2Ffile%20name?after=0`);
    expect(open(href).segments.at(-1)).toBe("collection/file name");
  });

  it("links a collection by its slug, from its stored id or the slug itself", () => {
    expect(collectionHref("01_financials")).toBe(`${LIBRARY_PATH}/c/banks`);
    expect(collectionHref("banks", { pub: "fdic", shape: "panel" })).toBe(`${LIBRARY_PATH}/c/banks?pub=fdic&shape=panel`);
    expect(collectionHref("99_new_collection")).toBe(`${LIBRARY_PATH}/c/99_new_collection`);
    expect(open(collectionHref("00_universal", { q: "2026" })).search).toEqual({ q: "2026" });
  });

  it("links the library with its own address state", () => {
    expect(libraryHref()).toBe(LIBRARY_PATH);
    expect(libraryHref({ q: "fdic call report", sort: "new" })).toBe(`${LIBRARY_PATH}?q=fdic+call+report&sort=new`);
    expect(open(libraryHref({ q: "fdic call report" })).search).toEqual({ q: "fdic call report" });
    expect(open(libraryHref({ q: "628" })).search).toEqual({ q: "628" });
  });
});

describe("collection slugs", () => {
  it("gives each of the 15 collections one distinct slug that reads back to it", () => {
    const ids = Object.keys(COLLECTION_SLUGS);
    expect(ids).toHaveLength(15);
    expect(new Set(Object.values(COLLECTION_SLUGS)).size).toBe(15);
    for (const id of ids) {
      expect(collectionSlug(id)).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(collectionIdFromSlug(collectionSlug(id))).toBe(id);
      expect(collectionIdFromSlug(id)).toBe(id);
    }
  });

  it("keeps older spellings and refuses what names no collection", () => {
    expect(collectionIdFromSlug("macro")).toBe("00_universal");
    expect(collectionIdFromSlug("atlas")).toBe("14_source_atlas");
    expect(collectionIdFromSlug("Banks")).toBeNull();
    expect(collectionIdFromSlug("constructor")).toBeNull();
    expect(collectionIdFromSlug("")).toBeNull();
    expect(collectionIdFromSlug(undefined)).toBeNull();
  });
});

describe("collections with the catalogue", () => {
  it("gives every catalogue collection a slug and takes names only from the catalogue", () => {
    expect(LIBRARY_COLLECTIONS.map((c) => c.id).sort()).toEqual(Object.keys(COLLECTION_SLUGS).sort());
    expect(LIBRARY_COLLECTIONS.map((c) => c.id)).toEqual(COLLECTIONS.map((c) => c.id));
    expect(collectionBySlug("banks")).toMatchObject({ id: "01_financials", name: COLLECTIONS.find((c) => c.id === "01_financials")!.name, slug: "banks" });
    expect(collectionBySlug("macro")?.slug).toBe("economy");
    expect(collectionBySlug("nothing")).toBeNull();
  });
});

