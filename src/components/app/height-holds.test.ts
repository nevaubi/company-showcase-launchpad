import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");

/**
 * Files that may pin a height from script (`el.style.minHeight = ...`). A pinned height outlives the content it
 * was measured on unless something takes it off again, and a grid or flex column that is taller than its rows
 * spreads them apart. The Financials tab once pinned the Normalized view's height on its own root and kept it
 * on the next view: the view selector sat a third of the way down an empty page, under an empty band.
 *
 * A page that must not get shorter under the reader needs nothing of its own: the app shell's scroll floor
 * (scroll-floor.ts) already keeps the page as tall as where the reader is. Each file below states next to its
 * hold when the hold ends. A new entry needs that, and a reason the scroll floor is not enough.
 */
const HOLDERS: Record<string, string> = {
  "src/components/app/scroll-floor.ts":
    "the app shell's floor: set again on every scroll end, press and key, removed on unmount",
  "src/components/alt/hold-page.ts":
    "Alt data filters: cut back to what the reader's position needs on the next frame and on scroll",
  "src/components/company/hold-height.tsx":
    "Overview and Earnings panels across the read-time statement swap, until the page is left",
  "src/components/ir/financial-map.tsx":
    "the IR map's stage while one view leaves and the next mounts, for about 0.6 s at most",
  "src/components/supply/scroll-to.ts":
    "the supply-chain page's height after a company change, given back as the reader scrolls up",
  "src/components/supply/follow-panel.tsx":
    "room for the supply-chain side panel to stay beside its row; never grows during a scroll",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** `el.style.minHeight = ...`, `el.style.setProperty("min-height", ...)`, or a style writer called with "minHeight". */
const sets = (source: string) =>
  /\.style\.minHeight\s*=(?!=)|setProperty\(\s*["']min-height["']|["']minHeight["']\s*,/.test(
    source,
  );

describe("heights pinned from script", () => {
  it("only the listed helpers set a min-height by hand", () => {
    const offenders = files(join(ROOT, "src"))
      .map((p) => relative(ROOT, p))
      .filter((p) => !(p in HOLDERS))
      .filter((p) => sets(readFileSync(join(ROOT, p), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every listed helper exists and still pins a height, so the list cannot go stale", () => {
    for (const p of Object.keys(HOLDERS))
      expect(sets(readFileSync(join(ROOT, p), "utf8")), p).toBe(true);
  });

  it("the Financials tab holds no height of its own and packs its rows at the top", () => {
    const route = readFileSync(
      join(ROOT, "src/routes/_authenticated/app.companies.$ticker.financials.tsx"),
      "utf8",
    );
    expect(route).not.toMatch(/minHeight/);
    // Both of its page grids: Normalized, and the wrapper of the other four views. With the rows packed at the
    // top, a view under the selector is never given more height than it needs, so its own rows cannot spread.
    expect(route.match(/className="grid grid-cols-1 content-start gap-4"/g)).toHaveLength(2);
    expect(route).not.toMatch(/className="grid grid-cols-1 gap-4"/);
  });
});
