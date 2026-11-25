import { createServerFn } from "@tanstack/react-start";
import { requireAppAccess } from "@/lib/app-access-middleware";
import {
  completenessReadInput, crossSectionReadInput, entitiesReadInput, facetsReadInput, findReadInput,
  periodRangeReadInput, recordReadInput, seriesReadInput, statsReadInput,
} from "./read-types";
import type { SourceDirectClient } from "./read.server";

/**
 * Server functions of the official-dataset reads. Each runs behind `requireAppAccess` with the caller's own
 * client (row-level security applies) and answers `SourceRead<T>` from `read-types.ts`: a failure is a value,
 * and `unavailable` (the database update is not applied yet) is a normal answer the screen falls back from.
 */
const client = (context: { supabase: unknown }) => context.supabase as SourceDirectClient;

export const getSourceRecord = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(recordReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceRecord } = await import("./read.server");
    return readSourceRecord(client(context), data);
  });

export const getSourceSeries = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(seriesReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceSeries } = await import("./read.server");
    return readSourceSeries(client(context), data);
  });

export const getSourceCrossSection = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(crossSectionReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceCrossSection } = await import("./read.server");
    return readSourceCrossSection(client(context), data);
  });

export const getSourcePeriodRange = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(periodRangeReadInput)
  .handler(async ({ data, context }) => {
    const { readSourcePeriodRange } = await import("./read.server");
    return readSourcePeriodRange(client(context), data);
  });

export const getSourceEntities = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(entitiesReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceEntities } = await import("./read.server");
    return readSourceEntities(client(context), data);
  });

export const getFieldCompleteness = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(completenessReadInput)
  .handler(async ({ data, context }) => {
    const { readFieldCompleteness } = await import("./read.server");
    return readFieldCompleteness(client(context), data);
  });

/** Needs migration 0069; answers `unavailable` until then. */
export const getSourceFacets = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(facetsReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceFacets } = await import("./read.server");
    return readSourceFacets(client(context), data);
  });

/** Needs migration 0069; answers `unavailable` until then (the library's client-side search still works). */
export const findSources = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(findReadInput)
  .handler(async ({ data, context }) => {
    const { readSourceFind } = await import("./read.server");
    return readSourceFind(client(context), data);
  });

/** Needs migration 0069 and the worker's statistics; answers `unavailable` until then. */
export const getSnapshotStats = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(statsReadInput)
  .handler(async ({ data, context }) => {
    const { readSnapshotStats } = await import("./read.server");
    return readSnapshotStats(client(context), data);
  });
