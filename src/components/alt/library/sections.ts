/**
 * The Alt data section's three parts and which one an address belongs to. Pure.
 *
 * Company signals is the hub page itself (`/app/alt-data`, exactly); the Data library and Securitized
 * credit own their whole subtree, so a collection or a table page keeps "Data library" active.
 */
export type AltSection = "signals" | "library" | "credit";

export const ALT_SECTIONS: readonly { id: AltSection; label: string; path: string }[] = [
  { id: "signals", label: "Company signals", path: "/app/alt-data" },
  { id: "library", label: "Data library", path: "/app/alt-data/library" },
  { id: "credit", label: "Securitized credit", path: "/app/alt-data/credit" },
];

export const CREDIT_PATH = "/app/alt-data/credit";

const within = (pathname: string, root: string) => pathname === root || pathname.startsWith(root + "/");

/** The part of the section an address belongs to, or null for an address outside the section. */
export function altSectionFor(pathname: string): AltSection | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (path === "/app/alt-data") return "signals";
  if (within(path, "/app/alt-data/library")) return "library";
  if (within(path, CREDIT_PATH)) return "credit";
  return null;
}
