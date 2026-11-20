// Fixtures are real SEC answers (data.sec.gov/submissions, read 2026-11-20), trimmed to the fields used.
import { describe, expect, it } from "vitest";
import type { HqRow } from "../supply/geo";
import { agentAddress, chooseHq, cityCandidates, countryIso, isPoBox, kmApart, readSubmissions, secPlace, type SecAddress } from "./address";

const addr = (p: Partial<SecAddress>): SecAddress => ({ street1: null, street2: null, city: null, stateOrCountry: null, stateOrCountryDescription: null, zipCode: null, country: null, countryCode: null, ...p });
const AGILENT = addr({ street1: "5301 STEVENS CREEK BLVD", city: "SANTA CLARA", stateOrCountry: "CA", zipCode: "95051", stateOrCountryDescription: "CA" });
const ACCENTURE = addr({ street1: "1 GRAND CANAL SQUARE", street2: "GRAND CANAL HARBOUR", city: "DUBLIN", stateOrCountry: "L2", zipCode: "D2", stateOrCountryDescription: "Ireland" });
const ADIENT = addr({ street1: "25 NORTH WALL QUAY", city: "DUBLIN", country: "Ireland", countryCode: "L2" });
const LULULEMON = addr({ street1: "1818 CORNWALL AVENUE", city: "VANCOUVER", stateOrCountry: "A1", zipCode: "V6J 1C7", stateOrCountryDescription: "British Columbia, Canada" });
const CREDO = addr({ street1: "C/O MAPLES CORPORATE SERVICES, LIMITED", street2: "PO BOX 309, UGLAND HOUSE", city: "GRAND CAYMAN", stateOrCountry: "E9", zipCode: "KY1-1104", stateOrCountryDescription: "Cayman Islands" });
const FABRINET = addr({ street1: "C/O INTERTRUST CORPORATE SERVICES", street2: "ONE NEXUS WAY, CAMANA BAY", city: "GRAND CAYMAN", country: "Cayman Islands", countryCode: "E9" });
const WTW = addr({ street1: "C/O WILLIS GROUP LIMITED", street2: "51 LIME STREET", city: "LONDON ENGLAND", stateOrCountry: "X0", zipCode: "EC3M 7DQ", stateOrCountryDescription: "United Kingdom" });
const ADI_GLOBAL = addr({ street1: "251 LITTLE FALLS DRIVE", city: "WILMINGTON", stateOrCountry: "DE", zipCode: "19808", stateOrCountryDescription: "DE" });
const MILLROSE = addr({ street1: "C/O CORPORATE CREATIONS NETWORK INC.", street2: "2 WISCONSIN CIRCLE #700", city: "CHEVY CHASE", stateOrCountry: "MD", zipCode: "20815", stateOrCountryDescription: "MD" });
const TWENTY_ONE = addr({ street1: "CORPORATION SERVICE COMPANY", street2: "211 EAST 7TH STREET, SUITE 620", city: "AUSTIN", stateOrCountry: "TX", zipCode: "78701-3218", stateOrCountryDescription: "TX" });
const BANCORP = addr({ street1: "409 SILVERSIDE ROAD", city: "WILMINGTON", stateOrCountry: "DE", zipCode: "19809", stateOrCountryDescription: "DE" });
const NXP = addr({});

describe("readSubmissions", () => {
  it("keeps the fields the head-office script uses and drops the rest", () => {
    const p = readSubmissions({
      cik: "0001090872", name: "AGILENT TECHNOLOGIES, INC.", sic: "3826", sicDescription: "Laboratory Analytical Instruments", fiscalYearEnd: "1031", stateOfIncorporation: "DE",
      addresses: { business: { ...AGILENT, isForeignLocation: null }, mailing: { street1: "5301 STEVENS CREEK BLVD", city: "SANTA CLARA", stateOrCountry: "CA" } }, filings: { recent: {} },
    });
    expect(p).toMatchObject({ cik: "1090872", sic: "3826", fiscalYearEnd: "1031", business: { city: "SANTA CLARA", stateOrCountry: "CA", zipCode: "95051" } });
    expect(Object.keys(p ?? {})).not.toContain("filings");
  });
  it("reads an empty address block as absent and rejects files without a CIK", () => {
    expect(readSubmissions({ cik: "1413447", addresses: { business: { street1: null, city: null } } })?.business).toBeNull();
    expect(readSubmissions({ name: "x" })).toBeNull();
    expect(readSubmissions(null)).toBeNull();
  });
  it("ignores values that are not short strings", () => {
    const p = readSubmissions({ cik: 1, fiscalYearEnd: "Dec", addresses: { business: { city: { nested: true }, street1: "x".repeat(500), stateOrCountry: "CA" } } });
    expect(p?.fiscalYearEnd).toBeNull();
    expect(p?.business).toMatchObject({ city: null, street1: null, stateOrCountry: "CA" });
  });
});

describe("secPlace", () => {
  it("reads U.S. state codes", () => {
    expect(secPlace(AGILENT)).toEqual({ kind: "us", state: "CA", cities: ["SANTA CLARA"] });
  });
  it("reads Canadian provinces from SEC's codes", () => {
    expect(secPlace(LULULEMON)).toMatchObject({ kind: "ca", province: "02", cities: ["VANCOUVER"] });
  });
  it("names foreign countries from SEC's description, or from the country field when the code is blank", () => {
    expect(secPlace(ACCENTURE)).toMatchObject({ kind: "foreign", iso: "IE" });
    expect(secPlace(ADIENT)).toMatchObject({ kind: "foreign", iso: "IE", cities: ["DUBLIN"] });
  });
  it("falls back to SEC's own country code only when no name is given", () => {
    expect(secPlace(addr({ city: "PEMBROKE", stateOrCountry: "D0" }))).toMatchObject({ kind: "foreign", iso: "BM" });
    expect(secPlace(addr({ city: "SOMEWHERE", stateOrCountry: "Q9" }))).toEqual({ kind: "none", why: "country code Q9 with no country name" });
  });
  it("says why an address cannot be used", () => {
    expect(secPlace(NXP)).toEqual({ kind: "none", why: "no city in the business address" });
    expect(secPlace(null)).toEqual({ kind: "none", why: "no business address" });
  });
});

describe("cityCandidates", () => {
  it("tries the city whole first, then without the country or county the filer appended", () => {
    expect(cityCandidates("HAMILTON BERMUDA", ["Bermuda"])).toEqual(["HAMILTON BERMUDA", "HAMILTON"]);
    expect(cityCandidates("LONDON ENGLAND", ["United Kingdom"])).toEqual(["LONDON ENGLAND", "LONDON"]);
    expect(cityCandidates("WOKING SURREY", ["United Kingdom"])).toEqual(["WOKING SURREY", "WOKING"]);
    expect(cityCandidates("CO. DUBLIN", ["Ireland"])).toEqual(["CO. DUBLIN", "DUBLIN"]);
  });
  it("splits comma lists in the order written", () => {
    expect(cityCandidates("WARMLEY, BRISTOL", ["United Kingdom"])).toEqual(["WARMLEY, BRISTOL", "WARMLEY", "BRISTOL"]);
  });
  it("never cuts a real multi-word city", () => {
    expect(cityCandidates("NEW YORK")).toEqual(["NEW YORK"]);
    expect(cityCandidates("NEWCASTLE UPON TYNE", ["United Kingdom"])).toEqual(["NEWCASTLE UPON TYNE"]);
    expect(cityCandidates("")).toEqual([]);
  });
});

describe("agentAddress", () => {
  it("flags addresses care of a registered agent", () => {
    expect(agentAddress(CREDO)).toMatch(/registered agent/);
    expect(agentAddress(FABRINET)).toMatch(/registered agent/);
    expect(agentAddress(MILLROSE)).toMatch(/registered agent/);
    expect(agentAddress(TWENTY_ONE)).toMatch(/registered agent/);
    expect(agentAddress(ADI_GLOBAL)).toMatch(/Corporation Service Company/);
  });
  it("does not flag a company's own group office or an ordinary address", () => {
    expect(agentAddress(WTW)).toBeNull();
    expect(agentAddress(AGILENT)).toBeNull();
    expect(agentAddress(ACCENTURE)).toBeNull();
    /* The Bancorp really is in Wilmington */
    expect(agentAddress(BANCORP)).toBeNull();
  });
  it("recognises post-office boxes without treating them as agents", () => {
    expect(isPoBox("P.O. BOX 2463")).toBe(true);
    expect(isPoBox("PO BOX 309, UGLAND HOUSE")).toBe(true);
    expect(isPoBox("5301 STEVENS CREEK BLVD")).toBe(false);
    expect(agentAddress(addr({ street1: "P.O. BOX 2463", city: "HOUSTON", stateOrCountry: "TX" }))).toBeNull();
  });
});

describe("chooseHq", () => {
  const v: HqRow = [37.339, -121.895, "San Jose, CA", "United States", "c", "v"];
  const sec: HqRow = [37.354, -121.955, "Santa Clara, CA", "United States", "c", "s"];
  const secCountry: HqRow = [51.509, -0.126, "United Kingdom", "United Kingdom", "n", "s"];
  const dirUk: HqRow = [51.319, -0.558, "Woking, United Kingdom", "United Kingdom", "c", "d"];
  const dirUs: HqRow = [40.714, -74.006, "New York, NY", "United States", "c", "d"];
  it("puts the hand-checked row first, then SEC, then the directory", () => {
    expect(chooseHq(v, sec, dirUs)).toBe(v);
    expect(chooseHq(null, sec, dirUs)).toBe(sec);
    expect(chooseHq(null, null, dirUs)).toBe(dirUs);
    expect(chooseHq(null, null, null)).toBeNull();
  });
  it("uses a directory city only in the country SEC names", () => {
    expect(chooseHq(null, secCountry, dirUk)).toBe(dirUk);
    expect(chooseHq(null, secCountry, dirUs)).toBe(secCountry);
  });
});

describe("country helpers", () => {
  it("reads the spellings SEC and the directory use", () => {
    expect(countryIso("United Kingdom")).toBe("GB");
    expect(countryIso("Cayman Islands")).toBe("KY");
    expect(countryIso("Korea, Republic of")).toBe("KR");
    expect(countryIso("Atlantis")).toBeNull();
  });
  it("measures distance between rows", () => {
    const sf: HqRow = [37.775, -122.419, "San Francisco, CA", "United States", "c", "s"];
    const ny: HqRow = [40.714, -74.006, "New York, NY", "United States", "c", "s"];
    expect(Math.round(kmApart(sf, ny))).toBeGreaterThan(4100);
    expect(Math.round(kmApart(sf, ny))).toBeLessThan(4160);
  });
});
