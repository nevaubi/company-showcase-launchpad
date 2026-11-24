import { describe, expect, it } from "vitest";
import { decodeEntities, fmtPrice, fmtValueLong, humanizeDates, ordinal } from "./format";
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
    expect([0, 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 72, 100, 101, 111].map(ordinal)).toEqual([
      "0th",
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "72nd",
      "100th",
      "101st",
      "111th",
    ]);
  });
});

describe("humanizeDates", () => {
  it("rewrites ISO dates in a sentence", () => {
    expect(humanizeDates("NVDA shares fell 16.3% from 2026-10-06 to 2026-11-04.")).toBe(
      "NVDA shares fell 16.3% from Oct 6, 2026 to Nov 4, 2026.",
    );
  });
  it("leaves accession numbers, ranges of digits and impossible dates alone", () => {
    expect(
      humanizeDates("Filing 0001045810-26-000010 and code 2026-13-40 and id x-2026-10-06"),
    ).toBe("Filing 0001045810-26-000010 and code 2026-13-40 and id x-2026-10-06");
  });
});

describe("negative amounts", () => {
  it("puts a true minus before the currency mark in a price", () => {
    expect(fmtPrice(27.18)).toBe("$27.18");
    expect(fmtPrice(-27.18)).toBe("−$27.18");
    expect(fmtPrice(-1234.5)).toBe("−$1,234.50");
    expect(fmtPrice(-0.001)).toBe("$0.00");
    expect(fmtPrice(null)).toBe("–");
  });

  it("puts a true minus before a long value in every unit, never a hyphen after the dollar sign", () => {
    // the public company page printed "$-27.18 per share" for a loss year
    expect(fmtValueLong(-27.18, "usdPerShare")).toBe("−$27.18 per share");
    expect(fmtValueLong(-1_519_000_000, "usd")).toBe("−$1,519,000,000");
    expect(fmtValueLong(28.36, "usdPerShare")).toBe("$28.36 per share");
    expect(fmtValueLong(-1500, "shares")).toBe("−1,500 shares");
    expect(fmtValueLong(-0.25, "ratio")).toBe("−0.25×");
    expect(fmtValueLong(-12, "days")).toBe("−12 days");
    expect(fmtValueLong(-3.456, "other")).toBe("−3.46");
    expect(fmtValueLong(-0.004, "usdPerShare")).toBe("$0.00 per share");
    for (const unit of ["usd", "usdPerShare", "shares", "ratio", "days", "pct", "other"]) {
      expect(fmtValueLong(-42.5, unit)).not.toContain("-");
    }
  });
});
