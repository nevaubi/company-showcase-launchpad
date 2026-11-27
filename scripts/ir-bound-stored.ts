/**
 * Bound an already stored full IR payload for the page, without re-reading or rebuilding anything.
 * For companies whose row points at an oversize full payload with only a one-filing stub inline
 * (BAC, C): the full file is kept untouched as the downloadable archive, the page gets the same
 * figures bounded by `budgetPayload` (as `rebuildCompany` does), and `built_at` stays as it was,
 * so history holds and the freshness lane see no new build.
 *   bun scripts/ir-bound-stored.ts --tickers=BAC,C [--dry]
 */
import { BUDGET_BYTES, budgetPayload } from "@/lib/ir/payload-budget";
import type { IrPayload } from "@/lib/ir/payload";
import { args, log, sb } from "./lib/supa";

const dry = args.dry !== undefined;
for (const ticker of (args.tickers ?? "").split(",").filter(Boolean)) {
  const { data: row, error } = await sb.from("ir_company_series").select("payload_path, built_at, stats").eq("ticker", ticker).maybeSingle();
  if (error || !row?.payload_path) { log(`${ticker}: no stored row`); continue; }
  const { data: file, error: dl } = await sb.storage.from("ir-documents").download(row.payload_path);
  if (dl || !file) { log(`${ticker}: download failed ${dl?.message}`); continue; }
  const full = JSON.parse(await file.text()) as IrPayload;
  if (full.ticker !== ticker || full.preview) { log(`${ticker}: stored file is not a full history, skipped`); continue; }
  const reserve = 4096;
  let b = budgetPayload(full, { cap: BUDGET_BYTES - reserve });
  // Shorter history is the last resort, as in rebuildCompany; the full file stays the archive.
  for (const quarters of [20, 16, 12]) if (!b.budget.ok) b = budgetPayload(full, { cap: BUDGET_BYTES - reserve, quarters });
  if (!b.budget.ok) { log(`${ticker}: still over budget (${b.budget.after})`); continue; }
  const archivePath = row.payload_path;
  const payload: IrPayload = {
    ...b.payload,
    preview: { basis: "recent-statements", archivePath },
    stats: { ...b.payload.stats, quality: b.payload.stats.quality ? { ...b.payload.stats.quality, budget: b.budget } : b.payload.stats.quality },
  };
  const body = JSON.stringify(payload);
  const bytes = new Blob([body]).size;
  log(`${ticker}: ${full.quarters.length}q/${full.series.length} series ${(b.budget.before / 1e6).toFixed(1)}MB → ${payload.quarters.length}q/${payload.series.length} series ${(bytes / 1e6).toFixed(2)}MB ${payload.quarters[0]}→${payload.quarters.at(-1)}`);
  if (dry) continue;
  const path = `series/${ticker}/${crypto.randomUUID()}.json`;
  const up = await sb.storage.from("ir-documents").upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json" });
  if (up.error) { log(`${ticker}: upload failed ${up.error.message}`); continue; }
  const stats = { ...(row.stats as object), ...payload.stats, build: payload.build, preview: payload.preview };
  const { data: done, error: upd } = await sb.from("ir_company_series")
    .update({ payload: null, payload_path: path, payload_bytes: bytes, stats: stats as never })
    .eq("ticker", ticker).eq("built_at", row.built_at).eq("payload_path", row.payload_path).select("ticker").maybeSingle();
  log(upd || !done ? `${ticker}: row changed meanwhile, not published (${upd?.message ?? ""})` : `${ticker}: published ${path}`);
}
process.exit(0);
