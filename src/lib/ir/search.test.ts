import { describe, expect, it } from "vitest";
import { snippetParts } from "./search";

describe("snippetParts", () => {
  it("splits highlighted words", () => {
    expect(snippetParts("Total «backlog» rose to «$4.1B»")).toEqual([
      { text: "Total ", hit: false },
      { text: "backlog", hit: true },
      { text: " rose to ", hit: false },
      { text: "$4.1B", hit: true },
    ]);
  });
});
