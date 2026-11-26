import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import type { SourceDirectClient } from "@/lib/sources/read.server";
import type { SourceRead } from "@/lib/sources/read-types";
import { CATEGORY_FIELDS_MAX } from "./category-model";
import type { CategoryCounts, TablePeriodsWire } from "./wire";

/**
 * Server functions of unit counts. Each runs behind `requireAppAccess` with the caller's own client (row-level
 * security applies) and answers `SourceRead<T>`: a failure is a value the screen shows as one quiet line.
 */
const client = (context: { supabase: unknown }) => context.supabase as SourceDirectClient;

const categoryInput = z
  .object({
    datasetId: z.string().min(1).max(1024),
    snapshotId: z.string().regex(/^[0-9a-f]{64}$/),
    fields: z.array(z.number().int().min(0).max(16383)).min(1).max(CATEGORY_FIELDS_MAX),
  })
  .strict();

/** Values of up to 24 fields counted over every record of a snapshot of at most 5,000 rows. */
export const getCategoryCounts = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(categoryInput)
  .handler(async ({ data, context }): Promise<SourceRead<CategoryCounts>> => {
    const { readCategoryCounts } = await import("./counts.server");
    return readCategoryCounts(client(context), data);
  });

/** The period range of every dataset's current snapshot (from the snapshot statistics), packed. */
export const getTablePeriods = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .handler(async ({ context }): Promise<SourceRead<TablePeriodsWire>> => {
    const { readTablePeriods } = await import("./counts.server");
    return readTablePeriods(client(context));
  });
