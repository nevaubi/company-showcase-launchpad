// Address state of the "Securitized credit" view (/app/alt-data/credit). The route validates the search
// string with `absSearch` and passes the values down; every key is optional and an invalid value reads
// as absent, so a hand-edited address never breaks the page. A deal page is one page of sections with
// an in-page nav, so no tab is kept in the address.
import { z } from "zod";
import { FAMILIES } from "./codes";
import type { AbsFamily } from "./types";

/** A deal id is the issuing entity's CIK as ten digits, or a depositor's CIK, a colon and a file number. */
export const DEAL_ID = /^\d{10}(:[0-9A-Za-z.-]{1,40})?$/;

export const absSearchShape = {
  /** which family's monitor is open; auto loans when absent */
  family: z.enum(FAMILIES as unknown as [AbsFamily, ...AbsFamily[]]).optional().catch(undefined),
  /** the open deal page; the monitor when absent */
  deal: z.string().regex(DEAL_ID).optional().catch(undefined),
  /** monitor sort as "key:asc" or "key:desc"; the family's default when absent or unknown */
  sort: z
    .string()
    .regex(/^[a-z0-9_]{1,24}:(asc|desc)$/)
    .optional()
    .catch(undefined),
  /** monitor filter on the issuer name, CIK or deal id */
  q: z.string().max(80).optional().catch(undefined),
};

export const absSearch = z.object(absSearchShape);
export type AbsSearch = z.infer<typeof absSearch>;

export const DEFAULT_FAMILY: AbsFamily = "auto_loan";

export const familyOf = (s: AbsSearch): AbsFamily => s.family ?? DEFAULT_FAMILY;

/** Another family: its own default sort and no open deal; the name filter is kept. */
export function selectFamily(family: AbsFamily): AbsSearch {
  return { family: family === DEFAULT_FAMILY ? undefined : family, deal: undefined, sort: undefined };
}

/** Open a deal; the family it belongs to stays as the monitor to return to. */
export function openDeal(deal: string, family: AbsFamily): AbsSearch {
  return { deal, family: family === DEFAULT_FAMILY ? undefined : family };
}

/** Back to the monitor: sort and name filter stay as they were. */
export function closeDeal(): AbsSearch {
  return { deal: undefined };
}

/** A sort for the monitor; the family's default is kept out of the address. */
export function selectSort(text: string, isDefault: boolean): AbsSearch {
  return { sort: isDefault ? undefined : text };
}

/** The name filter; an empty one is removed from the address. */
export function selectQuery(text: string): AbsSearch {
  const q = text.slice(0, 80);
  return { q: q.trim() ? q : undefined };
}
