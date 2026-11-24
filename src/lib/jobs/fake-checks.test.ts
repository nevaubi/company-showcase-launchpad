import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKS, fakeSupabase } from "@/test/fake-supabase";

describe("the test database refuses what production refuses", () => {
  it("refuses a value outside a CHECK constraint on insert, upsert and update, and stores nothing", async () => {
    const f = fakeSupabase({ ir_release_scan: [{ accn: "a-1", status: "done" }] });
    type Answer = Promise<{ error: { message: string } | null }>;
    type Q = { upsert(v: unknown, o?: unknown): Answer; insert(v: unknown): Answer; update(v: unknown): { eq(c: string, v: unknown): Answer } };
    const db = { client: { from: (t: string) => f.client.from(t) as unknown as Q }, tables: f.tables };
    const up = await db.client.from("ir_release_scan").upsert({ accn: "a-2", status: "retry" }, { onConflict: "accn" });
    expect(up.error?.message).toBe('new row for relation "ir_release_scan" violates check constraint "ir_release_scan_status_check"');
    const upd = await db.client.from("ir_release_scan").update({ status: "error" }).eq("accn", "a-1");
    expect(upd.error).toBeTruthy();
    expect(db.tables.ir_release_scan).toEqual([{ accn: "a-1", status: "done" }]);
    expect((await db.client.from("email_log").insert({ idempotency_key: "k", status: "bounced" })).error).toBeTruthy();
    expect((await db.client.from("email_log").insert({ idempotency_key: "k", status: "queued" })).error).toBeNull();
  });
  it("declares the same allowed values as the migrations", () => {
    const sql = ["0009_ir_release_scan.sql", "0064_waitlist_emails.sql", "0028_report_library.sql", "0030_filing_redlines.sql"].map((f) => readFileSync(`drizzle/migrations/${f}`, "utf8")).join("\n");
    const inSql = (col: string, values: readonly unknown[]) => new RegExp(`${col} text NOT NULL[^\\n]*CHECK \\(${col} IN \\(${values.map((v) => `'${String(v)}'`).join(",\\s*")}\\)\\)`).test(sql);
    expect(inSql("status", CHECKS.ir_release_scan.status.allowed)).toBe(true);
    expect(inSql("status", CHECKS.email_log.status.allowed)).toBe(true);
    expect(inSql("status", CHECKS.reports.status.allowed)).toBe(true);
    expect(inSql("form", CHECKS.filing_redlines.form.allowed)).toBe(true);
  });
});
