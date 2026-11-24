// What a globe marker badge draws for a company. A badge is a small square (16 to 40 css px), so it follows the small
// plates of `CompanyLogo` (logoChoice at "sm"): a square mark as it is; a wide wordmark, unreadable at that size, gives way
// to the company's own square site icon when one was collected, else to the letter plate the globe draws for a missing mark.
// A name with no bundled mark keeps the logo looked up by its domain (`fallback`), never trusted to stand for a cluster.
import { logoChoice } from "@/components/app/company-logo";

export interface BadgeLogo {
  /** image address, or undefined for the letter plate */
  logo?: string;
  /** the company's own mark or icon (not a favicon by domain): only such a logo stands for a whole cluster */
  trusted: boolean;
  /** the image paints its own square background and fills the plate */
  fill: boolean;
}

export function badgeLogo(ticker: string | null | undefined, fallback: string | undefined): BadgeLogo {
  if (!ticker) return { logo: fallback, trusted: false, fill: false };
  const c = logoChoice(ticker, "sm");
  if (c.kind === "letters") return { trusted: false, fill: false };
  if (c.kind === "icon") return { logo: c.url, trusted: true, fill: c.tile };
  if (c.kind === "mark") return c.url.startsWith("/logos/") ? { logo: c.url, trusted: true, fill: c.tile } : { logo: fallback ?? c.url, trusted: false, fill: false };
  return { trusted: false, fill: false };
}
