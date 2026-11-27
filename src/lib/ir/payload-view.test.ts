import { buildPayload } from "./payload";
import { describe, expect, it, vi } from "vitest";
import { IR_PAYLOAD_VIEW_MAX, oversizeOf, selectIrPayload } from "@/lib/ir/payload-view";

describe("IR payload size the page fetches", () => {
  it("fetches payloads up to the limit", () => {
    expect(oversizeOf(19_211_671)).toBe(0);
    expect(oversizeOf(IR_PAYLOAD_VIEW_MAX)).toBe(0);
    expect(oversizeOf(null)).toBe(0);
    expect(oversizeOf(undefined)).toBe(0);
  });
  it("reports the size of a payload beyond the limit", () => {
    expect(oversizeOf(47_233_739)).toBe(47_233_739);
    expect(oversizeOf(IR_PAYLOAD_VIEW_MAX + 1)).toBe(IR_PAYLOAD_VIEW_MAX + 1);
  });
  it("treats an unreadable size as loadable", () => {
    expect(oversizeOf(Number.NaN)).toBe(0);
  });
});

describe("IR source precedence", () => {
  const end = "2024-12-31";
  const period = { end, frequency: "q" as const };
  const payload = (n: number, date = end) =>
    buildPayload(
      "WFC",
      Array.from({ length: n }, (_, i) => ({
        id: String(i),
        document_id: "native-supplement",
        document_kind: "supplement",
        category: "kpi",
        metric: "other",
        label: `Measures ${i}`,
        parent: null,
        is_total: false,
        period_start: null,
        period_end: date,
        months: 3,
        value: i + 10,
        unit: "usd",
        accn: "0000072971-25-000012",
        doc: "exhibit.htm",
        filed: "2025-01-15",
        locator: { t: 1, r: i, c: 1 },
      })),
    );

  it("keeps a smaller native cache and its exact filing in ordinary and period-specific reads", async () => {
    const current = payload(1);
    const stored = vi.fn(async () => null);
    const archive = vi.fn(async () => payload(12));
    for (const requested of [undefined, period]) {
      expect((await selectIrPayload(current, requested, stored, archive)).payload).toBe(current);
    }
    expect(stored).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it("retrieves the missing period from native filings before the archive", async () => {
    const current = payload(5, "2025-03-31");
    const historic = payload(1);
    const archive = vi.fn(async () => payload(15));
    expect(await selectIrPayload(current, period, async () => historic, archive)).toEqual({
      payload: historic,
    });
    expect(archive).not.toHaveBeenCalled();
  });

  it("uses archived disclosures only for missing coverage of the requested frequency and date", async () => {
    const historic = payload(2);
    expect(
      await selectIrPayload(
        null,
        period,
        async () => null,
        async () => historic,
      ),
    ).toEqual({ payload: historic, source: "partner" });
    expect(
      await selectIrPayload(
        null,
        { end, frequency: "y" },
        async () => null,
        async () => historic,
      ),
    ).toEqual({ payload: null });
    expect(
      await selectIrPayload(
        null,
        period,
        async () => null,
        async () => payload(8, "2023-12-31"),
      ),
    ).toEqual({ payload: null });
  });
});
