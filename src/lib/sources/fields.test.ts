import { describe, expect, it } from "vitest";
import {
  defaultFields,
  fieldHead,
  fieldRole,
  fieldRoles,
  formatCell,
  statedUnit,
  unitKind,
} from "./fields";
import type { SourceColumn, SourceIngest } from "./schema";

// Descriptors in the shape production stores them (25 Nov 2026): `type` is "string" on every field.
const fdic = (label: string, native_type: string | undefined, unit: string | undefined, title?: string): SourceColumn => ({
  key: `col_${label}`,
  label,
  type: "string",
  ...(native_type ? { native_type } : {}),
  ...(unit ? { unit } : {}),
  ...(title ? { title } : {}),
});
const NOT_SPECIFIED = "Not explicitly specified in retrieved field metadata";
const USD = "USD thousands (monetary measures)";
const CALLYMD = fdic("CALLYMD", "number", NOT_SPECIFIED);
const MSA = fdic("MSA", "number", NOT_SPECIFIED);
const CERT = fdic("CERT", "number", "FDIC certificate identifier", "FDIC Certificate #");
const ID = fdic("ID", undefined, "identifier", "FDIC source record identifier");
const REPDTE = fdic("REPDTE", "string", "Text / categorical / date; see definition", "Report Date");
const ASSET = fdic("ASSET", "number", USD, "Total assets");
const ROA = fdic("ROA", "number", "Percent", "Return on assets");
const OFFICES = fdic("OFFDOM", "number", "Offices");
const FLAG = fdic("TRUST", "number", "Indicator");
const MIXED = fdic("EQ", "number", "Mixed or ambiguous dollar/percent metadata; inspect field definition");
const FRED: SourceColumn = { key: "col0002", label: "CCSA", type: "string" };
const MSHA: SourceColumn = { key: "col0009", label: "COAL_PRODUCTION", type: "string", unit: "short tons clean coal" };
const TWSE: SourceColumn = { key: "col0009", label: "上月比較增減(%)", type: "string", native_type: "string", unit: "Percent" };

describe("unitKind", () => {
  it("reads the seven live FDIC unit strings", () => {
    expect(unitKind("Percent")).toBe("quantity");
    expect(unitKind(USD)).toBe("quantity");
    expect(unitKind("Offices")).toBe("quantity");
    expect(unitKind("Full-time-equivalent employees")).toBe("quantity");
    expect(unitKind(NOT_SPECIFIED)).toBe("unstated");
    expect(unitKind("Mixed or ambiguous dollar/percent metadata; inspect field definition")).toBe("unstated");
    expect(unitKind("Text / categorical / date; see definition")).toBe("text");
    expect(unitKind("Indicator")).toBe("indicator");
    expect(unitKind("FDIC certificate identifier")).toBe("identifier");
    expect(unitKind("Federal Reserve parent identifier")).toBe("identifier");
    expect(unitKind("identifier")).toBe("identifier");
    expect(unitKind(undefined)).toBe("unstated");
    expect(unitKind("  ")).toBe("unstated");
  });

  it("reads the other publishers' unit strings, and the ones that place the unit elsewhere", () => {
    for (const unit of ["MW", "MWh", "thousand USD", "%", "degrees API", "index; 2000=100", "short tons clean coal", "beneficiaries; suppressed values blank"])
      expect(unitKind(unit), unit).toBe("quantity");
    expect(unitKind("11-character census tract identifier")).toBe("identifier");
    expect(unitKind("Federal Reserve identifier")).toBe("identifier");
    for (const unit of [
      "row-specific Physical Unit Label",
      "Series-specific index base in unit column",
      "native source volume; unit not confirmed",
      "source PRODUCT / SUPPLY-specific units; see source notes",
    ])
      expect(unitKind(unit), unit).toBe("unstated");
  });

  it("gives a unit only where the string states a quantity", () => {
    expect(statedUnit(ASSET)).toBe(USD);
    expect(statedUnit(CALLYMD)).toBeNull();
    expect(statedUnit(CERT)).toBeNull();
    expect(statedUnit(FRED)).toBeNull();
  });
});

describe("fieldRole from the dictionary alone", () => {
  it("calls a field a quantity only with a numeric native type and a quantity unit", () => {
    expect(fieldRole(ASSET)).toBe("quantity");
    expect(fieldRole(ROA)).toBe("quantity");
    expect(fieldRole(OFFICES)).toBe("quantity");
  });

  it("never calls a date, a code or an identifier a quantity", () => {
    expect(fieldRole(CALLYMD)).toBe("unknown");
    expect(fieldRole(MSA)).toBe("unknown");
    expect(fieldRole(CERT)).toBe("identifier");
    expect(fieldRole(ID)).toBe("identifier");
    expect(fieldRole(REPDTE)).toBe("text");
    expect(fieldRole(FLAG)).toBe("code");
    expect(fieldRole(MIXED)).toBe("unknown");
  });

  it("does not take the store's type or a lone unit as proof", () => {
    expect(fieldRole(FRED)).toBe("unknown");
    expect(fieldRole(MSHA)).toBe("unknown");
    expect(fieldRole(TWSE)).toBe("unknown");
    expect(fieldRole({ key: "a", label: "a", type: "string", native_type: "string" })).toBe("text");
    expect(fieldRole({ key: "d", label: "d", type: "string", native_type: "date" })).toBe("date");
  });

  it("reads the publisher's native type only, never the store's type", () => {
    expect(fieldRole({ key: "v", label: "v", type: "number", unit: "USD" })).toBe("unknown");
    expect(fieldRole({ key: "v", label: "v", type: "number" })).toBe("unknown");
    expect(fieldRole({ key: "v", label: "v", type: "string", native_type: "integer", unit: "MW" })).toBe("quantity");
    expect(fieldRole({ key: "v", label: "v", type: "string", unit: "MW" })).toBe("unknown");
  });
});

describe("fieldRole with a hint", () => {
  it("lets a reviewed hint name the measure the dictionary cannot", () => {
    expect(fieldRole(FRED, { role: "quantity" })).toBe("quantity");
    expect(fieldRole(MSHA, { role: "quantity" })).toBe("quantity");
    expect(fieldRole(TWSE, { role: "quantity" })).toBe("quantity");
    expect(fieldRole(CALLYMD, { role: "date" })).toBe("date");
    expect(fieldRole(MSA, { role: "code" })).toBe("code");
  });

  it("refuses to make a quantity of an identifier or a date", () => {
    expect(fieldRole(CERT, { role: "quantity" })).toBe("identifier");
    expect(fieldRole({ key: "d", label: "d", type: "string", native_type: "date" }, { role: "quantity" })).toBe("date");
    expect(fieldRole(ASSET, {})).toBe("quantity");
  });
});

describe("formatCell", () => {
  it("shows dates, codes and identifiers exactly as stored (rev-app M1)", () => {
    expect(formatCell("20260630", fieldRole(CALLYMD), CALLYMD)).toEqual({ text: "20260630", align: "left" });
    expect(formatCell("202606", fieldRole(CALLYMD))).toEqual({ text: "202606", align: "left" });
    expect(formatCell("18240101", fieldRole(CALLYMD))).toEqual({ text: "18240101", align: "left" });
    expect(formatCell("99991231", fieldRole(CALLYMD))).toEqual({ text: "99991231", align: "left" });
    expect(formatCell("18140.0", fieldRole(MSA), MSA)).toEqual({ text: "18140.0", align: "left" });
    expect(formatCell("628", fieldRole(CERT), CERT)).toEqual({ text: "628", align: "left" });
    expect(formatCell("20260630", fieldRole(REPDTE), REPDTE)).toEqual({ text: "20260630", align: "left" });
    expect(formatCell("01001", "code")).toEqual({ text: "01001", align: "left" });
  });

  it("groups a quantity, keeps its decimals and leaves the unit to the column head", () => {
    expect(formatCell("4091315000", fieldRole(ASSET), ASSET)).toEqual({
      text: "4,091,315,000",
      align: "right",
      title: `4091315000 ${USD}`,
    });
    expect(formatCell("18767000.0", "quantity")).toEqual({
      text: "18,767,000.0",
      align: "right",
      title: "18767000.0",
    });
    expect(formatCell("1.5851712753913223", fieldRole(ROA), ROA)).toEqual({
      text: "1.5851712753913223",
      align: "right",
      title: "1.5851712753913223 Percent",
    });
    expect(formatCell("12", "quantity")).toEqual({ text: "12", align: "right" });
    expect(formatCell("-12345.60", "quantity").text).toBe("−12,345.60");
  });

  it("keeps a marker, an exponent and a zero-padded value as stored in a quantity column", () => {
    expect(formatCell("NM", "quantity", ASSET)).toEqual({ text: "NM", align: "right" });
    expect(formatCell("1.2e6", "quantity")).toEqual({ text: "1.2e6", align: "right" });
    expect(formatCell("000123", "quantity")).toEqual({ text: "000123", align: "right" });
    expect(formatCell("0", "quantity")).toEqual({ text: "0", align: "right" });
  });

  it("marks a missing value with an en dash and keeps an empty cell empty (rev-app M5)", () => {
    const missing = formatCell(null, "quantity");
    expect(missing).toEqual({ text: "–", align: "right", title: "missing in the source" });
    expect(missing.text).not.toContain("\u2014");
    expect(formatCell(null, "text").align).toBe("left");
    expect(formatCell("", "quantity")).toEqual({ text: "", align: "right", title: "empty in the source" });
    expect(formatCell("", "text")).toEqual({ text: "", align: "left", title: "empty in the source" });
  });
});

describe("fieldRoles and defaultFields", () => {
  const ingest: Pick<SourceIngest, "dimensions" | "composites"> = {
    dimensions: { entity_id: 0, period: 1, entity_name: 4, geo_code: 5 },
  };
  const columns: SourceColumn[] = [
    CERT,
    REPDTE,
    ID,
    CALLYMD,
    fdic("NAME", "string", "Text / categorical / date; see definition", "Institution name"),
    fdic("STALP", "string", "Text / categorical / date; see definition"),
    MSA,
    ASSET,
    ROA,
    FLAG,
  ];

  it("gives declared dimensions the role their declaration implies", () => {
    expect(fieldRoles(columns, ingest)).toEqual([
      "identifier",
      "date",
      "identifier",
      "unknown",
      "text",
      "code",
      "unknown",
      "quantity",
      "quantity",
      "code",
    ]);
    expect(fieldRoles(columns, null, { col_CALLYMD: { role: "date" } })[3]).toBe("date");
    expect(fieldRoles([FRED], { dimensions: {}, composites: { period: { indices: [0, 0], separator: "-", format: "year_month" } } })).toEqual(["date"]);
  });

  it("opens on the dimension fields, then the quantities, then file order", () => {
    expect(defaultFields(columns, ingest)).toEqual([4, 0, 5, 1, 7, 8, 2, 3]);
    expect(defaultFields(columns, ingest, { limit: 3 })).toEqual([4, 0, 5]);
    expect(defaultFields(columns, ingest, { lead: ["col_ROA", "missing"], limit: 4 })).toEqual([8, 4, 0, 5]);
    expect(defaultFields(columns, null, { limit: 4 })).toEqual([7, 8, 0, 1]);
    expect(defaultFields([], ingest)).toEqual([]);
    expect(defaultFields([FRED, MSHA], null, { hints: { col0009: { role: "quantity" } } })).toEqual([1, 0]);
  });

  it("handles the widest live dictionary (2,379 fields) without a publisher's names", () => {
    const wide = Array.from({ length: 2379 }, (_, i) =>
      fdic(`F${i}`, "number", i % 3 === 0 ? USD : i % 3 === 1 ? "Percent" : NOT_SPECIFIED),
    );
    const started = Date.now();
    const picked = defaultFields(wide, { dimensions: { entity_id: 0, period: 1 } });
    expect(picked).toEqual([0, 1, 3, 4, 6, 7, 9, 10]);
    expect(fieldRoles(wide).filter((role) => role === "quantity")).toHaveLength(1586);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("fieldHead", () => {
  it("puts the title first and the stated unit second", () => {
    expect(fieldHead(ASSET)).toEqual({ title: "Total assets", sub: USD });
    expect(fieldHead(CERT)).toEqual({ title: "FDIC Certificate #", sub: "CERT" });
    expect(fieldHead(FRED)).toEqual({ title: "CCSA", sub: null });
    expect(fieldHead(CALLYMD)).toEqual({ title: "CALLYMD", sub: null });
  });
});
