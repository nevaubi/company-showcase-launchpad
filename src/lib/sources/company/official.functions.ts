import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import type { CompanyOfficialResult } from "./types";
import { OB_MAX_APPLICATIONS, type CompanyPatentsResult } from "./orange-book";
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

/** A ticker and the new drug applications its FDA panel shows, each with the sponsor the panel names. */
export const companyPatentsInput = z
  .object({
    ticker: z.string().trim().min(1).max(10).regex(/^[A-Za-z][A-Za-z0-9.-]*$/),
    asks: z
      .array(z.object({ appl: z.string().regex(/^\d{6}$/), sponsor: z.string().trim().min(1).max(160) }).strict())
      .max(OB_MAX_APPLICATIONS),
  })
  .strict();

/**
 * Orange Book patents and exclusivity of those applications, read by application number, each line with its stored
 * rows; an application is shown only while the Orange Book's applicant is the sponsor the FDA panel names.
 */
export const getCompanyPatents = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(companyPatentsInput)
  .handler(async ({ data, context }): Promise<CompanyPatentsResult> => {
    const { readCompanyPatents } = await import("./orange-book.server");
    return readCompanyPatents(context.supabase as unknown as OfficialClient, data.ticker, data.asks);
  });
