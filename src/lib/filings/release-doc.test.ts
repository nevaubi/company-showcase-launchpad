import { describe, expect, it } from "vitest";
import { pickReleaseExhibit, releaseIsExhibit } from "./release-doc";

describe("earnings release document", () => {
  it("knows a live-table release points at the 8-K, not the exhibit", () => {
    expect(releaseIsExhibit({ accn: "a", doc: "jpm-20261014.htm", title: "Earnings release (Form 8-K, Item 2.02)" })).toBe(false);
    expect(releaseIsExhibit({ accn: "a", doc: "ex991.htm", title: "Earnings release" }, "jpm-8k.htm")).toBe(true);
    expect(releaseIsExhibit({ accn: "a", doc: "jpm-8k.htm", title: "Earnings release" }, "jpm-8k.htm")).toBe(false);
  });

  it("picks Exhibit 99.1 from the filing index", () => {
    const docs = [
      { name: "jpm-8k.htm", type: "8-K" },
      { name: "ex992.htm", type: "EX-99.2" },
      { name: "ex991.htm", type: "EX-99.1" },
    ];
    expect(pickReleaseExhibit(docs)).toBe("ex991.htm");
    expect(pickReleaseExhibit([{ name: "a.htm", type: "8-K" }, { name: "pr.htm", type: "EX-99" }])).toBe("pr.htm");
    expect(pickReleaseExhibit([{ name: "a.htm", type: "8-K" }])).toBeNull();
  });
});
