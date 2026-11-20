import { describe, expect, it } from "vitest";
import { buildIrSeries, orderVintages, sortDate, type IrFact } from "./kpis";
import { XYZ_FACTS } from "@/test/ir-xyz";

// Real conflicting keys from Block's (XYZ) releases; see src/test/ir-xyz.ts.
const byId = (id: string) => XYZ_FACTS.find((f) => f.id === id)!;
const vin = (f: IrFact) => ({ v: f.value, fact: f, doc: f.document_id!, filed: sortDate(f) });
const totalNet = (b: ReturnType<typeof buildIrSeries>, scope: string) => b.series.find((s) => s.key === `product|revenue|total revenue|usd||@${scope}`)!;

describe("conflicting values: the choice is deterministic and the other value stays visible", () => {
  const built = buildIrSeries(XYZ_FACTS);

  it("the newest filing wins and the earlier value is kept as a restatement with its source (FY 2018)", () => {
    const c = totalNet(built, "revenue").annual["2018-12-31"];
    expect(c.v).toBe(3_298_177_000);
    expect(c.fact!.filed).toBe("2020-02-26");
    expect(c.alt).toMatchObject({ v: 3_149_915, kind: "restated" });
    expect(c.alt!.fact.document_kind).toBe("supplement");
    expect(c.alt!.fact.filed).toBe("2019-11-01");
  });

  it("same filing date: the earnings release beats an 'other' exhibit printed the same day, kept as a conflict (Q4 2019)", () => {
    const c = totalNet(built, "revenue").cells["2019-12-31"];
    expect(c.v).toBe(1_313_429_000);
    expect(c.fact!.document_kind).toBe("press-release");
    expect(c.alt).toMatchObject({ v: 15_046_000, kind: "conflict" });
    expect(c.alt!.fact.document_kind).toBe("other");
  });

  it("same filing and kind: the value printed by more documents wins (Q4 2019 in the Feb 2021 release)", () => {
    // The 23 Feb 2021 release prints Q4 2019 total net revenue as 1,313,429 (thousands) in one table
    // and 1,313,429,000 in another; the 26 Feb 2020 release printed 1,313,429,000.
    const order = orderVintages([vin(byId("921a323c-e169-4997-8418-99165948f0e2")), vin(byId("882172dd-efd5-4248-89a6-562687de22d6")), vin(byId("0aa7c69e-64b0-47b7-8f48-7f478fc1c03d"))]);
    expect(order.map((v) => v.v)).toEqual([1_313_429_000, 1_313_429, 1_313_429_000]);
    expect(order[0].fact.filed).toBe("2021-02-23");
  });

  it("row order never decides: shuffled facts give the same values and the same sources", () => {
    const snap = (b: ReturnType<typeof buildIrSeries>) =>
      Object.fromEntries(b.series.flatMap((s) => [...Object.entries(s.cells), ...Object.entries(s.annual).map(([e, c]) => [`FY${e}`, c] as const)].map(([e, c]) => [`${s.key}|${e}`, `${c.v}|${c.fact?.id ?? c.derived?.formula}|${c.alt?.fact.id ?? ""}`])));
    const ref = snap(built);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3; i++) {
      const shuffled = [...XYZ_FACTS].sort(() => rnd() - 0.5);
      expect(snap(buildIrSeries(shuffled))).toEqual(ref);
    }
  });
});

describe("facts without a filing date", () => {
  const q1 = byId("8bbffd0f-4d32-42d0-87b1-9c29889e1b7b"); // Q1 2020, release filed 2020-05-06
  it("sort at their period end plus 45 days, never shown as a filing date", () => {
    expect(sortDate({ filed: null, period_end: "2020-03-31" })).toBe("2020-05-15");
    expect(sortDate(q1)).toBe("2020-05-06");
    const undated = { ...q1, id: "undated", filed: null, value: 1_381_109_000 };
    const b = buildIrSeries([q1, undated]);
    const cell = b.series[0].cells["2020-03-31"];
    // The undated copy sorts at 15 May, after the 6 May release: it is shown, and its fact still says filed: null.
    expect(cell.fact!.id).toBe("undated");
    expect(cell.fact!.filed).toBeNull();
    expect(cell.alt).toMatchObject({ v: 1_381_109, kind: "conflict" });
  });
  it("lose to a dated filing of the same sort day", () => {
    const dated = { ...q1, filed: "2020-05-15" };
    const undated = { ...q1, id: "undated", filed: null, value: 1 };
    expect(orderVintages([vin(undated), vin(dated)])[0].fact.id).toBe(q1.id);
  });
});
