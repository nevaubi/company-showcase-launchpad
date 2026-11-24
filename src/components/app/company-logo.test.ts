import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVERAGE } from "@/lib/coverage";
import { LOGO_FILES, LOGO_TILES } from "@/lib/logos.generated";
import { build, inkRatio, isTile, logoManifest, logoWide, pngCorners, WIDE_RATIO, type Measured } from "../../../scripts/logo-manifest";
import { isLogoTile, isWideLogo, logoChoice, logoIconUrl, logoUrl, widePlate } from "./company-logo";

/** the marks themselves: public/logos also holds sources.json, aspect.json and the icons folder */
const files = readdirSync("public/logos").filter((f) => /\.(svg|png|jpe?g|webp)$/i.test(f));
const aspect = JSON.parse(readFileSync("public/logos/aspect.json", "utf8")) as Record<string, Measured>;
const iconFiles = readdirSync("public/logos/icons");
const bytes = (f: string) => new Uint8Array(readFileSync(`public/logos/${f}`));

describe("bundled company logos", () => {
  /**
   * Covered companies that show initials on purpose: the bundled file was another company's mark or a shared
   * placeholder, and none of the company's own SEC filings carries a mark that can be cut out cleanly
   * (logo audit, November 2026). A wrong logo is worse than initials. Add a file only from the company's own
   * material, then take the ticker off this list.
   */
  const INITIALS_ON_PURPOSE = ["HNGE", "WAT", "XXI"];

  it("the generated manifest matches public/logos (rerun bun scripts/logo-manifest.ts after adding a logo)", () => {
    expect(readFileSync("src/lib/logos.generated.ts", "utf8")).toBe(build());
  }, 60_000); // reads and hashes every file: slow on a loaded machine

  it("resolves every listed ticker to a file that exists", () => {
    const onDisk = new Set(files);
    const listed = Object.entries(LOGO_FILES).flatMap(([ext, list]) => list.split(" ").map((t) => ({ t, ext })));
    expect(listed.length).toBeGreaterThanOrEqual(COVERAGE.length - INITIALS_ON_PURPOSE.length);
    for (const { t, ext } of listed) {
      expect(logoUrl(t)).toBe(`/logos/${t}.${ext}`);
      expect(onDisk.has(`${t}.${ext}`)).toBe(true);
    }
  });

  it("is case-insensitive and returns nothing for a company without a bundled mark", () => {
    expect(logoUrl("aapl")).toBe("/logos/AAPL.svg");
    expect(logoUrl("LIN")).toBe("/logos/LIN.png");
    expect(logoUrl("BRK-B")).toMatch(/^\/logos\/BRK-B\.(svg|png|jpg)$/);
    expect(logoUrl("NOT-A-TICKER")).toBeUndefined();
  });

  it("reads the corners of each kind of PNG the folder holds", () => {
    // 8-bit RGBA, transparent canvas
    const adam = pngCorners(bytes("ADAM.png"))!;
    expect([adam.width, adam.height]).toEqual([190, 140]);
    for (const c of adam.corners) expect(c[3]).toBe(0);
    // 4-bit palette, purple tile
    const aaoi = pngCorners(bytes("AAOI.png"))!;
    expect([aaoi.width, aaoi.height]).toEqual([256, 256]);
    for (const c of aaoi.corners) expect(c).toEqual([92, 70, 143, 255]);
    // 8-bit greyscale, black tile
    for (const c of pngCorners(bytes("ACGL.png"))!.corners) expect(c).toEqual([0, 0, 0, 255]);
    // interlaced: not covered, so never called a tile
    expect(pngCorners(bytes("HONA.png"))).toBeNull();
    // 8-bit RGB without alpha, white canvas
    for (const c of pngCorners(bytes("AAL.png"))!.corners) expect(c[3]).toBe(255);
    // a GIF saved under a .png name, and bytes that are not an image at all
    expect(pngCorners(bytes("ACAD.png"))).toBeNull();
    expect(pngCorners(new Uint8Array(64))).toBeNull();
  });

  it("calls a mark a tile only when it paints its own square, non-white background", () => {
    const px = (r: number, g: number, b: number, a = 255): [number, number, number, number] => [r, g, b, a];
    const four = (c: [number, number, number, number]) => [c, c, c, c];
    expect(isTile({ width: 256, height: 256, corners: four(px(0, 0, 0)) })).toBe(true);
    expect(isTile({ width: 256, height: 256, corners: four(px(240, 243, 250)) })).toBe(true);
    expect(isTile({ width: 256, height: 256, corners: four(px(255, 255, 255)) })).toBe(false); // white canvas: blends into the plate
    expect(isTile({ width: 256, height: 256, corners: four(px(0, 0, 0, 0)) })).toBe(false); // transparent canvas
    expect(isTile({ width: 300, height: 39, corners: four(px(20, 40, 90)) })).toBe(false); // a banner, not a square
    expect(isTile({ width: 256, height: 256, corners: [px(0, 0, 0), px(0, 0, 0), px(0, 0, 0), px(200, 30, 30)] })).toBe(false); // artwork reaching one corner
    expect(isTile(null)).toBe(false);
    expect(isLogoTile("aaoi")).toBe(true);
    expect(isLogoTile("AAPL")).toBe(false);
    expect(isLogoTile("ADAM")).toBe(false);
    // every listed tile is a bundled PNG
    for (const t of LOGO_TILES.split(" ")) expect(logoUrl(t), t).toBe(`/logos/${t}.png`);
  });

  it("has a mark for every covered company except those that show initials on purpose", () => {
    const missing = COVERAGE.map((c) => c.ticker).filter((t) => !logoUrl(t));
    expect(missing.sort()).toEqual([...INITIALS_ON_PURPOSE].sort());
  });

  it("never gives two companies the same file (a shared file is a placeholder or a borrowed mark)", () => {
    const byHash = new Map<string, string[]>();
    for (const f of files) {
      const h = createHash("sha1").update(bytes(f)).digest("hex");
      byHash.set(h, [...(byHash.get(h) ?? []), f]);
    }
    expect([...byHash.values()].filter((list) => list.length > 1)).toEqual([]);
  });

  it("records where every bundled mark came from", () => {
    const sources = JSON.parse(readFileSync("public/logos/sources.json", "utf8")) as Record<string, { file: string; source: string; url: string }>;
    const marks = files;
    expect(Object.keys(sources).length).toBe(marks.length);
    for (const f of marks) {
      const entry = sources[f.slice(0, f.lastIndexOf("."))];
      expect(entry?.file, f).toBe(f);
      expect(entry.source.length, f).toBeGreaterThan(0);
    }
    // the seven marks added in round 3 come from each company's own site, never a logo directory
    for (const t of ["ADAM", "BRVE", "CSQR", "IOND", "MSGK", "STDN", "USLM"]) expect(sources[t].url, t).toMatch(/^https:\/\//);
  });
});

describe("wide marks", () => {
  it("measures every bundled file, from its current bytes (remeasure after adding or replacing a mark)", () => {
    for (const f of files) expect(aspect[f]?.sha256, f).toBe(createHash("sha256").update(bytes(f)).digest("hex"));
  }, 60_000);

  it("lists Lockheed Martin's wordmark as wide and the near-square marks of Apple, Microsoft and Intel as not", () => {
    expect(isWideLogo("LMT")).toBe(true);
    expect(inkRatio(aspect["LMT.svg"])).toBeGreaterThan(5);
    for (const t of ["AAPL", "MSFT", "INTC"]) expect(isWideLogo(t), t).toBe(false);
    // Intel's wordmark sits just under the line, which is why the line is where it is
    expect(inkRatio(aspect["INTC.svg"])).toBeLessThan(WIDE_RATIO);
  });

  it("uses the ink box, not the file's canvas: a wordmark padded onto a square canvas is still wide", () => {
    const m = (box: number, crop: [number, number, number, number]): Measured => ({ sha256: "", box, crop });
    const manifest = { svg: ["PAD", "SQ"] };
    const wide = logoWide(manifest, { "PAD.svg": m(1, [0, 0.4, 1, 0.6]), "SQ.svg": m(4, [0.375, 0, 0.625, 1]) });
    expect(wide).toEqual(["PAD:5.00:0:40:100:60"]);
  });

  it("gives a wide mark a wide plate in the large sizes, sized from the manifest", () => {
    const lmt = logoChoice("LMT", "lg");
    expect(lmt.kind).toBe("wide");
    if (lmt.kind !== "wide") return;
    expect(lmt.plate).toBe(3);
    // 48 px plate, 6 px padding, 1 px border: the ink box is 34 px tall at most and 3 x 34 wide at most
    expect(widePlate(48, 6, lmt.ratio)).toEqual({ width: 116, inkW: 102, inkH: Math.round(102 / lmt.ratio) });
    expect(widePlate(48, 6, 2.8)).toEqual({ width: 109, inkW: 95, inkH: 34 });
    expect(logoChoice("AAPL", "xl")).toEqual({ kind: "mark", url: "/logos/AAPL.svg", tile: false });
  });

  it("draws in small tiles the company's own square icon, else the letters, and never the squeezed wordmark", () => {
    // a square mark is drawn as it is
    expect(logoChoice("AAPL", "xs")).toEqual({ kind: "mark", url: "/logos/AAPL.svg", tile: false });
    // a wide mark with a collected site icon
    expect(logoChoice("LMT", "sm")).toMatchObject({ kind: "icon", url: "/logos/icons/LMT.png" });
    // a wide mark without one (oracle.com refused the request): letters
    expect(isWideLogo("ORCL")).toBe(true);
    expect(logoIconUrl("ORCL")).toBeUndefined();
    for (const size of ["2xs", "xs", "sm", "md"] as const) expect(logoChoice("ORCL", size)).toEqual({ kind: "letters" });
    // outside coverage the caller's URL is still used
    expect(logoChoice("NOT-COVERED", "sm", "https://example.com/x.png")).toEqual({ kind: "mark", url: "https://example.com/x.png", tile: false });
  });

  it("keeps only square icons of at least 64 px, each recorded with the page that declared it and its hash", () => {
    const sources = JSON.parse(readFileSync("public/logos/sources.json", "utf8")) as Record<string, { icon?: { file: string; page: string; url: string; px: [number, number]; sha256: string } }>;
    expect(iconFiles.length).toBeGreaterThan(100);
    const seen = new Set<string>();
    for (const f of iconFiles) {
      const t = f.slice(0, -4);
      expect(isWideLogo(t), `${t} has an icon but no wide mark`).toBe(true);
      const info = pngCorners(new Uint8Array(readFileSync(`public/logos/icons/${f}`)));
      expect(info, f).not.toBeNull();
      expect(info!.width, f).toBe(info!.height);
      expect(info!.width, f).toBeGreaterThanOrEqual(64);
      const icon = sources[t]?.icon;
      expect(icon?.file, f).toBe(`icons/${f}`);
      expect(icon!.page, f).toMatch(/^https?:\/\//);
      expect(icon!.sha256, f).toBe(createHash("sha256").update(readFileSync(`public/logos/icons/${f}`)).digest("hex"));
      expect(seen.has(icon!.sha256), `${f} shares its bytes with another icon`).toBe(false);
      seen.add(icon!.sha256);
    }
  });
});
