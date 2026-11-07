import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Work the partner pipeline (Filed Under, filedunderai.vercel.app) drives on a schedule:
//   POST /api/public/partner/status            → which report slots and supply sets exist
//   POST /api/public/partner/report {ticker, kind} → write/refresh one shared standard report
//   POST /api/public/partner/supply {ticker}       → extract and store one company's supply links
// Auth: `x-partner-key` must equal the PARTNER_DATA_KEY secret. Spend stays bounded by
// ensureReport's global daily limit (report_runs); the partner also caps its own daily calls.

async function keyOk(request: Request) {
  const expected = process.env["PARTNER_DATA_KEY"];
  const given = request.headers.get("x-partner-key");
  if (!expected || expected.length < 32 || !given) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const d = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(d(given), d(expected));
}

const TICKER = z.string().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/);
const reportBody = z.object({ ticker: TICKER, kind: z.enum(["primer", "preview", "recap", "memo"]) });
const supplyBody = z.object({ ticker: TICKER, years: z.number().int().min(1).max(4).optional() });

export const Route = createFileRoute("/api/public/partner/$task")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!(await keyOk(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { coverageOf } = await import("@/lib/coverage");
        const body = await request.json().catch(() => ({}));

        if (params.task === "status") {
          const reports: { ticker: string; kind: string; status: string; data_version: string; updated_at: string }[] = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseAdmin.from("reports").select("ticker, kind, status, data_version, updated_at")
              .eq("scope", "shared").eq("variant", "base").range(from, from + 999);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            reports.push(...(data ?? []));
            if (!data || data.length < 1000) break;
          }
          const supply = new Map<string, number>();
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseAdmin.from("supply_links").select("ticker").eq("is_current", true).range(from, from + 999);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            for (const r of data ?? []) supply.set(r.ticker, (supply.get(r.ticker) ?? 0) + 1);
            if (!data || data.length < 1000) break;
          }
          const since = new Date(Date.now() - 86400_000).toISOString();
          const { count } = await supabaseAdmin.from("report_runs").select("id", { count: "exact", head: true }).gte("created_at", since);
          return Response.json({ reports, supply: Object.fromEntries(supply), reportRuns24h: count ?? 0 });
        }

        if (params.task === "report") {
          const b = reportBody.safeParse(body);
          if (!b.success || !coverageOf(b.data.ticker)) return Response.json({ error: "Bad ticker or kind" }, { status: 400 });
          const { ensureReport } = await import("@/lib/reports/store.server");
          const { loadReportInputs } = await import("@/lib/reports/inputs.server");
          const t0 = Date.now();
          try {
            const row = await ensureReport(supabaseAdmin, {
              ticker: b.data.ticker, kind: b.data.kind, scope: "shared", firmId: null, firmName: null, userId: null, coverage: null, source: "pregen",
            }, () => loadReportInputs(b.data.ticker));
            return Response.json({ ticker: row.ticker, kind: row.kind, status: row.status, title: row.title, error: row.error, ms: Date.now() - t0 });
          } catch (e) {
            const m = (e as Error).message;
            return Response.json({ error: m, limit: /writing limit/i.test(m) }, { status: /writing limit/i.test(m) ? 429 : 500 });
          }
        }

        if (params.task === "supply") {
          const b = supplyBody.safeParse(body);
          const co = b.success ? coverageOf(b.data.ticker) : null;
          if (!b.success || !co) return Response.json({ error: "Bad ticker" }, { status: 400 });
          const { loadDataset, universe } = await import("@/lib/reports/inputs.server");
          const { extractSupply } = await import("@/lib/supply/extract.server");
          try {
            const [d, uni] = await Promise.all([loadDataset(b.data.ticker), universe()]);
            const r = await extractSupply(supabaseAdmin, { ticker: co.ticker, name: d.profile.name, cik: co.cik }, d.filings, uni.map((u) => ({ ticker: u.ticker, name: u.name })), { years: b.data.years });
            return Response.json(r, { status: r.status === "failed" ? 502 : 200 });
          } catch (e) {
            return Response.json({ error: (e as Error).message }, { status: 500 });
          }
        }

        return Response.json({ error: "Unknown task" }, { status: 404 });
      },
    },
  },
});
