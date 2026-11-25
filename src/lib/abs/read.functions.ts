import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { FAMILIES } from "./view/codes";
import { DEAL_ID } from "./view/url-state";
import type { AbsFamily } from "./view/types";
import type { AbsReadClient } from "./read.server";

const monitorInput = z.object({ family: z.enum(FAMILIES as unknown as [AbsFamily, ...AbsFamily[]]) });
const dealInput = z.object({ deal: z.string().regex(DEAL_ID) });

/** The deal monitor of one family, with the coverage counts of all three. Answers a value; a failure is `ok: false`. */
export const getAbsMonitor = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => monitorInput.parse(d))
  .handler(async ({ data, context }) => {
    const { answerOf, readMonitor } = await import("./read.server");
    return answerOf(() => readMonitor(context.supabase as unknown as AbsReadClient, data.family));
  });

/** One deal: its filings, the figures of its current filings and the detail of its newest one; null when unknown. Answers a value. */
export const getAbsDeal = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => dealInput.parse(d))
  .handler(async ({ data, context }) => {
    const { answerOf, readDeal } = await import("./read.server");
    return answerOf(() => readDeal(context.supabase as unknown as AbsReadClient, data.deal));
  });
