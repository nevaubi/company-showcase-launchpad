import { describe, expect, it } from "vitest";
import type { GraphNode, HopNode, RiskLink } from "./core";
import { arcEnds, cityKey, frameAll, cityLabel, indexCities, isExonym, knownHomeCountry, matchCity, placeGraph, placeOne, readHq, statedCountries, usState, type GazCity, type Hq, type HqFile } from "./geo";

const link = (p: Partial<RiskLink>): RiskLink => ({ id: "1", ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "supplier", detail: "", share_pct: null, quote: "q", accn: "a", doc: "d", form: "10-K", filed: "2026-02-01", ...p });
const node = (p: Partial<GraphNode>): GraphNode => ({ key: "supplier:x", name: "X", ticker: null, domain: null, relation: "supplier", links: [], ...p });
const CENTRE: Record<string, [number, number]> = { Taiwan: [121, 23.7], China: [104, 35], "South Korea": [127.8, 36.4], Japan: [138, 36] };
const centroid = (c: string) => CENTRE[c] ?? null;
const HQ: Record<string, Hq> = {
  NVDA: { lat: 37.354, lon: -121.955, place: "Santa Clara, CA", country: "United States", precision: "city", source: "sec" },
  ACGL: { lat: 32.29, lon: -64.78, place: "Bermuda", country: "Bermuda", precision: "country", source: "directory" },
};

describe("readHq", () => {
  const file: HqFile = {
    generatedAt: "2026-11-19T00:00:00Z", sources: {}, counts: { companies: 3, city: 1, country: 1, missing: 1 }, missing: ["ZZZ"],
    companies: { NVDA: [37.354, -121.955, "Santa Clara, CA", "United States", "c", "s"], ACGL: [32.29, -64.78, "Bermuda", "Bermuda", "n", "d"] },
  };
  it("decodes rows and keeps the precision and source", () => {
    const hq = readHq(file);
    expect(hq.NVDA).toEqual(HQ.NVDA);
    expect(hq.ACGL.precision).toBe("country");
    expect(hq.ACGL.source).toBe("directory");
  });
  it("drops rows that are not a position and survives a missing file", () => {
    const bad = { ...file, companies: { A: [200, 10, "x", "y", "c", "s"], B: ["1", 2, "x", "y", "c", "s"], C: [1, 2, 3, "y", "c", "s"], D: [1, 2, "x", "y", "exact", "s"], E: [1, 2, "x", "y", "c", "web"], F: [1, 2, "", "y", "c", "s"] } } as unknown as HqFile;
    expect(readHq(bad)).toEqual({});
    expect(readHq(null)).toEqual({});
    expect(readHq({} as HqFile)).toEqual({});
  });
});

describe("placeOne", () => {
  it("uses the head office of a covered company first", () => {
    expect(placeOne(node({ ticker: "NVDA", links: [link({ regions: ["Taiwan"], quote: "wafers made in Taiwan" })] }), HQ, centroid)).toMatchObject({ basis: "hq", place: "Santa Clara, CA", lon: -121.955 });
    expect(placeOne(node({ ticker: "ACGL" }), HQ, centroid)).toMatchObject({ basis: "hq-country", country: "Bermuda" });
  });
  it("falls back to the home country of a well-known foreign company, ticker or not", () => {
    expect(placeOne(node({ name: "Taiwan Semiconductor Manufacturing Company" }), HQ, centroid)).toMatchObject({ basis: "known-country", country: "Taiwan", lon: 121 });
    expect(placeOne(node({ name: "Taiwan Semiconductor Manufacturing Company Limited", ticker: "TSM" }), HQ, centroid)).toMatchObject({ basis: "known-country", country: "Taiwan" });
  });
  it("uses the country the quoted sentence names only when there is exactly one", () => {
    expect(placeOne(node({ name: "Acme Components", links: [link({ regions: ["japan"], quote: "our supplier in Japan builds the lens" }), link({ regions: ["Japan"], quote: "sourced from Japan." })] }), HQ, centroid)).toMatchObject({ basis: "filing-region", country: "Japan" });
    const many = placeOne(node({ name: "Acme Components", links: [link({ regions: ["Japan", "China"], quote: "plants in Japan and China" })] }), HQ, centroid);
    expect(many).toHaveProperty("why");
    expect((many as { why: string }).why).toMatch(/2 countries/);
  });
  it("never guesses: unknown names and regions that are not countries stay unplaced", () => {
    expect(placeOne(node({ name: "Acme Components", links: [link({ regions: ["Asia", "EMEA"], quote: "suppliers across Asia and EMEA" })] }), HQ, centroid)).toEqual({ why: "no location stated in the filing" });
    /* a region the model attached but the quoted sentence does not name is not evidence */
    expect(placeOne(node({ name: "Acme Components", links: [link({ regions: ["Japan"], quote: "we rely on a single supplier for this part" })] }), HQ, centroid)).toEqual({ why: "no location stated in the filing" });
    expect(placeOne(node({ name: "Smallcap Inc", ticker: "SMLL" }), HQ, centroid)).toEqual({ why: "no head office on file" });
  });
});

describe("placeGraph", () => {
  it("splits placed from unplaced and carries the second-order parent", () => {
    const first = node({ key: "supplier:TSM", name: "TSMC" });
    const second: HopNode = { ...node({ key: "h2:supplier:TSM:asml", name: "ASML Holding" }), hop: 2, parent: "supplier:TSM" };
    const lost = node({ key: "customer:acme", name: "Acme Retail", relation: "customer" });
    const { placed, unplaced } = placeGraph([first, second, lost], HQ, (c) => ({ ...CENTRE, Netherlands: [5.3, 52.2] as [number, number] })[c] ?? null);
    expect(placed.map((p) => [p.key, p.hop, p.parent, p.country])).toEqual([["supplier:TSM", 1, null, "Taiwan"], ["h2:supplier:TSM:asml", 2, "supplier:TSM", "Netherlands"]]);
    expect(unplaced).toEqual([{ key: "customer:acme", name: "Acme Retail", ticker: null, relation: "customer", hop: 1, why: "no location stated in the filing" }]);
  });
});

describe("statedCountries", () => {
  it("counts each country once per link and orders by how often it is named", () => {
    expect(statedCountries([link({ regions: ["Taiwan", "taiwan", "China"], quote: "fabs in Taiwan and China" }), link({ regions: ["PRC"], quote: "sales to the PRC fell" }), link({ regions: ["China"], quote: "customers in China" })])).toEqual(["China", "Taiwan"]);
    expect(statedCountries([link({})])).toEqual([]);
  });
  it("ignores a region the quoted sentence does not name, and partial-word matches", () => {
    expect(statedCountries([link({ regions: ["Taiwan"], quote: "our foundry partner produces our wafers" })])).toEqual([]);
    expect(statedCountries([link({ regions: ["India"], quote: "sold through Indiana distributors" })])).toEqual([]);
    expect(statedCountries([link({ regions: ["United States"], quote: "sold in the U.S. and Canada" })])).toEqual([]);
    expect(statedCountries([link({ regions: ["U.S."], quote: "sold in the U.S. and Canada" })])).toEqual(["United States"]);
  });
});

describe("knownHomeCountry", () => {
  it("recognises large foreign companies by their full name", () => {
    expect(knownHomeCountry("Samsung Electronics Co., Ltd.")).toBe("South Korea");
    expect(knownHomeCountry("SK Hynix Inc.")).toBe("South Korea");
    expect(knownHomeCountry("Hon Hai Precision Industry Co., Ltd.")).toBe("Taiwan");
    expect(knownHomeCountry("Huawei Technologies Co. Ltd.")).toBe("China");
    expect(knownHomeCountry("Renesas Electronics Corporation")).toBe("Japan");
    expect(knownHomeCountry("ASML Holding N.V.")).toBe("Netherlands");
  });
  it("does not send lookalike names abroad", () => {
    for (const name of ["Quanta Services", "Schneider National", "Reliance Steel & Aluminum", "Pacer International", "Hubs Inc", "Shell plc", "Acer Therapeutics", "Arm & Hammer", "Continental Resources", "Canon City Mining", "Delta Air Lines", "Tata's Diner"]) expect(knownHomeCountry(name)).toBeNull();
  });
});

describe("arcEnds", () => {
  const a: [number, number] = [-122, 37], b: [number, number] = [121, 24];
  it("points in the direction supply moves", () => {
    expect(arcEnds("supplier", a, b)).toEqual({ a: b, b: a, twoWay: false, plain: false });
    expect(arcEnds("customer", a, b)).toEqual({ a, b, twoWay: false, plain: false });
    expect(arcEnds("partner", a, b)).toMatchObject({ twoWay: true, plain: false });
    expect(arcEnds("competitor", a, b)).toMatchObject({ twoWay: false, plain: true });
  });
});

describe("frameAll", () => {
  it("zooms in on a tight group and centres on it", () => {
    const v = frameAll([[-122, 37.4], [-121.9, 37.3], [-122.1, 37.5]]);
    expect(v.lon).toBeCloseTo(-122, 0);
    expect(v.lat).toBeCloseTo(37.4, 0);
    expect(v.zoom).toBe(6);
  });
  it("shows a whole hemisphere when the links span an ocean", () => {
    const v = frameAll([[-122, 37], [121, 24], [127, 37]]);
    expect(v.zoom).toBe(1);
    expect(Math.abs(v.lon)).toBeGreaterThan(140);
  });
  it("falls back to the first place when the points cancel out, and never returns NaN", () => {
    const v = frameAll([[0, 0], [180, 0]]);
    expect(v).toEqual({ lon: 0, lat: 0, zoom: 1 });
    expect(frameAll([])).toEqual({ lon: 0, lat: 0, zoom: 1 });
    expect(frameAll([[NaN, 10], [10, 20]])).toMatchObject({ lon: 10, lat: 20 });
    for (const k of Object.values(frameAll([[10, 89.9], [-170, 89.9]]))) expect(Number.isFinite(k)).toBe(true);
  });
});

describe("address matching", () => {
  const cities: GazCity[] = [
    { name: "Springfield", country: "US", admin: "IL", pop: 116000, lat: 39.8, lon: -89.6 },
    { name: "Springfield", country: "US", admin: "MO", pop: 167000, lat: 37.2, lon: -93.3 },
    { name: "New York City", country: "US", admin: "NY", pop: 8175133, lat: 40.71, lon: -74.01 },
    { name: "Washington, D.C.", country: "US", admin: "DC", pop: 601723, lat: 38.9, lon: -77.04 },
    { name: "Saint Louis", country: "US", admin: "MO", pop: 319000, lat: 38.63, lon: -90.2 },
    { name: "Tysons Corner", country: "US", admin: "VA", pop: 19627, lat: 38.92, lon: -77.23 },
    { name: "Genève", country: "CH", admin: "GE", pop: 183981, lat: 46.2, lon: 6.15 },
    { name: "Dublin", country: "IE", admin: "L", pop: 1024027, lat: 53.33, lon: -6.25 },
    { name: "Dublin", country: "US", admin: "OH", pop: 41751, lat: 40.1, lon: -83.11 },
  ];
  const index = indexCities(cities);
  it("normalises names", () => {
    expect(cityKey("ST. LOUIS")).toBe("saint louis");
    expect(cityKey("Genève")).toBe("geneve");
    expect(cityKey("Mayfield Hts.")).toBe("mayfield heights");
    expect(cityLabel("SANTA CLARA")).toBe("Santa Clara");
    expect(cityLabel("McLean")).toBe("McLean");
    expect(usState("ohio")).toBe("OH");
    expect(usState("CA")).toBe("CA");
    expect(usState("Ontario")).toBeNull();
    expect(isExonym("GENEVA")).toBe(true);
    expect(isExonym("Dublin")).toBe(false);
  });
  it("needs the right state when one is given", () => {
    expect(matchCity(index, "SPRINGFIELD", "US", "IL")?.lat).toBe(39.8);
    expect(matchCity(index, "Springfield", "US", "TX")).toBeNull();
    expect(matchCity(index, "Dublin", "IE")?.pop).toBe(1024027);
    expect(matchCity(index, "Dublin", "US", "OH")?.admin).toBe("OH");
  });
  it("handles the spellings SEC addresses and the directory use", () => {
    expect(matchCity(index, "NEW YORK", "US", "NY")?.name).toBe("New York City");
    expect(matchCity(index, "Washington", "US", "DC")?.name).toBe("Washington, D.C.");
    expect(matchCity(index, "St. Louis", "US", "MO")?.name).toBe("Saint Louis");
    expect(matchCity(index, "Dublin 2", "IE")?.name).toBe("Dublin");
    expect(matchCity(index, "Geneva", "CH")?.name).toBe("Genève");
    expect(matchCity(index, "tysons", "US", "VA")?.name).toBe("Tysons Corner");
  });
  it("refuses a prefix that could mean more than one city", () => {
    const two = indexCities([...cities, { name: "Tysons Station", country: "US", admin: "VA", pop: 900, lat: 38.9, lon: -77.2 }]);
    expect(matchCity(two, "tysons", "US", "VA")).toBeNull();
  });
  it("returns nothing rather than a city in the wrong country", () => {
    expect(matchCity(index, "Geneva", "US", "IL")).toBeNull();
    expect(matchCity(index, "Atlantis", "US", "FL")).toBeNull();
    expect(matchCity(index, "tysons", "US")).toBeNull();
  });
});
