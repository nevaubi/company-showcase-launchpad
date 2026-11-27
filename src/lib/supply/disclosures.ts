import type { Database } from "@/integrations/supabase/types";

export type Disclosure = Database["public"]["Tables"]["supply_disclosures"]["Row"];

export const disclosureStages: Record<string, string> = {
  in_use: "In use", contracted: "Contracted", planned: "Planned", ended: "Ended",
};

export interface DisclosurePath {
  id: string;
  label: string;
  first: Disclosure;
  second: Disclosure;
}

export function disclosureEvidence(
  ticker: string, records: { direct: Disclosure[]; paths: DisclosurePath[] }, relation: unknown, product: string, depth: unknown,
) {
  const matchesProduct = (r: Disclosure) => !product || r.product.toLowerCase().includes(product.toLowerCase());
  const direct = records.direct.filter((r) => matchesProduct(r) && (!relation ||
    (relation === "customer" && r.provider_key === ticker) || (relation === "supplier" && r.recipient_key === ticker)));
  if (!direct.length) return "";
  const cite = (r: Disclosure) => `${r.publisher}, ${r.source_date}, ${r.source_url}`;
  const directIds = new Set(direct.map((r) => r.id));
  const paths = depth === 1 ? [] : records.paths.filter((p) => directIds.has(p.first.id) || directIds.has(p.second.id));
  return [
    "Curated issuer disclosures (stage as of publication; no revenue exposure inferred):",
    ...direct.slice(0, 8).map((r) => `${r.provider_name} → ${r.recipient_name} | ${r.product} | ${disclosureStages[r.stage]} | ${r.detail} | ${cite(r)}`),
    ...paths.slice(0, 3).map((p) => `Shared product pathway: ${p.first.provider_name} → ${p.first.recipient_name} → ${p.second.recipient_name} | ${p.label} | first leg ${disclosureStages[p.first.stage]} (${cite(p.first)}); second leg ${disclosureStages[p.second.stage]} (${cite(p.second)})`),
  ].join("\n");
}

/** Join only within the same documented program. A firm can supply unrelated products to different customers. */
export function disclosurePaths(ticker: string, records: Disclosure[]): DisclosurePath[] {
  const ordered = [...records].sort((a, b) => b.source_date.localeCompare(a.source_date) || a.id.localeCompare(b.id));
  const newest = new Map<string, Disclosure>();
  for (const row of ordered) {
    const key = JSON.stringify([row.provider_key, row.recipient_key, row.product]);
    if (!newest.has(key)) newest.set(key, row);
  }
  const firstByRecipient = new Map<string, Disclosure[]>();
  const live = [...newest.values()].filter((r) => r.pathway && r.stage !== "ended");
  for (const first of live) {
    const key = JSON.stringify([first.pathway, first.recipient_key]);
    const group = firstByRecipient.get(key) ?? [];
    group.push(first);
    firstByRecipient.set(key, group);
  }
  const paths: DisclosurePath[] = [];
  for (const second of live) {
    for (const first of firstByRecipient.get(JSON.stringify([second.pathway, second.provider_key])) ?? []) {
      if (second.recipient_key === first.provider_key ||
          ![first.provider_key, first.recipient_key, second.recipient_key].includes(ticker)) continue;
      paths.push({ id: first.id + "|" + second.id, label: second.pathway!, first, second });
    }
  }
  return paths.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
