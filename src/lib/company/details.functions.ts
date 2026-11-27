import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { CURATED_COVERAGE } from "@/lib/coverage";
import { descriptionOrigin, type CompanyDetails } from "@/lib/company/details";

const tickerSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,10}$/);

/** Signed-in profile enrichment. Each reviewed corporate or IR link takes precedence for this registrant. */
export const getCompanyDetails = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema, cik: z.string().regex(/^\d{1,10}$/).optional() }).parse(d))
  .handler(async ({ data }): Promise<CompanyDetails> => {
    const { reviewedCompanyDetails } = await import("./issuer-directory.server");
    const d = await reviewedCompanyDetails(data.ticker, data.cik);
    const curated = CURATED_COVERAGE.some((c) => c.ticker === data.ticker);
    return {
      directory: d.directory,
      ...(d.website ? { website: d.website } : {}),
      ...(d.ir ? { ir: d.ir } : {}),
      ...(d.founded ? { founded: d.founded } : {}),
      ...(d.description ? { description: d.description, origin: descriptionOrigin(d.description, curated) } : {}),
    };
  });
