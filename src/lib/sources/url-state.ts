import { z } from "zod";

const text = (max: number) => z.string().max(max).optional().catch(undefined);

/** Native identifiers stay strings: in particular, a county's leading zero is significant. */
export const altPageSearch = z.object({
  d: text(80),
  view: z.enum(["sources"]).optional().catch(undefined),
  source: text(1024),
  sector: text(128),
  snapshot: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional()
    .catch(undefined),
  entity: text(512),
  geography: text(512),
  period: text(512),
  q: text(200),
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().catch(undefined),
});

export type AltPageSearch = z.infer<typeof altPageSearch>;
export type SourceFilterPatch = Pick<
  AltPageSearch,
  "entity" | "geography" | "period" | "q" | "snapshot"
>;

/** A new source cannot inherit a certificate, county or cursor from a different identity domain. */
export function selectSource(source: string): AltPageSearch {
  return {
    view: "sources",
    source,
    snapshot: undefined,
    entity: undefined,
    geography: undefined,
    period: undefined,
    q: undefined,
    after: undefined,
  };
}

export function sourceFilters(patch: SourceFilterPatch): SourceFilterPatch & { after: undefined } {
  return { ...patch, after: undefined };
}
