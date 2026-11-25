import { z } from "zod";

/**
 * A native identifier, code, name or search text from the address. The router's default
 * parser reads every value as JSON, so a typed `entity=628` arrives as the number 628 while a
 * link the app wrote arrives as the string "628". A safe integer is turned back into its
 * digits, so both give the same string (rev-app M2). A value the parser has already changed
 * ("1.50" became 1.5, a 20-digit identifier lost digits, "-0") is refused rather than
 * altered; a code with a leading zero ("01001") is not JSON and stays a string.
 */
export const nativeSearchText = (max: number) =>
  z
    .preprocess(
      (value) =>
        typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)
          ? String(value)
          : value,
      z.string().max(max),
    )
    .optional()
    .catch(undefined);
const text = nativeSearchText;

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
