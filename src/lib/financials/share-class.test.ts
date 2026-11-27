import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts } from "./build";
import { classFactsFromInline, isClassMember, tickerShareClass } from "./share-class";
import brk from "./fixtures/nci-brk-facts.json";
// Verbatim excerpt of Berkshire Hathaway's 10-Q for Q3 2026: its EPS and average shares, tagged by class only.
import html from "./fixtures/class-eps-brk.htm?raw";

const filing = { accn: "0001193125-26-452412", form: "10-Q", filed: "2026-11-09" };

describe("EPS tagged by share class (finaud-07)", () => {
  it("knows the class a ticker trades as and the members that name it", () => {
    expect(tickerShareClass("BRK-B")).toBe("B");
    expect(tickerShareClass("V")).toBe("A");
    expect(isClassMember("brka:EquivalentClassBMember", "B")).toBe(true);
    expect(isClassMember("us-gaap:CommonClassAMember", "A")).toBe(true);
    expect(isClassMember("brka:EquivalentClassAMember", "B")).toBe(false);
  });

  it("reads Berkshire's Class B EPS and shares and shows them as the ticker's EPS, named for the class", () => {
    const facts = classFactsFromInline(html, "B", filing);
    expect(facts.get("classB:EarningsPerShareBasic")?.find((f) => f.start === "2026-07-01")?.val).toBe(10.33);
    const cf = structuredClone(brk) as CompanyFacts;
    cf.facts.classB = {};
    for (const [q, list] of facts) {
      const local = q.split(":")[1];
      cf.facts.classB[local] = { units: { [local.startsWith("Earnings") ? "USD/shares" : "shares"]: list } };
    }
    const inc = buildStatements(cf).quarterly.income;
    const i = inc.periods.findIndex((p) => p.label === "Q3 FY26");
    const eps = inc.rows.find((r) => r.key === "epsBasic")!;
    // "Net earnings per average equivalent Class B share" $10.33; average equivalent Class B shares 2,139,557,257.
    expect(eps.cells[i]?.v).toBe(10.33);
    expect(eps.label).toBe("EPS, basic (Class B)");
    expect(inc.rows.find((r) => r.key === "sharesBasic")?.cells[i]?.v).toBe(2_139_557_257);
  });

  it("leaves EPS out of a build without the class facts, as before", () => {
    const inc = buildStatements(brk as CompanyFacts).quarterly.income;
    expect(inc.rows.find((r) => r.key === "epsBasic")).toBeUndefined();
  });
});

describe("Goldman Sachs' basic EPS under its participating-securities concept (finaud-07)", () => {
  it("shows the printed basic EPS where no EarningsPerShareBasic is tagged", async () => {
    const gs = structuredClone((await import("./fixtures/eps-gs-facts.json")).default) as CompanyFacts;
    // 10-Q 0000886982-26-000532 statement of earnings: "Basic" $17.24 for Q3 2026 (the company's own concept, read from
    // the filing at ingest like every extension a line lists).
    gs.facts.gs = {
      EarningsPerShareExcludingNetEarningsAttributedToParticipatingSecuritiesBasic: {
        units: { "USD/shares": [{ start: "2026-07-01", end: "2026-09-30", val: 17.24, accn: "0000886982-26-000532", form: "10-Q", filed: "2026-11-02" }] },
      },
    };
    const inc = buildStatements(gs, { bank: true }).quarterly.income;
    const i = inc.periods.findIndex((p) => p.label === "Q3 FY26");
    const c = inc.rows.find((r) => r.key === "epsBasic")?.cells[i];
    expect(c?.v).toBe(17.24);
    expect(c?.src?.concept).toBe("gs:EarningsPerShareExcludingNetEarningsAttributedToParticipatingSecuritiesBasic");
  });
});
