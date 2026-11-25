import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/sources/catalog/datasets.json";
import generatedTitles from "./titles.generated.json";
import { COLLECTIONS, PUBLISHERS, describeDataset, isBareName, staleAgainstParent } from "./index";
import { RELATION_IDS } from "./relations";
import type { CatalogEntry, CatalogInput } from "./types";

/**
 * The production list of 25 Nov 2026 (`source_datasets` with each latest snapshot's rows and
 * retrieval time), copied in checksum-verified parts. Its md5 is over one line per dataset,
 * ordered by id: id|name|sector|agency|source_id|source_url|grain|rows|retrieved_at, a missing
 * value written as ^, retrieval time in UTC to the millisecond. The same md5 computed in SQL
 * matched when the file was written.
 */
const LIST = fixture.datasets as CatalogInput[];
const TITLES = generatedTitles as Record<string, { title: string; code?: string; source: string }>;

/** Titles that are still a code or a file stem: no official listing could be matched yet. */
const UNTITLED = 281;

const QUARANTINED = [
  "official_01_financials_data_financials_authoritative_source_registry_c42083680a",
  "official_01_financials_data_financials_raw_retrieval_manifest_0314adc9ac",
  "official_07_materials_source_registry_667ab60cbb",
];
const EMPTY = ["official_12_sec_company_financials_ambiguous_facts_0440a6946c"];

const entries: [CatalogInput, CatalogEntry][] = LIST.map((d) => [d, describeDataset(d)]);
const byId = new Map(LIST.map((d) => [d.id, d]));

function canonical(d: CatalogInput): string {
  const v = (x: unknown) => (x === null || x === undefined ? "^" : String(x));
  return [d.id, d.name, d.sector, d.agency, v(d.source_id), v(d.source_url), d.grain, v(d.rows), v(d.retrieved_at)].join("|");
}

describe("the production list", () => {
  it("is the verified copy of 1,059 datasets", () => {
    expect(LIST).toHaveLength(1059);
    expect(fixture.count).toBe(1059);
    expect(new Set(LIST.map((d) => d.id)).size).toBe(1059);
    const ordered = [...LIST].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const digest = createHash("md5").update(ordered.map(canonical).join("\n"), "utf8").digest("hex");
    expect(digest).toBe(fixture.md5);
  });

  it("maps every dataset to a listed publisher and a listed collection", () => {
    const publisherIds = new Set(PUBLISHERS.map((p) => p.id));
    const collectionIds = new Set(COLLECTIONS.map((c) => c.id));
    for (const [d, e] of entries) {
      expect(publisherIds.has(e.publisher.id), `${d.id}: ${d.agency}`).toBe(true);
      expect(collectionIds.has(e.collection.id), d.id).toBe(true);
      expect(e.collection.blurb.length).toBeGreaterThan(0);
    }
    const usedPublishers = new Set(entries.map(([, e]) => e.publisher.id));
    expect(PUBLISHERS.filter((p) => !usedPublishers.has(p.id)).map((p) => p.id)).toEqual([]);
    const usedCollections = new Set(entries.map(([, e]) => e.collection.id));
    expect(COLLECTIONS.filter((c) => !usedCollections.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it("says via FRED exactly for the copies the St. Louis Fed republishes", () => {
    for (const [d, e] of entries) {
      const copy = / via Federal Reserve Bank of St\. Louis/.test(d.agency) && e.publisher.id !== "stlouisfed";
      expect(e.publisher.via === "FRED", d.id).toBe(copy);
    }
  });

  it("shows no long dash, no underscore and no bare file stem outside the counted untitled list", () => {
    const untitled: string[] = [];
    for (const [d, e] of entries) {
      expect(e.title, d.id).not.toMatch(/[‒-―]/);
      expect(e.title, d.id).not.toMatch(/_/);
      expect(e.title.trim(), d.id).toBe(e.title);
      expect(e.title.length, d.id).toBeGreaterThan(0);
      if (isBareName(e.title)) {
        untitled.push(d.id);
        expect(e.titleSource, `${d.id} has a listing but a bare title`).toBeUndefined();
      }
    }
    expect(untitled).toHaveLength(UNTITLED);
  });

  it("has a listing address for every generated title, and only for datasets that exist", () => {
    for (const [id, t] of Object.entries(TITLES)) {
      expect(byId.has(id), id).toBe(true);
      expect(t.source, id).toMatch(/^https:\/\/[^\s]+$/);
      expect(t.title.trim().length, id).toBeGreaterThan(0);
      expect(t.title, id).not.toMatch(/[‒-―_]/);
    }
    for (const [d, e] of entries) {
      if (TITLES[d.id]) expect(e.titleSource, d.id).toBe(TITLES[d.id].source);
      else expect(e.titleSource, d.id).toBeUndefined();
    }
  });

  it("points every projection and derived table at a parent that exists", () => {
    for (const [d, e] of entries) {
      if (!e.parentId) continue;
      expect(["projection", "derived"], d.id).toContain(e.kind);
      expect(e.parentId, d.id).not.toBe(d.id);
      const parent = byId.get(e.parentId);
      expect(parent, `${d.id} -> ${e.parentId}`).toBeDefined();
      expect(describeDataset(parent!).kind, e.parentId).not.toBe("internal");
    }
    for (const id of RELATION_IDS) expect(byId.has(id), id).toBe(true);
  });

  it("hides exactly the kit's sheets, the quarantined tables and the empty table", () => {
    const hidden = entries.filter(([, e]) => e.hiddenByDefault).map(([d]) => d.id).sort();
    const expected = [
      ...LIST.filter((d) => d.sector === "14_source_atlas").map((d) => d.id),
      ...QUARANTINED,
      ...EMPTY,
    ].sort();
    expect(expected).toHaveLength(23);
    expect(hidden).toEqual(expected);
    for (const id of QUARANTINED) expect(byId.get(id)?.rows ?? null).toBeNull();
  });

  it("finds the three FHFA subsets cut from the older master file, and no other stale child", () => {
    const stale = entries
      .filter(([d, e]) => e.parentId && staleAgainstParent(d, byId.get(e.parentId)!))
      .map(([d]) => d.id)
      .sort();
    expect(stale).toEqual([
      "official_11_real_estate_hpi_latest_by_series_289003ca07",
      "official_11_real_estate_metro_purchase_only_d40ac9ae79",
      "official_11_real_estate_national_and_state_c21c1607a1",
    ]);
  });

  it("attaches each audit issue to a dataset that exists, in one sentence", () => {
    let count = 0;
    for (const [d, e] of entries) {
      for (const issue of e.issues) {
        count += 1;
        expect(issue.text, d.id).toMatch(/^[A-Z].*\.$/);
        expect(issue.text, d.id).not.toMatch(/[‒-―]/);
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});
