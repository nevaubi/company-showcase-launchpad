// FDIC call-report fields that did not exist yet come back as 0, not null: the CET1 ratio was first
// reported in 2014-2015, so earlier or unreported quarters read "CET1 0.00%". A CET1 ratio of zero is
// not a reading any operating bank can have, so it is treated as missing. Pure.

/** FDIC fields whose 0 means "not reported". */
export const FDIC_ZERO_IS_MISSING = new Set(["RBCT1CER"]);
const ZERO_TITLES = new Set(["CET1 ratio"]);

/** Whether a stored bank row is a missing value stored as zero. */
export function isBankPlaceholder(r: { dataset: string; title?: string | null; value?: number | null; meta?: unknown }): boolean {
  if (r.dataset !== "bank" || r.value !== 0) return false;
  const field = r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>).field : undefined;
  return (typeof field === "string" && FDIC_ZERO_IS_MISSING.has(field)) || (!!r.title && ZERO_TITLES.has(r.title));
}
