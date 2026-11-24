import { describe, expect, it } from "vitest";
import { badgeLogo } from "./badge-logo";

/* tickers read from src/lib/logos.generated.ts: AAPL a square mark, AADX a square tile, HPE and ABBV wide wordmarks
   without a site icon, AEO a wide mark with an icon, ABNB a wide mark whose icon is a tile */
describe("globe badge marks", () => {
  it("a square mark is drawn as it is, a tile fills the plate", () => {
    expect(badgeLogo("AAPL", undefined)).toEqual({ logo: "/logos/AAPL.svg", trusted: true, fill: false });
    expect(badgeLogo("AADX", undefined)).toMatchObject({ trusted: true, fill: true });
  });
  it("a wide wordmark is never squeezed into a badge: the site icon, else the letter plate", () => {
    expect(badgeLogo("HPE", undefined)).toEqual({ trusted: false, fill: false });
    expect(badgeLogo("ABBV", "https://img.logo.dev/abbvie.com")).toEqual({ trusted: false, fill: false });
    expect(badgeLogo("AEO", undefined)).toEqual({ logo: "/logos/icons/AEO.png", trusted: true, fill: false });
    expect(badgeLogo("ABNB", undefined)).toEqual({ logo: "/logos/icons/ABNB.png", trusted: true, fill: true });
  });
  it("a name without a bundled mark keeps its domain logo, untrusted", () => {
    expect(badgeLogo(null, "https://img.logo.dev/tsmc.com")).toEqual({ logo: "https://img.logo.dev/tsmc.com", trusted: false, fill: false });
    expect(badgeLogo(null, undefined)).toEqual({ logo: undefined, trusted: false, fill: false });
  });
});
