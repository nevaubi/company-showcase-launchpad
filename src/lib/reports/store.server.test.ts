import { expect, it, vi } from "vitest";
import { ensureReport, type EnsureArgs } from "./store.server";
import type { ReportInputs } from "./types";

const { write } = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("./generate.server", () => ({ generateReportContent: write }));

it.each(["success", "error"])("a late writer cannot replace a reclaimed slot after %s", async (outcome) => {
  const row = { id: "r", ticker: "JPM", kind: "primer", scope: "shared", variant: "base", status: "failed", data_version: "old", title: null as string | null, started_at: null as string | null, updated_at: "2026-01-01T00:00:00Z" };
  const runs: Record<string, unknown>[] = [];
  const db = { from(table: string) {
    const filters = new Map<string, unknown>();
    let update: Record<string, unknown> | null = null;
    let inserting = false;
    function resolve() {
      if (table === "report_runs") {
        if (update) runs.push(update);
        return { data: inserting ? { id: "run" } : null, count: 0 };
      }
      const matches = [...filters].every(([k, v]) => (row as Record<string, unknown>)[k] === v);
      if (update && !matches) return { data: null };
      if (update) Object.assign(row, update);
      return { data: { ...row } };
    }
    const q = {
      select() { return q; }, gte() { return q; }, is() { return q; },
      eq(k: string, v: unknown) { filters.set(k, v); return q; },
      insert() { inserting = true; return q; }, update(v: Record<string, unknown>) { update = v; return q; },
      single: resolve, maybeSingle: resolve,
      then(cb: (value: unknown) => unknown) { return Promise.resolve(resolve()).then(cb); },
    };
    return q;
  } };
  write.mockImplementationOnce(async () => {
    row.status = "ready"; row.title = "New version"; row.started_at = "2026-11-27T16:00:00Z";
    if (outcome === "error") throw new Error("Old request failed");
    return { title: "Old writer", dataVersion: "old" };
  });
  const args: EnsureArgs = { ticker: "JPM", kind: "primer", scope: "shared", firmId: null, firmName: null, userId: null, coverage: null, source: "pregen" };
  const inputs = { data: { filings: [], earningsReleases: [] }, today: "2026-11-27" } as unknown as ReportInputs;
  const result = await ensureReport(db as unknown as Parameters<typeof ensureReport>[0], args, async () => inputs);
  expect(result.title).toBe("New version");
  expect(result.status).toBe("ready");
  expect(runs).toContainEqual(expect.objectContaining({ status: "failed", error: "A newer writer claimed this report" }));
});
