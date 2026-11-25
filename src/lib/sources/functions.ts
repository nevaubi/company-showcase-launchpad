import { createServerFn } from "@tanstack/react-start";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { recordInput, sourceDetailInput, sourceListInput } from "./validation";
import type { SourceReadClient } from "./query.server";

export const listSources = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(sourceListInput)
  .handler(async ({ data, context }) => {
    const { readSourceDatasets } = await import("./query.server");
    return readSourceDatasets(context.supabase as unknown as SourceReadClient, data);
  });

export const getSourceDataset = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(sourceDetailInput)
  .handler(async ({ data, context }) => {
    const { readSourceDataset } = await import("./query.server");
    return readSourceDataset(context.supabase as unknown as SourceReadClient, data.id, data.snapshotId);
  });

export const querySourceRecords = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(recordInput)
  .handler(async ({ data, context }) => {
    const { readSourceRecords } = await import("./query.server");
    return readSourceRecords(context.supabase as unknown as SourceReadClient, data);
  });
