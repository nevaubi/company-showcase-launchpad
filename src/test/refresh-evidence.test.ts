// Review rev-workers S5: a held collection is not collected again every 30 minutes, and the evidence
// folders failed or held collections leave on the worker's disk do not pile up for good.
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshFailure, refreshHeld } from "@/lib/sources/refresh-plan";
import { REFRESH_EVIDENCE_KEEP_MS, sweepRefreshFolders } from "../../scripts/lib/source-cache";

const NOW = Date.parse("2026-11-25T19:00:00Z");

describe("a held collection", () => {
  it("is tried again a day later, keeping its failure count and reason", () => {
    const reason = "Native header labels or order changed; schema review is required before publication.";
    const held = refreshHeld({ failures: 1, last_checked_at: "2026-11-24T06:00:00.000Z" }, new Date(NOW), reason);
    expect(held).toMatchObject({ failures: 2, last_error: reason, next_due_at: "2026-11-26T19:00:00.000Z", last_checked_at: "2026-11-24T06:00:00.000Z" });
    // an ordinary failure still backs off from 30 minutes
    expect(refreshFailure({}, new Date(NOW), "timeout").next_due_at).toBe("2026-11-25T19:30:00.000Z");
  });
});

describe("refresh evidence folders on the worker's disk", () => {
  it("are removed after a week; nothing else in the work folder is touched", () => {
    const work = mkdtempSync(join(tmpdir(), "refresh-evidence-test-"));
    const old = (NOW - REFRESH_EVIDENCE_KEEP_MS - 60_000) / 1000;
    for (const name of ["refresh-fdic-Ab12Cd", "refresh-twse-x9", "refresh-k3L", "refresh-new", "sec", "receipts"]) {
      mkdirSync(join(work, name));
      writeFileSync(join(work, name, "response.json"), "{}");
      if (name !== "refresh-new") utimesSync(join(work, name), old, old);
    }
    writeFileSync(join(work, "refresh-file"), "not a folder");
    utimesSync(join(work, "refresh-file"), old, old);
    const outside = mkdtempSync(join(tmpdir(), "refresh-evidence-outside-"));
    symlinkSync(outside, join(work, "refresh-link"));
    expect(sweepRefreshFolders(work, NOW).sort()).toEqual(["refresh-fdic-Ab12Cd", "refresh-k3L", "refresh-twse-x9"]);
    expect(["refresh-new", "sec", "receipts", "refresh-file", "refresh-link"].every((n) => existsSync(join(work, n)))).toBe(true);
    expect(existsSync(outside)).toBe(true);
    expect(sweepRefreshFolders(join(work, "missing"), NOW)).toEqual([]);
  });
});
