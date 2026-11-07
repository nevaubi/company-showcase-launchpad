import { describe, expect, it } from "vitest";
import {
  buildDigest,
  countByType,
  digestText,
  filterEvents,
  fmtBaseRate,
  groupByDay,
  newSince,
  rankEvents,
  visitBaseline,
} from "./core";
import type { ChangeEvent } from "./types";

const ev = (p: Partial<ChangeEvent>): ChangeEvent => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  type: "insider",
  sub: "insider_buy",
  t: "AAPL",
  name: "Apple",
  sector: "Information Technology",
  date: "2026-11-05",
  title: "t",
  detail: null,
  tier: "medium",
  reason: "r",
  evidence: [{ label: "SEC filing", url: "https://www.sec.gov/x", kind: "sec" }],
  metrics: {},
  base_rate: null,
  tags: [],
  upcoming: false,
  ...p,
});

describe("filters and ranking", () => {
  it("applies tier floor, types, sector, tickers and text", () => {
    const evs = [
      ev({ id: "a", tier: "high" }),
      ev({ id: "b", tier: "low" }),
      ev({ id: "c", type: "analyst", t: "MSFT", sector: "Software" }),
      ev({ id: "d", type: "macro", t: null, sector: null, title: "Upcoming CPI" }),
    ];
    expect(filterEvents(evs, { minTier: "medium" }).map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect(filterEvents(evs, { types: ["analyst"] }).map((e) => e.id)).toEqual(["c"]);
    expect(filterEvents(evs, { tickers: new Set(["AAPL"]) }).map((e) => e.id)).toEqual(["a", "b"]);
    expect(filterEvents(evs, { query: "cpi" }).map((e) => e.id)).toEqual(["d"]);
  });

  it("ranks by tier, then size, then newest", () => {
    const out = rankEvents([
      ev({ id: "m-small", metrics: { bps_mcap: 1 } }),
      ev({ id: "h", tier: "high", metrics: { bps_mcap: 0.1 } }),
      ev({ id: "m-big", metrics: { bps_mcap: 9 } }),
      ev({ id: "m-new", date: "2026-11-06", metrics: { bps_mcap: 1 } }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["h", "m-big", "m-new", "m-small"]);
  });

  it("groups by day newest first and marks upcoming days", () => {
    const g = groupByDay([
      ev({ date: "2026-11-04" }),
      ev({ date: "2026-11-10", upcoming: true }),
      ev({ date: "2026-11-04" }),
    ]);
    expect(g.map((x) => [x.date, x.upcoming, x.events.length])).toEqual([
      ["2026-11-10", true, 1],
      ["2026-11-04", false, 2],
    ]);
  });
});

describe("since last visit", () => {
  it("counts events first seen after the visit and ignores upcoming ones", () => {
    const evs = [
      ev({ id: "old", first_seen: "2026-11-01T00:00:00Z" }),
      ev({ id: "new", first_seen: "2026-11-06T10:00:00Z", type: "analyst" }),
      ev({ id: "up", first_seen: "2026-11-06T10:00:00Z", upcoming: true }),
    ];
    expect(newSince(evs, "2026-11-05T00:00:00Z").map((e) => e.id)).toEqual(["new"]);
    expect(newSince(evs, null)).toEqual([]);
    expect(countByType(newSince(evs, "2026-10-01T00:00:00Z"))).toEqual([
      { type: "insider", n: 1 },
      { type: "analyst", n: 1 },
    ]);
  });

  it("keeps the earlier baseline inside one session", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(
      visitBaseline(
        {
          ticker: "A",
          last_seen_at: "2026-11-07T11:50:00Z",
          previous_seen_at: "2026-11-03T09:00:00Z",
        },
        now,
      ),
    ).toBe("2026-11-03T09:00:00Z");
    expect(
      visitBaseline(
        {
          ticker: "A",
          last_seen_at: "2026-11-05T11:50:00Z",
          previous_seen_at: "2026-11-03T09:00:00Z",
        },
        now,
      ),
    ).toBe("2026-11-05T11:50:00Z");
    expect(visitBaseline(undefined, now)).toBeNull();
  });
});

describe("digest", () => {
  it("takes the top events across companies, caps each company and flags new ones", () => {
    const files = [
      {
        ticker: "AAPL",
        events: [
          ev({ id: "a1", tier: "high", date: "2026-11-06", first_seen: "2026-11-06T08:00:00Z" }),
          ev({ id: "a2", tier: "high", date: "2026-11-05" }),
          ev({ id: "a3", tier: "high", date: "2026-11-04" }),
          ev({ id: "a4", tier: "high", date: "2026-11-03" }),
          ev({ id: "aold", tier: "high", date: "2026-10-01" }),
        ],
      },
      {
        ticker: "MSFT",
        events: [
          ev({ id: "m1", t: "MSFT", date: "2026-11-06" }),
          ev({ id: "mlow", t: "MSFT", tier: "low", date: "2026-11-06" }),
        ],
      },
    ];
    const d = buildDigest({
      files,
      lastSeen: { AAPL: "2026-11-05T00:00:00Z" },
      today: "2026-11-07",
      days: 7,
      limit: 10,
      maxPerTicker: 3,
    });
    expect(d.items.map((i) => i.event.id)).toEqual(["a1", "a2", "a3", "m1"]);
    expect(d.items[0].isNew).toBe(true);
    expect(d.items[1].isNew).toBe(false);
    expect(d.items[3].isNew).toBe(true);
    expect(d.newByTicker.AAPL).toBe(1);
    const txt = digestText(d, "https://app.example");
    expect(txt).toContain("[new] AAPL 2026-11-06");
    expect(txt).toContain("Source: https://www.sec.gov/x");
  });

  it("formats base rates with their range, size and caveat", () => {
    const s = fmtBaseRate({
      horizon_days: 60,
      excess: 0.0649,
      excess_ci: [0.014, 0.1158],
      hit: 0.55,
      n: 16094,
      verdict: "above zero",
      since: "2008-12-31",
      caveat: "",
    });
    expect(s).toContain("+6.5%");
    expect(s).toContain("+1.4% to +11.6%");
    expect(s).toContain("n=16,094");
    expect(s).toContain("not a forecast");
  });
});
