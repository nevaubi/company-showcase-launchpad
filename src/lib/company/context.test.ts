import { describe, expect, it } from "vitest";
import { bestWindows, nameIn, numberIn, photoFromMarkdown, rankPeople, usableImage, type Person } from "./context";

const src = { accn: "a", doc: "d", form: "10-K", filed: "2026-01-01" };
const p = (name: string, title: string, group: Person["group"], extra: Partial<Person> = {}): Person => ({ name, title, group, quote: name, source: src, ...extra });

describe("company context", () => {
  it("matches names with middle initials", () => {
    expect(nameIn("Timothy Cook", "Timothy D. Cook, Chief Executive Officer")).toBe(true);
    expect(nameIn("Timothy Cook", "Tim Apple")).toBe(false);
  });

  it("finds pay totals with or without commas, not inside bigger numbers", () => {
    expect(numberIn(74609802, "Total | $ 74,609,802 |")).toBe(true);
    expect(numberIn(74609802, "Total 74609802")).toBe(true);
    expect(numberIn(609802, "Total 74,609,802")).toBe(false);
  });

  it("rejects logos, maps and thumbnails", () => {
    expect(usableImage("File:Apple Park.jpg", 2000, 1200)).toBe(true);
    expect(usableImage("File:Apple logo black.svg", 2000, 2000)).toBe(false);
    expect(usableImage("File:HQ map.jpg", 2000, 1200)).toBe(false);
    expect(usableImage("File:Small.jpg", 300, 200)).toBe(false);
  });

  it("only takes a leadership photo sitting next to the person's name", () => {
    const md = "## Leadership\n![Jane Roe](https://img.acme.com/roe.jpg)\nJane Roe, CFO\n\n![](https://cdn.other.com/x.jpg) John Doe";
    expect(photoFromMarkdown(md, "Jane Roe", "https://www.acme.com/leadership")).toBe("https://img.acme.com/roe.jpg");
    expect(photoFromMarkdown(md, "Mary Major", "https://www.acme.com/leadership")).toBeUndefined();
  });

  it("puts the CEO on top and the board chair first", () => {
    const r = rankPeople([
      p("A", "Senior Vice President, Retail", "executive"),
      p("B", "Chief Financial Officer", "executive"),
      p("C", "Chief Executive Officer", "executive"),
      p("D", "Director", "board", { independent: true }),
      p("E", "Chair", "board", { chair: true, independent: true }),
    ]);
    expect(r.ceo?.name).toBe("C");
    expect(r.executives.map((x) => x.name)).toEqual(["B", "A"]);
    expect(r.board[0].name).toBe("E");
  });

  it("prefers the dense section over the table-of-contents mention", () => {
    const t = "Executive Officers ..... 12\n" + "x".repeat(500) + "Executive Officers\nJane Roe Age 50 since 2019. John Doe Age 60 since 2015.";
    expect(bestWindows(t, /Executive Officers/i, 200, /\bage\b/, 1)[0]).toContain("Jane Roe");
  });
});
