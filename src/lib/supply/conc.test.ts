import { describe, expect, it } from "vitest";
import { concentrationBasis } from "./core";
describe("concentrationBasis", () => {
  it("vendor receivables are not customer revenue", () => expect(concentrationBasis("two vendors that individually represented 10% or more of total vendor non-trade receivables, which accounted for 46 %")).toBe("vendor"));
  it("trade receivables", () => expect(concentrationBasis("one customer that represented 10% or more of total trade receivables, which accounted for 12 %")).toBe("receivables"));
  it("sales channels", () => expect(concentrationBasis("net sales through its direct and indirect distribution channels accounted for 40%")).toBe("channel"));
  it("customer revenue", () => expect(concentrationBasis("Sales to one direct customer represented 22% of total revenue")).toBe("revenue"));
});
