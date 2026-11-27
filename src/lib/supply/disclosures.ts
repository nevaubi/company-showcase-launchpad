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

export interface SharedInputs {
  id: string;
  label: string;
  recipient: string;
  inputs: Disclosure[];
}

export const programWatch: Record<string, string> = {
  "Cheyenne fuel-cell generation": "Watch the equipment delivery and commissioning dates. A delay at the fuel-cell plant could postpone this source of power for Google.",
  "Ormat Nevada geothermal portfolio": "Watch Nevada’s approval and each plant’s commercial start. The contracted ceiling can exceed delivered capacity while individual sites are under construction.",
  "Fervo Nevada tariff agreement": "Watch for NV Energy or Fervo to report generation delivered under the 115 MW tariff agreement.",
  "Dell AI Factory security offering": "Watch for Dell or CrowdStrike to disclose paid security adoption. AI Factory customer counts alone cannot measure Falcon sales.",
  "European sovereign Cortex service": "Watch for disclosed managed-service contracts. The launch establishes a combined offering; contract awards would provide evidence of customer adoption.",
};

export function disclosureEvidence(
  ticker: string, records: { direct: Disclosure[]; paths: DisclosurePath[]; sharedInputs?: SharedInputs[] }, relation: unknown, product: string, depth: unknown,
) {
  const matchesProduct = (r: Disclosure) => !product || r.product.toLowerCase().includes(product.toLowerCase());
  const direct = records.direct.filter((r) => matchesProduct(r) && (!relation ||
    (relation === "customer" && r.provider_key === ticker) || (relation === "supplier" && r.recipient_key === ticker)));
  if (!direct.length) return "";
  const cite = (r: Disclosure) => `${r.publisher}, ${r.source_date}, ${r.source_url}`;
  const directIds = new Set(direct.map((r) => r.id));
  const paths = depth === 1 ? [] : records.paths.filter((p) => directIds.has(p.first.id) || directIds.has(p.second.id));
  const shared = depth === 1 ? [] : (records.sharedInputs ?? []).filter((p) => p.inputs.some((r) => directIds.has(r.id)));
  const programLabels = new Set([...paths.slice(0, 3), ...shared.slice(0, 3)].map((p) => p.label));
  return [
    "Curated issuer disclosures (stage as of publication; no revenue exposure inferred):",
    ...direct.slice(0, 8).map((r) => `${r.provider_name} → ${r.recipient_name} | ${r.product} | ${disclosureStages[r.stage]} | ${r.detail} | ${cite(r)}`),
    ...paths.slice(0, 3).map((p) => `Shared product pathway: ${p.first.provider_name} → ${p.first.recipient_name} → ${p.second.recipient_name} | ${p.label} | first leg ${disclosureStages[p.first.stage]} (${cite(p.first)}); second leg ${disclosureStages[p.second.stage]} (${cite(p.second)})`),
    ...shared.slice(0, 3).map((p) => `Parallel inputs to ${p.recipient} | ${p.label} | ${p.inputs.map((r) => `${r.provider_name} supplies ${r.product} (${disclosureStages[r.stage]}, ${cite(r)})`).join(" / ")}`),
    ...[...programLabels].filter((label) => programWatch[label]).map((label) => `Analyst watchpoint for ${label} | ${programWatch[label]}`),
  ].join("\n");
}

/** Join only within the same documented program. A firm can supply unrelated products to different customers. */
function activeProgramRows(records: Disclosure[]): Disclosure[] {
  const ordered = [...records].sort((a, b) => b.source_date.localeCompare(a.source_date) || a.id.localeCompare(b.id));
  const newest = new Map<string, Disclosure>();
  const unassignedEnds = new Set<string>();
  for (const row of ordered) {
    const product = JSON.stringify([row.provider_key, row.recipient_key, row.product]);
    if (!row.pathway && row.stage === "ended") unassignedEnds.add(product);
    const key = JSON.stringify([product, row.pathway]);
    if (!newest.has(key) && !unassignedEnds.has(product)) newest.set(key, row);
  }
  return [...newest.values()].filter((r) => r.pathway && r.stage !== "ended");
}

export function disclosureSharedInputs(ticker: string, records: Disclosure[]): SharedInputs[] {
  const groups = new Map<string, Disclosure[]>();
  for (const row of activeProgramRows(records)) {
    const key = JSON.stringify([row.pathway, row.recipient_key]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const results: SharedInputs[] = [];
  for (const [id, inputs] of groups) {
    if (new Set(inputs.map((row) => row.provider_key)).size < 2) continue;
    if (!inputs.some((row) => row.provider_key === ticker || row.recipient_key === ticker)) continue;
    results.push({ id, inputs, label: inputs[0].pathway!, recipient: inputs[0].recipient_name });
  }
  return results.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function disclosurePaths(ticker: string, records: Disclosure[]): DisclosurePath[] {
  const firstByRecipient = new Map<string, Disclosure[]>();
  const live = activeProgramRows(records);
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
