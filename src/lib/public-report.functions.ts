import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicReport } from "@/lib/reports/public";
import type { ReportContent } from "@/lib/reports/types";

/** A public primer page: the free cut of the stored standard primer, plus what the page needs to link sources to SEC EDGAR. */
export interface PublicReportPage extends PublicReport {
  updatedAt: string;
  sector: string | null;
  industry: string | null;
  /** SEC CIK by ticker for the report company and any peer it cites, so source links resolve without the coverage list in the browser. */
  ciks: Record<string, string>;
}

export interface PublicReportListItem {
  ticker: string;
  name: string;
  sector: string;
  title: string;
  updatedAt: string;
}

/**
 * Public (no sign-in) cut of a company's standard primer. Read-only: it never writes or refreshes a
 * report, so it spends no AI credits. Only shared standard primers that finished writing are served,
 * and only their first sections (see publicSlice); everything else stays behind sign-in.
 */
export const getPublicReport = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ ticker: z.string().max(10) }).parse(d))
  .handler(async ({ data }): Promise<PublicReportPage | null> => {
    const ticker = data.ticker.toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return null;
    const { coverageOf } = await import("@/lib/coverage");
    const co = coverageOf(ticker);
    if (!co) return null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row, error } = await supabaseAdmin
        .from("reports")
        .select("content, updated_at")
        .eq("ticker", ticker)
        .eq("kind", "primer")
        .eq("scope", "shared")
        .eq("variant", "base")
        .eq("status", "ready")
        .is("firm_id", null)
        .is("user_id", null)
        .maybeSingle();
      if (error || !row?.content) return null;
      const full = row.content as unknown as ReportContent;
      if (!Array.isArray(full.sections) || !full.sections.length) return null;
      const { publicSlice } = await import("@/lib/reports/public");
      const cut = publicSlice(full);

      const tickers = new Set<string>([ticker, ...(cut.content.peers ?? []).map((p) => p.ticker)]);
      for (const f of cut.content.facts) if ("tk" in f.ref && f.ref.tk) tickers.add(f.ref.tk);
      const ciks: Record<string, string> = {};
      for (const t of tickers) {
        const c = coverageOf(t);
        if (c?.cik) ciks[t] = c.cik;
      }

      return {
        ...cut,
        updatedAt: row.updated_at,
        sector: co.sector ?? null,
        industry: co.industry ?? null,
        ciks,
      };
    } catch (e) {
      console.error("public report load failed", ticker, e);
      return null;
    }
  });

/** Every company with a finished standard primer, newest first — the public research index and the sitemap. */
export const listPublicReports = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicReportListItem[]> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { coverageOf } = await import("@/lib/coverage");
      const { data, error } = await supabaseAdmin
        .from("reports")
        .select("ticker, title, updated_at")
        .eq("kind", "primer")
        .eq("scope", "shared")
        .eq("variant", "base")
        .eq("status", "ready")
        .is("firm_id", null)
        .is("user_id", null)
        .not("title", "is", null)
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (error || !data) return [];
      return data.flatMap((r) => {
        const co = coverageOf(r.ticker);
        return co && r.title
          ? [
              {
                ticker: r.ticker,
                name: co.shortName,
                sector: co.sector,
                title: r.title,
                updatedAt: r.updated_at,
              },
            ]
          : [];
      });
    } catch (e) {
      console.error("public report list failed", e);
      return [];
    }
  },
);
