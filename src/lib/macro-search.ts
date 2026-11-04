import { z } from "zod";
import type { MacroGroup } from "@/lib/coverage";

export const GROUPS: { id: MacroGroup; title: string }[] = [
  { id: "rates", title: "Rates" },
  { id: "inflation", title: "Inflation" },
  { id: "labor", title: "Labor" },
  { id: "growth", title: "Growth" },
  { id: "consumer", title: "Consumer" },
  { id: "business", title: "Business" },
  { id: "housing", title: "Housing" },
  { id: "liquidity", title: "Liquidity" },
  { id: "credit", title: "Credit & risk" },
  { id: "fiscal", title: "Fiscal" },
  { id: "energy", title: "Energy & commodities" },
  { id: "industry", title: "Industry drivers" },
];
export const GROUP_IDS = ["key", ...GROUPS.map((g) => g.id)] as [string, ...string[]];

export const macroSearch = z.object({
  group: z.enum(GROUP_IDS).default("key"),
  series: z.string().max(30).optional(),
  vs: z.string().max(30).optional(),
  span: z.enum(["2", "5", "10", "20", "max"]).default("10"),
});
