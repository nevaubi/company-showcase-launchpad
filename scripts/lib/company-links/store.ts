// Reads of the official-source store for the mapping build, with the service-role client of scripts/lib/supa.ts.
// Every read names one snapshot (a dataset's latest), finds fields by their label in that snapshot's dictionary
// and pages 1,000 rows at a time.
import type { FdicInstitution, NicEntity, NicRelationship } from "../../../src/lib/sources/company/build";

/** The subset of the Supabase client these reads use. */
export interface StoreClient {
  from(table: string): {
    select(columns: string): StoreQuery;
  };
}
interface StoreQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: string): StoreQuery;
  in(column: string, values: string[]): StoreQuery;
  like(column: string, pattern: string): StoreQuery;
  order(column: string, options: { ascending: boolean }): StoreQuery;
  range(from: number, to: number): StoreQuery;
  limit(n: number): StoreQuery;
}

export const DATASETS = {
  nic: "official_01_financials_data_fed_nic_native_csv_attributes_active_0e0bc8a8ed",
  relationships: "official_01_financials_data_fed_nic_native_csv_relationships_f440c4e9d7",
  allBanks: "official_01_financials_data_latest_all_banks_core_796bc99364",
  fdicHistory: "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b",
  y9c: "official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988",
} as const;

export interface StoreSnapshot {
  dataset: string;
  snapshot: string;
  labels: string[];
}

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/** A dataset's latest published snapshot and the labels of its fields, in order. */
export async function latestSnapshot(db: StoreClient, dataset: string): Promise<StoreSnapshot> {
  const d = await rows(db.from("source_datasets").select("id,latest_snapshot_id").eq("id", dataset).limit(1));
  const snapshot = d[0]?.latest_snapshot_id as string | undefined;
  if (!snapshot) throw new Error(`no published snapshot for ${dataset}`);
  const s = await rows(db.from("source_snapshots").select("id,status,columns").eq("id", snapshot).limit(1));
  if (s[0]?.status !== "ready") throw new Error(`snapshot ${snapshot} of ${dataset} is not ready`);
  const labels = ((s[0].columns ?? []) as { label?: string }[]).map(c => c.label ?? "");
  return { dataset, snapshot, labels };
}

export function positionOf(snap: StoreSnapshot, label: string): number {
  const i = snap.labels.indexOf(label);
  if (i < 0 || snap.labels.indexOf(label, i + 1) >= 0) throw new Error(`${snap.dataset}: field ${label} is missing or not unique`);
  return i;
}

/** Every row of a snapshot with the named fields only, as stored. `filter` may add an indexed or cell equality. */
export async function pageCells(db: StoreClient, snap: StoreSnapshot, labels: string[], filter?: (q: StoreQuery) => StoreQuery): Promise<{ row: number; cells: (string | null)[] }[]> {
  const pos = labels.map(l => positionOf(snap, l));
  const select = ["row_number", ...pos.map((p, i) => `c${i}:values->>${p}`)].join(",");
  const out: { row: number; cells: (string | null)[] }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("source_records").select(select).eq("snapshot_id", snap.snapshot);
    if (filter) q = filter(q);
    const page = await rows(q.order("row_number", { ascending: true }).range(from, from + 999));
    for (const r of page) out.push({ row: Number(r.row_number), cells: pos.map((_, i) => (r[`c${i}`] as string | null) ?? null) });
    if (page.length < 1000) break;
  }
  return out;
}

/** NIC entities with a tax ID (attributes file). */
export async function nicEntities(db: StoreClient): Promise<{ snap: StoreSnapshot; entities: NicEntity[] }> {
  const snap = await latestSnapshot(db, DATASETS.nic);
  const cells = await pageCells(db, snap, ["#ID_RSSD", "ID_TAX", "NM_LGL", "ENTITY_TYPE", "SEC_RPTG_STATUS"]);
  const entities = cells
    .filter(r => r.cells[1] && Number(r.cells[1]) > 0)
    .map(r => ({ row: r.row, rssd: String(r.cells[0] ?? ""), taxId: String(Number(r.cells[1])), legalName: (r.cells[2] ?? "").trim(), entityType: (r.cells[3] ?? "").trim(), secStatus: (r.cells[4] ?? "").trim() }));
  return { snap, entities };
}

/** Current NIC relationship rows (end date in 9999) from the given parents, as stored. */
export async function nicRelationships(db: StoreClient, parents: string[]): Promise<{ snap: StoreSnapshot; relationships: NicRelationship[] }> {
  const snap = await latestSnapshot(db, DATASETS.relationships);
  const labels = ["#ID_RSSD_PARENT", "ID_RSSD_OFFSPRING", "CTRL_IND", "EQUITY_IND", "OTHER_BASIS_IND", "PCT_EQUITY", "D_DT_END"];
  const relationships: NicRelationship[] = [];
  const parentPos = positionOf(snap, "#ID_RSSD_PARENT");
  // walk down three levels: parents, then their offspring, then theirs
  let level = [...new Set(parents)];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 100) {
      const part = level.slice(i, i + 100);
      const cells = await pageCells(db, snap, labels, q => q.in(`values->>${parentPos}`, part));
      for (const r of cells) {
        const [parent, offspring, ctrl, eq, other, pct, end] = r.cells.map(c => (c ?? "").trim());
        if (!/9999/.test(end)) continue;
        relationships.push({ row: r.row, parent, offspring, ctrlInd: ctrl, equityInd: eq, otherBasisInd: other, pctEquity: pct || null, end });
        if (ctrl === "1") next.push(offspring);
      }
    }
    level = [...new Set(next)];
  }
  return { snap, relationships };
}

export type StoredInstitution = FdicInstitution & { row: number; BKCLASS: string | null; STALP: string | null };

/** Every institution of the stored FDIC all-banks file (the evidence cites its rows), identity fields as stored. */
export async function fdicInstitutions(db: StoreClient): Promise<{ snap: StoreSnapshot; institutions: StoredInstitution[] }> {
  const snap = await latestSnapshot(db, DATASETS.allBanks);
  const cells = await pageCells(db, snap, ["CERT", "NAME", "RSSDID", "RSSDHCR", "ACTIVE", "REPDTE", "ASSET", "BKCLASS", "STALP"]);
  const institutions = cells
    .filter(r => r.cells[0] && Number(r.cells[0]) > 0)
    .map(r => {
      const [cert, name, rssd, hcr, active, repdte, asset, bkclass, stalp] = r.cells;
      return { row: r.row, CERT: Number(cert), NAME: (name ?? "").trim(), FED_RSSD: rssd, RSSDHCR: hcr, ACTIVE: active, REPDTE: repdte, ASSET: asset && /^-?\d+(\.\d+)?$/.test(asset) ? Number(asset) : null, BKCLASS: bkclass, STALP: stalp };
    });
  return { snap, institutions };
}

/** Certificates that have rows in the FDIC quarterly history table (the 500 cohort). */
export async function cohortCerts(db: StoreClient, certs: string[]): Promise<Set<string>> {
  const snap = await latestSnapshot(db, DATASETS.fdicHistory);
  const out = new Set<string>();
  for (const cert of certs) {
    const found = await rows(db.from("source_records").select("row_number").eq("snapshot_id", snap.snapshot).eq("entity_id", cert).limit(1));
    if (found.length) out.add(cert);
  }
  return out;
}

/** FR Y-9C rows per RSSD: report date, row and total assets (BHCK2170, USD thousands) as stored. */
export async function y9cRowsByRssd(db: StoreClient, dataset: string): Promise<{ snap: StoreSnapshot; byRssd: Map<string, { date: string; row: number; assetsK: string | null }[]> }> {
  const snap = await latestSnapshot(db, dataset);
  const cells = await pageCells(db, snap, ["RSSD9001", "RSSD9999", "BHCK2170"]);
  const byRssd = new Map<string, { date: string; row: number; assetsK: string | null }[]>();
  for (const r of cells) {
    const [rssd, date, assets] = r.cells;
    if (!rssd || !date || !/^\d{8}$/.test(date)) continue;
    const list = byRssd.get(rssd) ?? [];
    list.push({ date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, row: r.row, assetsK: assets });
    byRssd.set(rssd, list);
  }
  return { snap, byRssd };
}
