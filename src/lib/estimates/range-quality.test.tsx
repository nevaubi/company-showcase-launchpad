import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForecastRangeCell } from "@/components/estimates/forecast-range";
import { coverageLabel, forecastRange, forecastReading, forecastSource } from "./range-quality";

const fmt = (v: number | null) => v == null ? "–" : String(v);

describe("consensus range quality", () => {
  it.each([
    [{ avg: 1.64153, low: 3.18, high: 1.89 }, 19, "Reported low exceeds high"],
    [{ avg: 2.268, low: 0, high: 2.07 }, 0, "Mean outside reported range"],
    [{ avg: 1.001, low: 1, high: 1 }, 3, "Mean outside reported range"],
  ] as const)("preserves an inconsistent published mean and its raw bounds without drawing a band", (raw, count, issue) => {
    const original = { ...raw };
    expect(forecastRange(raw, count)).toMatchObject({ mean: raw.avg, position: null, issue });
    const html = renderToStaticMarkup(<ForecastRangeCell raw={raw} count={count} format={fmt} />);
    expect(html).not.toContain("left:");
    expect(html).toContain(issue);
    const collapsed = document.createElement("div");
    collapsed.innerHTML = html;
    collapsed.querySelector("details")?.remove();
    expect(collapsed.textContent).not.toMatch(/Low |High /);
    expect(html).toContain(`low ${raw.low}, high ${raw.high}`);
    expect(raw).toEqual(original);
  });
  it("distinguishes the provider's all-zero, zero-count placeholder from a genuine zero EPS forecast", () => {
    const raw = { avg: 0, low: 0, high: 0 };
    expect(forecastRange(raw, 0)).toMatchObject({ mean: null, position: null, placeholder: true });
    expect(forecastRange(raw, 2)).toMatchObject({ mean: 0, position: null, issue: null });
    expect(forecastSource(raw, 0, fmt)).toContain("mean 0, low 0, high 0, reported contributor count 0");
  });
  it("reports missing and zero counts explicitly while retaining nonzero means", () => {
    expect(coverageLabel(0, 10.49)).toBe("Count unconfirmed");
    expect(coverageLabel(null, 10.49)).toBe("Count unavailable");
    expect(coverageLabel(1, 10.49)).toBe("1 analyst");
    expect(forecastSource({ avg: 10.49, low: 10.49, high: 0 }, 0, fmt)).toContain("number of analysts supporting this mean is unconfirmed");
  });
  it("plots valid negative ranges and exact endpoints and skips incomplete ranges", () => {
    expect(forecastRange({ avg: -1, low: -2, high: 0 }, 3).position).toBe(0.5);
    expect(forecastRange({ avg: 0, low: 0, high: 1 }, 3).position).toBe(0);
    expect(forecastRange({ avg: 1, low: 0, high: 1 }, 3).position).toBe(1);
    expect(forecastRange({ avg: 1, low: null, high: 1 }, null).position).toBeNull();
  });
});

it("uses valid source readings in AI tool responses and never asserts an inverted range", () => {
  expect(forecastReading({ avg: 48.03836, low: 46.65, high: 41.55097 }, 0))
    .toBe("mean 48.03836, bounds withheld: reported low exceeds high, count unconfirmed");
  expect(forecastReading({ avg: 0, low: 0, high: 0 }, 0)).toContain("no forecast reported");
  expect(forecastReading({ avg: 1.5, low: 1, high: 2 }, 3)).toContain("range 1 to 2, 3 analysts");
});

it("keeps a historical contributor-backed break-even point and excludes an all-zero nonforecast", async () => {
  const { fiscalEpsHistory } = await import("./street");
  const zero = { end: "2026-12-31", eps: 0, eps_lo: 0, eps_hi: 0 };
  const history = fiscalEpsHistory([
    { as_of: "2026-11-23", p: { "0q": { ...zero, eps_n: 3 } } },
    { as_of: "2026-11-24", p: { "0q": { ...zero, eps_n: 0 } } },
  ], "0q", zero.end);
  expect(history.map((reading) => [reading.date, reading.v])).toEqual([["2026-11-23",0]]);
});

it("exposes a dated native observation omitted from an enriched bundle only for the same ticker and fiscal period", async () => {
  const { supplementalForecast } = await import("./street");
  const { normalizeEstimates } = await import("./core");
  const raw = normalizeEstimates("AMG", { earningsTrend: { trend: [{ period: "+1q", endDate: { fmt: "2027-03-31" }, earningsEstimate: { avg: 10.49, low: 10.49, high: 0, numberOfAnalysts: 0 } }] } }, "2026-11-27");
  raw.periods[0].endDate = "2027-03-31";
  const empty = { avg: null, low: null, high: null, n: null, year_ago: null };
  const p = { end: "2027-03-31", code: "+1q" as const, label: "Next quarter", eps: empty, revenue: empty };
  expect(supplementalForecast("AMG", p, "eps", raw)).toMatchObject({ date: "2026-11-27", raw: { avg: 10.49, analysts: 0 } });
  expect(supplementalForecast("SBH", p, "eps", raw)).toBeNull();
  expect(supplementalForecast("AMG", { ...p, end: "2026-12-31" }, "eps", raw)).toBeNull();
  expect(supplementalForecast("AMG", { ...p, eps: { ...empty, avg: 9 } }, "eps", raw)).toBeNull();
});
