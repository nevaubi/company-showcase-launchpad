import { describe, expect, it } from "vitest";
import { boxLabel, boxTextWidth, displayName, fitBox, fitLines, textWidth } from "./name-fit";
import { cardNameLines, groupCardHeight, NET, cardNameWidth } from "./network-layout";
import type { NetCard } from "./network-layout";

/* a cut ends with "…" right after a whole word of the name, never inside one */
const cutAtWord = (full: string, lines: string[]) => {
  const shown = lines.join(" ");
  if (!shown.endsWith("…")) return shown === full;
  const kept = shown.slice(0, -1).trim();
  return full.split(/\s+/).some((_, i, ws) => ws.slice(0, i + 1).join(" ") === kept);
};

describe("displayName", () => {
  it("uses the coverage list's short name for a covered company and drops the legal tail otherwise", () => {
    expect(displayName("Hewlett Packard Enterprise Company", "HPE")).toBe(
      "Hewlett Packard Enterprise",
    );
    expect(displayName("HP Inc.", "HPQ")).toBe("HP");
    expect(displayName("Taiwan Semiconductor Manufacturing Co., Ltd.", null)).toBe(
      "Taiwan Semiconductor Manufacturing",
    );
  });
});

describe("fitLines", () => {
  it("keeps a name that fits whole, on as few lines as it needs", () => {
    expect(fitLines("Micron", 100, 2, 13)).toEqual({
      lines: ["Micron"],
      cut: false,
      wordTooLong: false,
    });
    const two = fitLines(
      "Brookfield Asset Management",
      textWidth("Brookfield Asset", 13) + 2,
      2,
      13,
    );
    expect(two).toEqual({
      lines: ["Brookfield Asset", "Management"],
      cut: false,
      wordTooLong: false,
    });
  });
  it("cuts after a whole word with an ellipsis when two lines are not enough (review p5-shots M8)", () => {
    const names = [
      "Samsung Electronics Co., Ltd. Semiconductor Division",
      "Taiwan Semiconductor Manufacturing Company Limited",
      "Hon Hai Precision Industry Co., Ltd.",
    ];
    for (const name of names) {
      for (const w of [70, 90, 110, 140]) {
        /* at 70 px "Semiconductor" is wider than a line by itself: reported, so a chain box sets it smaller */
        const f = fitLines(name, w, 2, 13);
        expect(f.lines.length).toBeLessThanOrEqual(2);
        if (!f.wordTooLong) expect(cutAtWord(name, f.lines)).toBe(true);
        for (const l of f.lines)
          if (!f.wordTooLong) expect(textWidth(l, 13)).toBeLessThanOrEqual(w);
      }
    }
  });
});

describe("fitBox", () => {
  it("sets a single long word smaller instead of breaking it ('NBCUniver / sal' in review p5-shots)", () => {
    const w = textWidth("NBCUniversal", 11) + 1;
    const f = fitBox("NBCUniversal", w, 2);
    expect(f.px).toBe(11);
    expect(f.lines).toEqual(["NBCUniversal"]);
  });
  it("puts a long name on two lines at full size when its words fit", () => {
    const f = fitBox("Taiwan Semiconductor Manufacturing", 140, 2);
    expect(f.px).toBe(11);
    expect(f.lines.length).toBe(2);
    expect(cutAtWord("Taiwan Semiconductor Manufacturing", f.lines)).toBe(true);
  });
});

describe("network cards", () => {
  const card = (name: string, ticker: string | null): NetCard =>
    ({
      key: name,
      node: { name, ticker } as NetCard["node"],
      relation: "partner",
      hop: 1,
      x: 0,
      y: 0,
      w: 172,
      h: NET.card,
      share: null,
      dollars: null,
      trade: false,
    }) as unknown as NetCard;
  it("gives every card of a group two lines when one name needs them, so the grid stays even", () => {
    const shot = [
      card("Brookfield Asset Management", "BAM"),
      card("Cirrus Logic", "CRUS"),
      card("Intel", "INTC"),
    ];
    expect(cardNameLines(shot[0].node, 172, false)).toEqual(["Brookfield Asset", "Management"]);
    expect(groupCardHeight(shot, 172, false)).toBe(NET.cardTall);
    expect(groupCardHeight([card("Intel", "INTC"), card("AMD", "AMD")], 172, false)).toBe(NET.card);
  });
  it("keeps the figure's room in a flow column only for a card that can show a figure", () => {
    const name = "Taiwan Semiconductor Manufacturing Co., Ltd.";
    const plain = {
      ...card(name, null),
      node: { name, ticker: null, links: [] },
    } as unknown as NetCard;
    const withShare = {
      ...plain,
      node: { name, ticker: null, links: [{ id: "l1", share_pct: 16.3 }] },
    } as unknown as NetCard;
    /* 336 px is the flow column at a 1280 px page: the name alone fits one line, beside a figure it needs two */
    expect(cardNameLines(plain.node, 336, false)).toEqual(["Taiwan Semiconductor Manufacturing"]);
    expect(cardNameLines(plain.node, 336, true)).toEqual(["Taiwan Semiconductor", "Manufacturing"]);
    expect(groupCardHeight([plain], 336, true)).toBe(NET.card);
    expect(groupCardHeight([withShare], 336, true)).toBe(NET.cardTall);
    expect(groupCardHeight([plain, withShare], 336, true)).toBe(NET.cardTall);
  });
  it("shows the names the review found cut whole on two lines at the shot's card width", () => {
    for (const [name, t] of [
      ["Hewlett Packard Enterprise", "HPE"],
      ["Marvell Technology", "MRVL"],
      ["Brookfield Asset Management", "BAM"],
      ["ExlService Holdings", "EXLS"],
    ] as const) {
      const lines = cardNameLines({ name, ticker: t }, 172, false);
      expect(lines.join(" ")).not.toContain("…");
      expect(cardNameWidth(172, false)).toBeGreaterThan(0);
    }
  });
});

describe("boxLabel (chain boxes, 107 px wide at 1440 in the kit)", () => {
  const room = boxTextWidth(107, false);
  it("keeps the ticker line under a name that fits one line", () => {
    expect(boxLabel("Rambus", "RMBS", room)).toEqual({
      lines: ["Rambus"],
      px: 12,
      ticker: true,
      cut: false,
    });
  });
  it("gives a long name up to three lines, whole words only, instead of 'Hewlett ...' or 'NBCUniver / sal'", () => {
    for (const [name, t] of [
      ["Hewlett Packard Enterprise", "HPE"],
      ["DigitalOcean Holdings", "DOCN"],
      ["Akamai Technologies", "AKAM"],
      ["NBCUniversal", null],
    ] as const) {
      const f = boxLabel(name, t, room);
      expect(f.cut).toBe(false);
      expect(f.lines.join(" ")).toBe(name);
      expect(f.lines.length).toBeLessThanOrEqual(3);
    }
  });
  it("cuts a name too long even for three lines after a whole word, and never inside one", () => {
    const f = boxLabel("Taiwan Semiconductor Manufacturing", "TSM", room);
    expect(f.cut).toBe(true);
    expect(f.lines[f.lines.length - 1].endsWith("…")).toBe(true);
    const kept = f.lines.join(" ").slice(0, -1);
    expect(["Taiwan", "Taiwan Semiconductor", "TSM"]).toContain(kept === "TS" ? "TSM" : kept);
  });
});
