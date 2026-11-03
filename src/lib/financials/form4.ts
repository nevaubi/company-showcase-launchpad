// Pure SEC Form 4 parsing, shared by the ingest script and the filing-scan job.
import type { InsiderTrade } from "./types";

const tagVal = (xml: string, path: string[]): string | undefined => {
  let scope = xml;
  for (const t of path) {
    const m = scope.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"));
    if (!m) return undefined;
    scope = m[1];
  }
  return scope.replace(/<[^>]+>/g, "").trim() || undefined;
};

/** Form 4 owner names are "LAST FIRST MIDDLE"; present them as "First Middle Last". */
export function personName(raw: string) {
  if (!raw || /\b(INC|LLC|LP|L\.P\.|TRUST|FUND|CORP|LTD|FOUNDATION)\b/i.test(raw)) return raw;
  const t = raw.trim().split(/\s+/);
  if (t.length < 2) return raw;
  const ordered = [...t.slice(1), t[0]].join(" ");
  return ordered.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Primary XML document of a Form 4 (the index lists the XSL-rendered path). */
export const form4XmlPath = (doc: string) => doc.replace(/^xsl[^/]+\//, "");

export function parseForm4(xml: string, f: { accn: string; filed: string; report?: string }, path: string): InsiderTrade[] {
  const out: InsiderTrade[] = [];
  const owner = tagVal(xml, ["reportingOwnerId", "rptOwnerName"]) ?? "Unknown";
  const rel = xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/)?.[1] ?? "";
  const roleParts = [
    tagVal(rel, ["officerTitle"]),
    /<isDirector>(true|1)</.test(rel) ? "Director" : undefined,
    /<isTenPercentOwner>(true|1)</.test(rel) ? "10% owner" : undefined,
  ].filter(Boolean);
  const plan = /<aff10b5One>(true|1)</.test(xml) || /10b5-1/i.test(xml);
  for (const t of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
    const body = t[1];
    const shares = Number(tagVal(body, ["transactionAmounts", "transactionShares", "value"]) ?? 0);
    const price = tagVal(body, ["transactionAmounts", "transactionPricePerShare", "value"]);
    const after = tagVal(body, ["postTransactionAmounts", "sharesOwnedFollowingTransaction", "value"]);
    out.push({
      accn: f.accn,
      filed: f.filed,
      owner: personName(owner),
      role: roleParts.join(", ") || "Insider",
      date: tagVal(body, ["transactionDate", "value"]) ?? f.report ?? f.filed,
      code: tagVal(body, ["transactionCoding", "transactionCode"]) ?? "?",
      security: tagVal(body, ["securityTitle", "value"]) ?? "Common Stock",
      shares,
      price: price ? Number(price) : null,
      acquired: tagVal(body, ["transactionAmounts", "transactionAcquiredDisposedCode", "value"]) === "A",
      ownedAfter: after ? Number(after) : null,
      direct: tagVal(body, ["ownershipNature", "directOrIndirectOwnership", "value"]) !== "I",
      plan10b5: plan,
      doc: path,
    });
  }
  return out;
}
