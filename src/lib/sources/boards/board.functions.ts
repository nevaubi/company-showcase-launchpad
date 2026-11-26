import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import type { SourceDirectClient } from "../read.server";
import type { LookCross } from "./board.server";
import type { BoardRead } from "./types";

/**
 * One board of "What the data says", or the tiles of one of its sections, computed on the server from bounded direct
 * reads with the caller's own client (row-level security applies) and cached in the server process per pinned
 * snapshot. A request reads at most 40 selects cold; tiles past that come back in `deferred`, for the client to ask
 * again. Answers a `BoardRead`: a failure is a value.
 */
const tileId = z.string().min(1).max(80).regex(/^[a-z0-9_:-]+$/);
const boardInput = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  tiles: z.array(tileId).min(1).max(18).optional(),
});

export const getBoard = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(boardInput)
  .handler(async ({ data, context }): Promise<BoardRead> => {
    const { readBoard } = await import("./board.server");
    return readBoard(context.supabase as unknown as SourceDirectClient, data.id, Date.now(), data.tiles);
  });

/**
 * One period of a table for a table page's ranking or state grid, read as a rank tile reads it (the greatest period of
 * the profile's declared format, at most five pages of 1,000 records, complete or refused).
 */
const lookInput = z.object({
  datasetId: z.string().min(1).max(200),
  snapshotId: z.string().min(1).max(200),
  field: z.string().min(1).max(300),
  by: z.enum(["entity_id", "entity_name", "geo_code", "geo_name"]),
  period: z.string().min(1).max(200),
  where: z.array(z.object({ field: z.string().min(1).max(300), value: z.string().max(500) })).max(4).optional(),
});

export type LookCrossRead = { ok: true; data: LookCross } | { ok: false; reason: string };

export const getLookCross = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(lookInput)
  .handler(async ({ data, context }): Promise<LookCrossRead> => {
    const { readLookCross } = await import("./board.server");
    return readLookCross(context.supabase as unknown as SourceDirectClient, data);
  });
