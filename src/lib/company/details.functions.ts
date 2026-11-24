import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { CURATED_COVERAGE } from "@/lib/coverage";
import { descriptionOrigin, type CompanyDetails } from "@/lib/company/details";

const tickerSchema = z.string().regex(/^[A-Z][A-Z.-]{0,7}$/);

/**
 * Website, IR address, founding year and description of a covered company from the server-only coverage details
 * (`src/lib/coverage-details.server.ts`, kept out of the browser bundle). The Overview's About section and the
 * header's IR link use it for whichever field the served profile lacks (profiles of the generated list until the
 * partner's next build). Signed-in users with app access only.
 */
export const getCompanyDetails = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data }): Promise<CompanyDetails> => {
    const { coverageDetails } = await import("@/lib/coverage-details.server");
    const d = coverageDetails(data.ticker);
    const curated = CURATED_COVERAGE.some((c) => c.ticker === data.ticker);
    return {
      ...(d.website ? { website: d.website } : {}),
      ...(d.ir ? { ir: d.ir } : {}),
      ...(d.founded ? { founded: d.founded } : {}),
      ...(d.description ? { description: d.description, origin: descriptionOrigin(d.description, curated) } : {}),
    };
  });
