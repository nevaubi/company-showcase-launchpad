import { expect, it } from "vitest";
import { holdCutoff, holdKey, publicationWindow } from "./history-hold";
it("limits a historical hold to its company and keeps subsequently processed fresh filings eligible", () => {
  expect(holdKey("BAC")).toBe("ir-historical-hold:BAC");
  expect(holdCutoff("before:2023-10-27")).toBe("2023-10-27");
  expect(holdCutoff(null)).toBeNull();
  const now = Date.parse("2026-11-27T12:00Z"),
    held = "2026-11-27T11:14:00Z",
    before = "2026-11-27T01:56:32Z";
  expect(publicationWindow("2023-10-27", held, before, 45, now)).toEqual({
    filedSince: "2026-10-13",
    processedSince: "2026-11-27T11:14:00.000Z",
  });
  expect(publicationWindow("2026-11-01", held, "2026-11-27T11:30:00Z", 45, now)).toEqual({
    filedSince: "2026-11-01",
    processedSince: "2026-11-27T11:30:00.000Z",
  });
});
