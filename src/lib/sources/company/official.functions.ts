import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import type { CompanyOfficialResult } from "./types";
import type { OfficialClient } from "./official.server";

/** A ticker and, optionally, the FDIC certificate whose quarterly history to include (ignored unless proven for the ticker). */
export const companyOfficialInput = z
  .object({
    ticker: z.string().trim().min(1).max(10).regex(/^[A-Za-z][A-Za-z0-9.-]*$/),
    cert: z.string().regex(/^[1-9]\d{0,6}$/).optional(),
  })
  .strict();

/**
 * The company's official records in one round trip: insured banks and their FDIC lines, one bank's quarterly
 * history, the holding company's FR Y-9C capital lines, every figure with its stored record. Runs with the
 * signed-in member's own client behind `requireAppAccess`; answers `{ ok: false, reason }` instead of throwing.
 */
export const getCompanyOfficial = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(companyOfficialInput)
  .handler(async ({ data, context }): Promise<CompanyOfficialResult> => {
    const { readCompanyOfficial } = await import("./official.server");
    return readCompanyOfficial(context.supabase as unknown as OfficialClient, data.ticker, data.cert);
  });
