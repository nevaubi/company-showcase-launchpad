import { describe, expect, it } from "vitest";
import { comparisonColumns, isComparisonPosition } from "./table-fill";
import { parseGrid } from "./table-grid";

describe("as-filed comparison column groups", () => {
  it("handles the Wells Fargo group whose dated subcolumns project beyond its printed colspan", () => {
    const grid = parseGrid(
      "<table><tr><td></td><td>Quarter ended</td><td>Sep 30, 2024 % Change from</td></tr><tr><td></td><td>Sep 30, 2024</td><td></td><td>Jun 30, 2024</td><td>Sep 30, 2023</td></tr><tr><td>Deposits</td><td>773.6</td><td></td><td>(1)</td><td>(3)</td></tr></table>",
    );
    expect([...comparisonColumns(grid[0], 2)]).toEqual([2, 3, 4]);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 1 })).toBe(false);
    expect(isComparisonPosition(grid, { t: 0, r: 2, c: 3 })).toBe(true);
  });
  it("stops at the next group of actuals and keeps a percent unit on a reported margin", () => {
    const grid = parseGrid(
      "<table><tr><td></td><td>Quarter ended</td><td>Change from</td><td></td><td>Nine months ended</td><td>%</td></tr><tr><td>Margin</td><td>3</td><td>2</td><td>4</td><td>5</td><td>6</td></tr></table>",
    );
    expect([...comparisonColumns(grid[0], 1)]).toEqual([2, 3]);
  });
});
