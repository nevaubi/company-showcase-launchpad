import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildPublicSnapshot, isPublicTicker } from "./public-company";

/** Public (no sign-in) snapshot for the three sample companies only; every other ticker is refused. */
export const getPublicCompany = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ ticker: z.string().max(10) }).parse(d))
  .handler(async ({ data }) => {
    const ticker = data.ticker.toUpperCase();
    if (!isPublicTicker(ticker)) return null;
    const { loadDataset } = await import("@/lib/reports/inputs.server");
    try {
      return buildPublicSnapshot(await loadDataset(ticker));
    } catch (e) {
      console.error("public company load failed", ticker, e);
      return null;
    }
  });
