import { describe, expect, it } from "vitest";
import { galleryBoards } from "@/lib/sources/boards/layout";
import { BOARDS } from "@/lib/sources/boards/specs";
import { collectionSlug } from "@/lib/sources/collections";
import { chartsSearch, chosenBoard, filterGallery, galleryKey, galleryName, gallerySummary, LANDING_KEY } from "./gallery";

const shownIds = (g: ReturnType<typeof filterGallery>) => g.flatMap((b) => b.sections.flatMap((s) => s.shown));

describe("the Charts page", () => {
  const boards = galleryBoards();
  const every = new Set(BOARDS.flatMap((b) => b.tiles));

  it("shows every chart of every board once, unfiltered, each section requested whole", () => {
    const all = filterGallery(boards, {});
    expect(all.map((b) => b.board.id)).toEqual(boards.map((b) => b.id));
    expect(shownIds(all)).toHaveLength(every.size);
    expect(new Set(shownIds(all))).toEqual(every);
    for (const b of all) for (const s of b.sections) expect(s.shown).toEqual(s.section.tiles.map((t) => t.id));
    expect(gallerySummary(all, undefined)).toBe(`${every.size} charts on ${boards.length} boards`);
  });

  it("keeps one board, by its collection's slug, an older form of it, or the stored id", () => {
    const housing = collectionSlug("11_real_estate");
    for (const c of [housing, "11_real_estate"]) expect(filterGallery(boards, { c }).map((b) => b.board.id)).toEqual(["11_real_estate"]);
    expect(chosenBoard(boards, housing)?.id).toBe("11_real_estate");
    expect(galleryKey("11_real_estate")).toBe(housing);
    expect(galleryKey("library")).toBe(LANDING_KEY);
    // a filter that names no board filters nothing
    expect(chosenBoard(boards, "no-such-collection")).toBeNull();
    expect(filterGallery(boards, { c: "no-such-collection" })).toHaveLength(boards.length);
  });

  it("keeps the charts whose title has every word asked for, dropping empty sections and boards, the section still whole", () => {
    const shown = filterGallery(boards, { q: "Mortgage rates" });
    const titles = shown.flatMap((b) => b.sections.flatMap((s) => s.section.tiles.filter((t) => s.shown.includes(t.id)).map((t) => t.title.toLowerCase())));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t.includes("mortgage") && t.includes("rates")).toBe(true);
    for (const b of shown) for (const s of b.sections) expect(s.shown.length).toBeGreaterThan(0);
    // the request of a section is the whole section, whatever the search keeps
    const full = new Map(boards.flatMap((b) => b.sections.map((s) => [`${b.id}:${s.title}`, s] as const)));
    for (const b of shown) for (const s of b.sections) expect(s.section).toBe(full.get(`${b.board.id}:${s.section.title}`));
    expect(filterGallery(boards, { q: "no chart has this title" })).toEqual([]);
    expect(gallerySummary(shown, " Mortgage rates ")).toMatch(/^\d+ charts? on \d+ boards?, with "Mortgage rates" in the title$/);
  });

  it("names a board by its collection", () => {
    expect(galleryName({ id: "00_universal", title: "Macro and rates" })).toBe("Economy");
    expect(galleryName({ id: "library", title: "What the data says" })).toBe("What the data says");
  });

  it("validates its search params", () => {
    expect(chartsSearch({ c: "housing", q: "  yields ", extra: 1 })).toEqual({ c: "housing", q: "  yields " });
    expect(chartsSearch({ c: "11_real_estate" })).toEqual({ c: "11_real_estate" });
    expect(chartsSearch({ c: "../x", q: "   " })).toEqual({});
    expect(chartsSearch({ q: "x".repeat(300) }).q).toHaveLength(120);
  });
});
