import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import type { SourceDirectClient } from "../read.server";
import type { BoardRead } from "./types";

/**
 * One board of "What the data says", computed on the server from bounded direct reads with the caller's own
 * client (row-level security applies) and cached in the server process per pinned snapshot. Answers a
 * `BoardRead`: a failure is a value.
 */
const boardInput = z.object({ id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/) });

export const getBoard = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator(boardInput)
  .handler(async ({ data, context }): Promise<BoardRead> => {
    const { readBoard } = await import("./board.server");
    return readBoard(context.supabase as unknown as SourceDirectClient, data.id);
  });
