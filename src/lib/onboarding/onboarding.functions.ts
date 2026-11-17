import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { seedPlan, starterCells } from "./core";
import { blankSheet } from "@/lib/office/workbook";

/** One-time starter workspace: watchlist (if empty) + a sourced NVIDIA model in Office Studio. Idempotent. */
export const seedStarterWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const uid = context.userId;
    const { data: row } = await sb.from("user_onboarding").select("seeded_at").eq("user_id", uid).maybeSingle();
    const { count } = await sb.from("watchlist").select("ticker", { count: "exact", head: true }).eq("user_id", uid);
    const plan = seedPlan(row, count ?? 0);
    if (!plan.seed) return { seeded: false };
    // Claim first so a double call can't seed twice.
    const now = new Date().toISOString();
    const claim = row
      ? await sb.from("user_onboarding").update({ seeded_at: now, updated_at: now }).eq("user_id", uid).is("seeded_at", null).select("user_id")
      : await sb.from("user_onboarding").insert({ user_id: uid, seeded_at: now }).select("user_id");
    if (claim.error || !claim.data?.length) return { seeded: false };
    if (plan.tickers.length) await sb.from("watchlist").insert(plan.tickers.map((ticker) => ({ ticker, user_id: uid })));
    if (plan.workbook) {
      const id = ulid();
      const { error } = await sb.from("office_files").insert({ id, owner: uid, kind: "xlsx", title: "NVIDIA — starter model" });
      if (!error) {
        const sh = { ...blankSheet("Model"), cells: starterCells(), style: { A1: { b: true }, A3: { b: true }, B3: { b: true }, C3: { b: true }, D3: { b: true } }, widths: { 0: 200 } };
        const wb = { sheets: [sh], active: 0 };
        await sb.storage.from("office-files").upload(`${uid}/${id}.sheets.json`, new Blob([JSON.stringify(wb)], { type: "application/json" }), { upsert: true });
      }
    }
    return { seeded: true };
  });
