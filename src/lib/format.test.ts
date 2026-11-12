import { describe, expect, it } from "vitest";
import { decodeEntities, humanizeDates, ordinal } from "./format";
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

describe("ordinal", () => {
  it("ends 1, 2 and 3 correctly, and the teens with th", () => {
    expect([0, 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 72, 100, 101, 111].map(ordinal)).toEqual(
      ["0th", "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "72nd", "100th", "101st", "111th"],
    );
  });
});

describe("humanizeDates", () => {
  it("rewrites ISO dates in a sentence", () => {
    expect(humanizeDates("NVDA shares fell 16.3% from 2026-10-06 to 2026-11-04.")).toBe("NVDA shares fell 16.3% from Oct 6, 2026 to Nov 4, 2026.");
  });
  it("leaves accession numbers, ranges of digits and impossible dates alone", () => {
    expect(humanizeDates("Filing 0001045810-26-000010 and code 2026-13-40 and id x-2026-10-06")).toBe("Filing 0001045810-26-000010 and code 2026-13-40 and id x-2026-10-06");
  });
});
