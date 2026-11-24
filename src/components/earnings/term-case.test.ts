import { describe, expect, it } from "vitest";
import { termCasing } from "./term-case";

const texts = [
  "Services revenue reached an all-time record. iPhone Duo sold well, and the new iPhone Duo is in short supply.",
  "Gross margin was 47%. We saw strong demand for MacBook Neo. Our AI features, Apple Intelligence and AI tools, grew.",
  "Revenue grew. Revenue in services was up; gross margin expanded and revenue per user rose.",
];

describe("termCasing: a topic term as the call writes it", () => {
  const c = termCasing(["iphone duo", "macbook neo", "ai", "gross margin", "services", "revenue"], texts);
  it("keeps product and acronym casing the transcript uses", () => {
    expect(c.get("iphone duo")).toBe("iPhone Duo");
    expect(c.get("macbook neo")).toBe("MacBook Neo");
    expect(c.get("ai")).toBe("AI");
  });
  it("puts ordinary words in sentence case, ignoring capitals forced by a sentence start", () => {
    expect(c.get("gross margin")).toBe("Gross margin");
    expect(c.get("services")).toBe("Services");
    expect(c.get("revenue")).toBe("Revenue");
  });
  it("capitalises a term the transcript never contains", () => {
    expect(termCasing(["capital return"], texts).get("capital return")).toBe("Capital return");
  });
});
