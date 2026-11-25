import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AbsXmlError,
  createAbsReader,
  declaredEncoding,
  familyOf,
  readAbsText,
  type AbsRecord,
} from "./xml";

// Six records copied byte for byte from a real commercial mortgage asset file (see fixtures/abs/README.md).
const EXCERPT = readFileSync("src/test/fixtures/abs/cmbs-ex102-excerpt.xml", "utf8");
const NS = "http://www.sec.gov/edgar/document/absee/cmbs/assetdata";
const doc = (body: string, ns = NS) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<assetData xmlns="${ns}">${body}</assetData>`;

describe("abs asset file reader", () => {
  it("reads a real excerpt: records in file order, fields in field order, property blocks apart", () => {
    const { shape, records } = readAbsText(EXCERPT);
    expect(shape).toEqual({
      root: "assetData",
      namespace: NS,
      family: "cmbs",
      records: 6,
      tags: { assets: 6 },
      attributes: 0,
    });
    expect(records.map((r) => r.rec)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(records.map((r) => r.fields.find(([n]) => n === "assetNumber")?.[1])).toEqual([
      "3",
      "3A",
      "3B",
      "26",
      "26-001",
      "26-002",
    ]);
    expect(records[0].fields.slice(0, 4)).toEqual([
      ["assetTypeNumber", "Prospectus Loan ID"],
      ["assetNumber", "3"],
      ["reportingPeriodBeginningDate", "05-14-2024"],
      ["reportingPeriodEndDate", "06-11-2024"],
    ]);
    expect(records.map((r) => r.blocks.map((b) => b.name))).toEqual([
      ["property"],
      ["property"],
      ["property"],
      ["property"],
      ["property"],
      ["property"],
    ]);
    expect(records[4].blocks[0].fields.find(([n]) => n === "propertyName")?.[1]).toBe(
      "LA QUINTA INN BROWNWOOD",
    );
    // a property-only record states nothing about a loan
    expect(records[4].fields.map(([n]) => n)).toEqual([
      "assetTypeNumber",
      "assetNumber",
      "reportingPeriodBeginningDate",
      "reportingPeriodEndDate",
      "assetAddedIndicator",
    ]);
  });

  it("gives the same records however the text is cut into chunks", () => {
    const whole = readAbsText(EXCERPT).records;
    for (const step of [1, 7, 64, 4096]) {
      const got: AbsRecord[] = [];
      const reader = createAbsReader((r) => got.push(r));
      for (let i = 0; i < EXCERPT.length; i += step) reader.write(EXCERPT.slice(i, i + step));
      reader.close();
      expect(got, `chunks of ${step}`).toEqual(whole);
    }
  });

  it("hands each record over as soon as it ends, without waiting for the file", () => {
    const seen: number[] = [];
    const reader = createAbsReader((r) => seen.push(r.rec));
    const cut = EXCERPT.indexOf("</assets>") + "</assets>".length;
    reader.write(EXCERPT.slice(0, cut));
    expect(seen).toEqual([1]);
    expect(reader.shape().family).toBe("cmbs");
    reader.write(EXCERPT.slice(cut));
    reader.close();
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps text exactly: entities decoded, inner spaces kept, an empty field is an empty text", () => {
    const { records } = readAbsText(
      doc(
        "<assets><assetNumber>7</assetNumber><originatorName> A &amp; B &lt;Bank&gt; </originatorName><maturityDate/><x></x><property><propertyName>P &#38; Q</propertyName></property></assets>",
      ),
    );
    expect(records[0].fields).toEqual([
      ["assetNumber", "7"],
      ["originatorName", " A & B <Bank> "],
      ["maturityDate", ""],
      ["x", ""],
    ]);
    expect(records[0].blocks).toEqual([{ name: "property", fields: [["propertyName", "P & Q"]] }]);
  });

  it("names the asset class by the namespace, and counts attributes it would otherwise drop", () => {
    expect(familyOf("http://www.sec.gov/edgar/document/absee/autoloan/assetdata")).toBe(
      "auto_loan",
    );
    expect(familyOf("http://www.sec.gov/edgar/document/absee/autolease/assetdata")).toBe(
      "auto_lease",
    );
    expect(familyOf("http://www.sec.gov/edgar/document/absee/rmbs/assetdata")).toBe("other");
    expect(familyOf("")).toBe("other");
    const { shape } = readAbsText(
      doc(
        '<assets><assetNumber unit="x">1</assetNumber></assets>',
        "http://www.sec.gov/edgar/document/absee/autoloan/assetdata",
      ),
    );
    expect(shape.family).toBe("auto_loan");
    expect(shape.attributes).toBe(1);
  });

  it("refuses what it does not understand instead of reading half of it", () => {
    const refuse = (xml: string, why: RegExp) =>
      expect(() => readAbsText(xml), xml.slice(0, 60)).toThrowError(why);
    refuse(EXCERPT.slice(0, EXCERPT.length - 40), /not well-formed/);
    refuse(
      '<?xml version="1.0"?><other xmlns="x"><assets><a>1</a></assets></other>',
      /root element is <other>/,
    );
    refuse(
      doc("<assets><property><tenant><name>deep</name></tenant></property></assets>"),
      /nested deeper/,
    );
    refuse(
      doc("<assets><property>text<propertyName>P</propertyName></property></assets>"),
      /both text and elements/,
    );
    refuse(
      doc("<assets><property><propertyName>P</propertyName>text</property></assets>"),
      /both text and elements/,
    );
    refuse(doc("<assets>stray<assetNumber>1</assetNumber></assets>"), /text outside a field/);
    refuse(
      doc(
        "<assets><assetNumber>1</assetNumber></assets><assets><assetNumber>2</assetNumbr></assets>",
      ),
      /not well-formed/,
    );
    expect(() => readAbsText(doc("<assets><a>1</a></assets>"))).not.toThrow();
    expect(new AbsXmlError("x").name).toBe("AbsXmlError");
  });

  it("stops handing out records after the first error", () => {
    const seen: number[] = [];
    const reader = createAbsReader((r) => seen.push(r.rec));
    expect(() =>
      reader.write(
        doc("<assets><a>1</a></assets><assets>stray<a>2</a></assets><assets><a>3</a></assets>"),
      ),
    ).toThrowError(/text outside a field/);
    expect(seen).toEqual([1]);
    expect(() => reader.write("<x/>")).toThrow();
    expect(() => reader.close()).toThrow();
  });

  it("reads the declared encoding from the first bytes", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(declaredEncoding(bytes('<?xml version="1.0" encoding="utf-8"?><a/>'))).toBe("utf-8");
    expect(declaredEncoding(bytes("<?xml version='1.0' encoding='ISO-8859-1'?><a/>"))).toBe(
      "iso-8859-1",
    );
    expect(declaredEncoding(bytes('<?xml version="1.0"?><a/>'))).toBe("utf-8");
    expect(declaredEncoding(bytes("<assetData/>"))).toBe("utf-8");
  });
});
