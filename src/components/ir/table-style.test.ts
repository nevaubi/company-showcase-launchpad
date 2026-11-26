import { describe, expect, it } from "vitest";
import {
  BLANK,
  GUTTER,
  INDENT,
  basisTag,
  isBlank,
  isRatioLine,
  labelStyle,
  levelClass,
  notePrinted,
  splitMark,
  stripes,
  totalKinds,
} from "./table-style";

const line = (label: string, depth = 1, total = false) => ({ kind: "line" as const, label, depth, total });
const head = { kind: "head" as const, depth: 0 };
const gap = { kind: "gap" as const };

describe("total kinds", () => {
  it("makes the top-level total that closes the table a grand total and other totals subtotals", () => {
    const rows = [
      line("Interest income"),
      line("Interest expense"),
      line("Net interest income", 0, true),
      line("Total net revenue", 0, true),
      line("Net income", 0, false),
      line("Total loans", 0, true),
    ];
    expect(totalKinds(rows)).toEqual(["none", "none", "sub", "sub", "none", "grand"]);
  });

  it("keeps a nested total that closes the table a subtotal, and a lone line plain", () => {
    expect(totalKinds([line("A", 0), line("B", 2), line("Total B", 1, true)])).toEqual(["none", "none", "sub"]);
    expect(totalKinds([line("Total net revenue", 0, true)])).toEqual(["none"]);
  });

  it("follows printed marks when the data carries them, never the label", () => {
    const rows = [
      { ...line("Total net revenue", 0, true), rule: "double" as const },
      { ...line("Net income", 0), bold: true },
      { ...line("Revenue", 0), rule: "single" as const },
      line("Net income", 0),
    ];
    expect(totalKinds(rows)).toEqual(["grand", "sub", "sub", "none"]);
  });

  it("reads past headings and spacers", () => {
    expect(totalKinds([head, line("Cash", 0), gap, line("Total assets", 0, true)])).toEqual([
      "none",
      "none",
      "none",
      "grand",
    ]);
  });

  it("calls ratio, percentage, basis-point and per-share lines ratios", () => {
    expect(["pct", "ratio", "bps", "usd", "count"].map((u) => isRatioLine(u, false))).toEqual([true, true, true, false, false]);
    expect(isRatioLine("usd", true)).toBe(true);
  });
});

describe("stripes", () => {
  it("bands every other line of a block and starts again after a heading or spacer", () => {
    expect(stripes([line("a"), line("b"), line("c"), head, line("d"), line("e"), gap, line("f"), line("g")])).toEqual([
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });
});

describe("levels", () => {
  it("maps depth to one of four classes", () => {
    expect([-1, 0, 1, 2, 3, 7].map(levelClass)).toEqual(["irt-l0", "irt-l0", "irt-l1", "irt-l2", "irt-l3", "irt-l3"]);
  });

  it("indents by level and draws one guide per ancestor from the second level down", () => {
    expect(labelStyle(0)).toEqual({ paddingLeft: GUTTER });
    expect(labelStyle(1)).toEqual({ paddingLeft: GUTTER + INDENT });
    const two = labelStyle(2) as Record<string, string | number>;
    expect(two.paddingLeft).toBe(GUTTER + 2 * INDENT);
    expect(two.backgroundPosition).toBe(`${GUTTER + INDENT / 2}px 0`);
    const three = labelStyle(3) as Record<string, string | number>;
    expect(String(three.backgroundImage).split("linear-gradient").length - 1).toBe(2);
    expect(three.backgroundPosition).toBe(`${GUTTER + INDENT / 2}px 0, ${GUTTER + INDENT * 1.5}px 0`);
  });
});

describe("figures", () => {
  it("sets the unit mark apart from the figure", () => {
    expect(splitMark("12.5%", "%")).toEqual(["12.5", "%"]);
    expect(splitMark("(0.4)%", "%")).toEqual(["(0.4)", "%"]);
    expect(splitMark("14 bps", " bps")).toEqual(["14", " bps"]);
    expect(splitMark("1,234", "")).toEqual(["1,234", ""]);
    expect(splitMark("%", "%")).toEqual(["%", ""]);
  });

  it("tells a cell its own table leaves empty from a period no document prints", () => {
    const tables = new Map<string, Set<string>>();
    notePrinted(tables, 4, [3, 10, 2], "2026-09-30");
    notePrinted(tables, 4, { p: 1, b: [0] }, "2025-12-31"); // a slide figure has no table
    notePrinted(tables, undefined, [3, 1, 1], "2025-06-30");
    expect(isBlank([4, 3, 12], "2026-09-30", tables)).toBe(true);
    expect(isBlank([4, 3, 12], "2025-12-31", tables)).toBe(false);
    expect(isBlank([5, 3, 12], "2026-09-30", tables)).toBe(false);
    expect(isBlank(undefined, "2026-09-30", tables)).toBe(false);
    expect(BLANK).toBe(" ");
  });
});

describe("basis tags", () => {
  it("labels restated and older-basis lines only", () => {
    expect(basisTag("Net revenue (restated)")).toBe("Restated");
    expect(basisTag("Total deposits, as previously reported")).toBe("As previously reported");
    expect(basisTag("Net interest income, prior basis")).toBe("Older basis");
    expect(basisTag("Managed basis net revenue")).toBeNull();
  });
});
