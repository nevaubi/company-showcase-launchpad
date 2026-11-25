import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { FAMILIES } from "./view/codes";
import { DEAL_ID } from "./view/url-state";
import type { AbsFamily } from "./view/types";
import type { AbsReadClient } from "./read.server";

const monitorInput = z.object({ family: z.enum(FAMILIES as unknown as [AbsFamily, ...AbsFamily[]]) });
const dealInput = z.object({ deal: z.string().regex(DEAL_ID) });

/** The deal monitor of one family, with the coverage counts of all three. */
export const getAbsMonitor = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => monitorInput.parse(d))
  .handler(async ({ data, context }) => {
    const { readMonitor } = await import("./read.server");
    return readMonitor(context.supabase as unknown as AbsReadClient, data.family);
  });

/** One deal: its filings, the figures of its current filings and the detail of its newest one; null when unknown. */
export const getAbsDeal = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => dealInput.parse(d))
  .handler(async ({ data, context }) => {
    const { readDeal } = await import("./read.server");
    return readDeal(context.supabase as unknown as AbsReadClient, data.deal);
  });
