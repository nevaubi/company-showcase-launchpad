import { describe, expect, it } from "vitest";
import { decodeEntities } from "./format";
describe("decodeEntities", () => {
  it("decodes named and numeric entities and leaves plain text alone", () => {
    expect(decodeEntities("EVP &amp; Chief Financial Officer")).toBe(
      "EVP & Chief Financial Officer",
    );
    expect(decodeEntities("A &#38; B &#x26; C")).toBe("A & B & C");
    expect(decodeEntities("AT&T")).toBe("AT&T");
    expect(decodeEntities(null)).toBe("");
  });
});
