// Server read of a company's official records: its insured banks (FDIC), one bank's quarterly history and its
// holding company's FR Y-9C capital lines, every figure with the dataset, snapshot, row and field it came from.
// Links come only from the reviewed mapping (links.server.ts). Reads run with the signed-in member's own client
// (row-level security of migration 0068), as bounded direct selects and the member functions that exist today
// (COMMON4b section 2): one snapshot per select, an indexed equality or a row number, explicit fields read as
// `values->>N`, at most 1,000 rows. Fields are found by label; positions are hints checked against the
// dictionary before use. Nothing is parsed except through numbers.ts, nothing is rescaled, nothing is summed.
// Each part degrades to a note; the call never throws to the page.
import { readNative } from "../numbers";
import { classifyReadError, type PgError } from "../read.server";
import type { SourceColumn } from "../schema";
import { ALL_BANKS_FIELDS, ALL_BANKS_LABELS, FDIC_ALL_BANKS, FDIC_CURRENT, FDIC_HISTORY, FDIC_IDS, FDIC_LINES, fdicInstitutionUrl, QUANTITY_UNITS } from "./fdic-fields";
import { absSponsors, provenBanks, registrantLink } from "./links.server";
import type { BankHistory, BankLine, CompanyLink, CompanyOfficial, CompanyOfficialResult, FigureRef, HistoryPoint, OfficialBank, OfficialCell, OfficialSource, Y9cLine, Y9cPointer, Y9cQuarter, Y9cReport } from "./types";
import { Y9C_FIELDS, Y9C_KEYS, Y9C_VARIABLES } from "./y9c-fields";

type Result = { data: unknown; error: PgError | null };
export interface OfficialQuery extends PromiseLike<Result> {
  eq(column: string, value: string | number): OfficialQuery;
  in(column: string, values: readonly (string | number)[]): OfficialQuery;
  order(column: string, options: { ascending: boolean }): OfficialQuery;
  limit(count: number): OfficialQuery;
}
/** The subset of the caller's Supabase client these reads use (never the admin client). */
export interface OfficialClient {
  from(table: "source_datasets" | "source_snapshots" | "source_records"): { select(columns: string): OfficialQuery };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result>;
}

class Stop extends Error {}
const SENTENCE: Record<string, string> = {
  unavailable: "This read needs a database update that is not applied yet.",
  timeout: "The database stopped the read after its time limit.",
  "not-found": "A stored record the mapping points to is not published.",
  invalid: "The read was refused by the database.",
  error: "The official records could not be read.",
};
const fail = (error: PgError) => new Stop(SENTENCE[classifyReadError(error).reason] ?? SENTENCE.error);
async function select(q: PromiseLike<Result>): Promise<Record<string, unknown>[]> {
  const { data, error } = await q;
  if (error) throw fail(error);
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
const text = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));

/** A stored cell as the panel shows it: a number only for a plain decimal (numbers.ts), otherwise what it is. */
export function cellOf(v: unknown): OfficialCell {
  if (v === undefined) return { text: null, value: null, kind: "null" };
  const r = readNative(text(v));
  if (r.kind === "number") return { text: r.text, value: r.value, kind: "number" };
  if (r.kind === "null") return { text: null, value: null, kind: "null" };
  if (r.kind === "empty") return { text: "", value: null, kind: "empty" };
  return { text: r.text, value: null, kind: "text" };
}
const isoDay = (s: string | null): string | null => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const compact = (iso: string) => iso.replace(/-/g, "");

// ------------------------------------------------------------------ caches (snapshots are immutable)

const MINUTES = 60_000;
const latestCache = new Map<string, { at: number; id: string }>();
const snapshotCache = new Map<string, Omit<OfficialSource, "newerSnapshot">>();
const fieldCache = new Map<string, Map<string, { position: number; column: SourceColumn }>>();
const resultCache = new Map<string, { at: number; value: CompanyOfficial }>();
let recordFunctionMissingUntil = 0;

/** Forget every cached read (tests). */
export function resetOfficialCache() {
  latestCache.clear();
  snapshotCache.clear();
  fieldCache.clear();
  resultCache.clear();
  recordFunctionMissingUntil = 0;
}

async function latestId(db: OfficialClient, dataset: string): Promise<string> {
  const hit = latestCache.get(dataset);
  if (hit && Date.now() - hit.at < 10 * MINUTES) return hit.id;
  const d = await select(db.from("source_datasets").select("id,latest_snapshot_id").eq("id", dataset).limit(1));
  const id = text(d[0]?.latest_snapshot_id);
  if (!id) throw new Stop("The dataset has no published file.");
  latestCache.set(dataset, { at: Date.now(), id });
  return id;
}

/** A published snapshot as the panel cites it; `newerSnapshot` names the dataset's latest when it is not this one. */
async function sourceOf(db: OfficialClient, dataset: string, snapshot?: string): Promise<OfficialSource> {
  const latest = await latestId(db, dataset);
  const id = snapshot ?? latest;
  let meta = snapshotCache.get(id);
  if (!meta) {
    const s = await select(db.from("source_snapshots").select("id,dataset_id,status,retrieved_at,published_at,file_sha256").eq("id", id).eq("dataset_id", dataset).eq("status", "ready").limit(1));
    if (!s[0]) throw new Stop("The stored file the mapping points to is not published.");
    meta = { dataset, snapshot: id, retrievedAt: text(s[0].retrieved_at), publishedAt: text(s[0].published_at), fileSha256: text(s[0].file_sha256) ?? "" };
    snapshotCache.set(id, meta);
  }
  return { ...meta, newerSnapshot: latest !== id ? latest : null };
}

/**
 * Positions of fields by label. One probe reads only the descriptors at the hinted positions; when any label differs
 * (the publisher changed the header) the whole dictionary is read once and the fields are found by label. A label
 * missing from the snapshot, or present twice, is left out.
 */
async function fieldsOf(db: OfficialClient, snapshot: string, wanted: readonly Wanted[]): Promise<Map<string, { position: number; column: SourceColumn }>> {
  const key = `${snapshot}|${wanted.map(w => `${w.label}@${w.hint}`).join(",")}`;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const out = new Map<string, { position: number; column: SourceColumn }>();
  const probe = await select(db.from("source_snapshots").select(wanted.map((w, i) => `d${i}:columns->${w.hint}`).join(",")).eq("id", snapshot).limit(1));
  let exact = !!probe[0];
  wanted.forEach((w, i) => {
    const c = probe[0]?.[`d${i}`] as SourceColumn | null | undefined;
    if (c && c.label === w.label) out.set(w.label, { position: w.hint, column: c });
    else exact = false;
  });
  if (!exact) {
    out.clear();
    const full = await select(db.from("source_snapshots").select("columns").eq("id", snapshot).limit(1));
    const columns = (Array.isArray(full[0]?.columns) ? full[0].columns : []) as SourceColumn[];
    for (const w of wanted) {
      const at = columns.findIndex(c => c?.label === w.label);
      if (at >= 0 && columns.findIndex((c, j) => j > at && c?.label === w.label) < 0) out.set(w.label, { position: at, column: columns[at] });
    }
  }
  fieldCache.set(key, out);
  return out;
}
const projection = (fields: Map<string, { position: number }>, labels: readonly string[]) =>
  labels.filter(l => fields.has(l)).map(l => `c_${l.replace(/[^A-Za-z0-9]/g, "_")}:values->>${fields.get(l)!.position}`).join(",");
const cellAt = (r: Record<string, unknown>, label: string): unknown => r[`c_${label.replace(/[^A-Za-z0-9]/g, "_")}`];

// ------------------------------------------------------------------ FDIC: lines, identity, history

type Wanted = { label: string; hint: number };
const lineLabels = FDIC_LINES.map(l => l.field);
type Fields = Map<string, { position: number; column: SourceColumn }>;
const quantity = (f: Fields, field: string): string | null => {
  const unit = f.get(field)?.column.unit;
  return unit && QUANTITY_UNITS.has(unit) ? unit : null;
};

function linesOf(r: Record<string, unknown>, f: Fields, src: OfficialSource): BankLine[] {
  const row = Number(r.row_number);
  return FDIC_LINES.filter(l => quantity(f, l.field)).map(l => {
    const column = f.get(l.field)!.column;
    const ref: FigureRef = { dataset: src.dataset, snapshot: src.snapshot, row, field: l.field };
    return { field: l.field, label: l.label, basis: l.basis, unit: column.unit!, title: column.title ?? null, cell: cellOf(cellAt(r, l.field)), ref };
  });
}

async function readBanks(db: OfficialClient, links: CompanyLink[]) {
  const insured = links.filter(l => l.link_kind === "insured_bank");
  const cohort = insured.filter(l => l.evidence.fdic?.cohort500).map(l => l.key_value);
  const current = await sourceOf(db, FDIC_CURRENT);
  const wanted: Wanted[] = [...[FDIC_IDS.cert, FDIC_IDS.date, FDIC_IDS.name, FDIC_IDS.state].map(x => ({ label: x.field as string, hint: x.hint.current as number })), ...FDIC_LINES.map(l => ({ label: l.field, hint: l.hint.current }))];
  const fields = await fieldsOf(db, current.snapshot, wanted);
  const byCert = new Map<string, Record<string, unknown>>();
  if (cohort.length) {
    const cols = projection(fields, ["REPDTE", "NAME", "STALP", ...lineLabels]);
    const rows = await select(db.from("source_records").select(`row_number,entity_id,period${cols ? `,${cols}` : ""}`).eq("snapshot_id", current.snapshot).in("entity_id", cohort).limit(1000));
    for (const r of rows) {
      const cert = text(r.entity_id) ?? "";
      const prev = byCert.get(cert);
      if (!prev || String(r.period ?? "") > String(prev.period ?? "")) byCert.set(cert, r);
    }
  }
  return { current, fields, byCert };
}

async function readIdentity(db: OfficialClient, certs: string[]) {
  const source = await sourceOf(db, FDIC_ALL_BANKS);
  const keys = Object.keys(ALL_BANKS_FIELDS) as (keyof typeof ALL_BANKS_FIELDS)[];
  const fields = await fieldsOf(db, source.snapshot, keys.map(k => ({ label: ALL_BANKS_LABELS[k], hint: ALL_BANKS_FIELDS[k] })));
  const cols = projection(fields, ["NAME", "STALP", "CITY", "BKCLASS", "REPDTE", "ACTIVE"]);
  const rows = certs.length ? await select(db.from("source_records").select(`row_number,entity_id${cols ? `,${cols}` : ""}`).eq("snapshot_id", source.snapshot).in("entity_id", certs).limit(1000)) : [];
  return { source, byCert: new Map(rows.map(r => [text(r.entity_id) ?? "", r])) };
}

async function readHistory(db: OfficialClient, cert: string, current: { source: OfficialSource; fields: Fields; row: Record<string, unknown> | undefined }): Promise<{ history: BankHistory | null; note: string | null }> {
  const source = await sourceOf(db, FDIC_HISTORY);
  const wanted: Wanted[] = [{ label: FDIC_IDS.date.field, hint: FDIC_IDS.date.hint.history }, ...FDIC_LINES.map(l => ({ label: l.field, hint: l.hint.history }))];
  const fields = await fieldsOf(db, source.snapshot, wanted);
  const measures = FDIC_LINES.filter(l => quantity(fields, l.field)).map(l => ({ field: l.field, label: l.label, unit: fields.get(l.field)!.column.unit! }));
  if (!measures.length) return { history: null, note: "The history table's dictionary states no unit for these lines." };
  const cols = projection(fields, measures.map(m => m.field));
  const rows = await select(db.from("source_records").select(`row_number,period,${cols}`).eq("snapshot_id", source.snapshot).eq("entity_id", cert).order("period", { ascending: true }).limit(1000));
  const points: HistoryPoint[] = [];
  for (const r of rows) {
    const period = isoDay(text(r.period));
    if (period) points.push({ period, source: 0, row: Number(r.row_number), cells: measures.map(m => cellOf(cellAt(r, m.field))) });
  }
  const sources = [source];
  // the latest quarter comes from the current-quarter table, appended only where both dictionaries state the same unit
  const cur = current.row;
  const curPeriod = cur ? isoDay(text(cur.period)) : null;
  if (cur && curPeriod && (!points.length || curPeriod > points[points.length - 1].period) && measures.every(m => quantity(current.fields, m.field) === m.unit)) {
    sources.push(current.source);
    points.push({ period: curPeriod, source: 1, row: Number(cur.row_number), cells: measures.map(m => cellOf(cellAt(cur, m.field))) });
  }
  if (!points.length) return { history: null, note: "No quarterly history is stored for this bank." };
  return { history: { cert, measures, sources, points }, note: null };
}

// ------------------------------------------------------------------ FR Y-9C

const Y9C_WANTED: Wanted[] = [...[Y9C_KEYS.rssd, Y9C_KEYS.date, Y9C_KEYS.assets].map(k => ({ label: k.field as string, hint: k.hint as number })), ...Y9C_FIELDS.map(f => ({ label: f.field, hint: f.hint }))];

/** One stored row by number: `source_record` (migration 0069) when present, else `source_query_records` after row - 1. */
async function readRow(db: OfficialClient, p: Y9cPointer, positions: number[], labels: string[]): Promise<(string | null)[] | null> {
  if (Date.now() >= recordFunctionMissingUntil) {
    const { data, error } = await db.rpc("source_record", { _dataset_id: p.dataset, _snapshot_id: p.snapshot, _row_number: p.row });
    if (!error) {
      const rec = (data as { record?: { row_number?: number; values?: (string | null)[] } | null } | null)?.record;
      if (!rec || Number(rec.row_number) !== p.row || !Array.isArray(rec.values)) return null;
      return positions.map(i => rec.values![i] ?? null);
    }
    if (classifyReadError(error).reason !== "unavailable") throw fail(error);
    recordFunctionMissingUntil = Date.now() + 10 * MINUTES;
  }
  const { data, error } = await db.rpc("source_query_records", { _dataset_id: p.dataset, _snapshot_id: p.snapshot, _after: p.row - 1, _limit: 1, _columns: positions });
  if (error) throw fail(error);
  const page = data as { columns?: (SourceColumn | null)[]; rows?: { row_number: number; values: (string | null)[] }[] } | null;
  if ((page?.columns ?? []).some((c, i) => c?.label !== labels[i])) throw new Stop("The FR Y-9C file's fields moved; the mapping needs a rebuild.");
  const r = page?.rows?.[0];
  return r && Number(r.row_number) === p.row ? r.values : null;
}

async function readY9c(db: OfficialClient, reg: CompanyLink): Promise<Y9cReport | null> {
  const pointers = [...(reg.y9c ?? [])].sort((a, b) => a.report_date.localeCompare(b.report_date));
  if (!pointers.length) return null;
  const { dataset, snapshot } = pointers[0];
  if (pointers.some(p => p.dataset !== dataset || p.snapshot !== snapshot)) throw new Stop("The mapping points at two FR Y-9C files.");
  const source = await sourceOf(db, dataset, snapshot);
  const fields = await fieldsOf(db, snapshot, Y9C_WANTED);
  for (const k of [Y9C_KEYS.rssd, Y9C_KEYS.date]) if (!fields.has(k.field)) throw new Stop("The FR Y-9C file has no RSSD or report date field.");
  const labels = Y9C_WANTED.map(w => w.label).filter(l => fields.has(l));
  const positions = labels.map(l => fields.get(l)!.position);
  const read = await Promise.all(pointers.map(p => readRow(db, p, positions, labels)));
  const quarters: Y9cQuarter[] = [];
  const missing: Y9cReport["missing"] = [];
  const cellsByQuarter: Map<string, unknown>[] = [];
  read.forEach((values, i) => {
    const p = pointers[i];
    if (!values) {
      missing.push({ reportDate: p.report_date, reason: "The row is not in the stored file." });
      return;
    }
    const at = new Map(labels.map((l, j) => [l, values[j]]));
    if (at.get(Y9C_KEYS.rssd.field) !== reg.key_value || at.get(Y9C_KEYS.date.field) !== compact(p.report_date)) {
      missing.push({ reportDate: p.report_date, reason: "The stored row is not this holding company's report for that date." });
      return;
    }
    const assetsUnit = fields.get(Y9C_KEYS.assets.field)?.column.unit ?? null;
    quarters.push({ reportDate: p.report_date, ref: { dataset, snapshot, row: p.row }, totalAssets: { ...cellOf(at.get(Y9C_KEYS.assets.field)), ref: { dataset, snapshot, row: p.row, field: Y9C_KEYS.assets.field }, unit: assetsUnit } });
    cellsByQuarter.push(at);
  });
  const dictionary = await readVariableLabels(db).catch(() => null);
  const lines: Y9cLine[] = Y9C_FIELDS.filter(f => fields.has(f.field)).map(f => ({
    field: f.field,
    label: dictionary?.labels.get(f.field)?.text ?? f.short,
    short: f.short,
    unit: f.unit,
    unitEvidence: f.unitEvidence,
    labelRef: dictionary?.labels.get(f.field) ? { dataset: dictionary.source.dataset, snapshot: dictionary.source.snapshot, row: dictionary.labels.get(f.field)!.row } : null,
    cells: quarters.map((q, i) => ({ ...cellOf(cellsByQuarter[i].get(f.field)), ref: { ...q.ref, field: f.field } })),
  }));
  return { rssd: reg.key_value, legalName: reg.evidence.nic?.legal_name ?? reg.entity_name ?? "", source, dictionary: dictionary?.source ?? null, quarters, lines, missing };
}

/** The description of each line as the Fed's variable dictionary stores it, read by variable name. */
async function readVariableLabels(db: OfficialClient): Promise<{ source: OfficialSource; labels: Map<string, { text: string; row: number }> }> {
  const source = await sourceOf(db, Y9C_VARIABLES);
  const fields = await fieldsOf(db, source.snapshot, [{ label: "variable", hint: 0 }, { label: "valid_to", hint: 2 }, { label: "description", hint: 3 }]);
  if (!fields.has("variable") || !fields.has("description")) throw new Stop("The variable dictionary has no description field.");
  const names = [...Y9C_FIELDS.map(f => f.field), Y9C_KEYS.assets.field];
  const v = fields.get("variable")!.position;
  const rows = await select(db.from("source_records").select(`row_number,${projection(fields, ["variable", "valid_to", "description"])}`).eq("snapshot_id", source.snapshot).in(`values->>${v}`, names).limit(500));
  const labels = new Map<string, { text: string; row: number; to: string }>();
  for (const r of rows) {
    const name = text(cellAt(r, "variable")) ?? "";
    const to = text(cellAt(r, "valid_to")) ?? "";
    const desc = text(cellAt(r, "description"));
    const prev = labels.get(name);
    if (desc && (!prev || to > prev.to)) labels.set(name, { text: desc, row: Number(r.row_number), to });
  }
  return { source, labels: new Map([...labels].map(([k, x]) => [k, { text: x.text, row: x.row }])) };
}

// ------------------------------------------------------------------ the company

/** How the bank is held, where it is not the plain case of the registrant as the FDIC's top holder. */
function basisNote(b: CompanyLink): string | null {
  const steps = b.evidence.relationship?.steps ?? [];
  if (b.basis === "nic_equity") return `Held through ${steps.length === 1 ? "one NIC relationship" : `${steps.length} NIC relationships`} (${steps.map(s => `${s.equity_pct}%`).join(", ")} equity).`;
  if (b.basis === "nic_other_basis") return "Controlled on a basis other than equity; NIC records no equity share.";
  if (b.basis === "self") return "The registrant is this bank.";
  return null;
}

/** Everything the company's official panels show, for one ticker and (optionally) the bank whose history to include. */
export async function readCompanyOfficial(db: OfficialClient, ticker: string, cert?: string): Promise<CompanyOfficialResult> {
  const t = ticker.trim().toUpperCase();
  try {
    const reg = registrantLink(t);
    const banks = provenBanks(t);
    const empty: CompanyOfficial = { ticker: t, registrant: null, banks: [], history: null, historyNote: null, y9c: null, y9cNote: null, abs: [], sources: { current: null, history: null }, caveats: [] };
    if (!reg) return { ok: true, data: empty };
    const cohortInsured = banks.filter(b => b.link_kind === "insured_bank" && b.evidence.fdic?.cohort500);
    const chosen = cohortInsured.find(b => b.key_value === cert) ?? cohortInsured[0] ?? null;
    const key = `${t}|${chosen?.key_value ?? ""}`;
    const hit = resultCache.get(key);
    if (hit && Date.now() - hit.at < 10 * MINUTES) return { ok: true, data: hit.value };

    const out: CompanyOfficial = {
      ...empty,
      registrant: { rssd: reg.key_value, legalName: reg.evidence.nic?.legal_name ?? reg.entity_name ?? t, einCoverUrl: reg.evidence.sec.cover_url ?? null },
      abs: absSponsors(t).map(s => ({ sponsorCik: s.key_value, sponsorName: s.entity_name ?? "", cert: s.evidence.sponsor!.cert, deals: s.evidence.sponsor!.deals, assetClass: s.evidence.sponsor!.asset_class })),
    };
    const [fdic, identity, y9c] = await Promise.allSettled([
      readBanks(db, banks),
      readIdentity(db, banks.map(b => b.key_value)),
      readY9c(db, reg),
    ]);
    const lines = fdic.status === "fulfilled" ? fdic.value : null;
    const ids = identity.status === "fulfilled" ? identity.value : null;
    if (lines) out.sources.current = lines.current;
    out.banks = banks.map((b): OfficialBank => {
      const insured = b.link_kind === "insured_bank";
      const cohort = insured && !!b.evidence.fdic?.cohort500;
      const id = ids?.byCert.get(b.key_value);
      const row = lines?.byCert.get(b.key_value);
      const bankLines = row && lines ? linesOf(row, lines.fields, lines.current) : [];
      const pick = (field: string) => bankLines.find(l => l.field === field)?.cell ?? null;
      const note = !insured ? "Noninsured trust company." : !cohort ? "Outside the stored FDIC 500 cohort." : !lines ? "The FDIC quarter could not be read." : !row ? "No row in the latest FDIC quarter." : null;
      return {
        cert: b.key_value,
        name: text(id && cellAt(id, "NAME"))?.trim() || b.entity_name || `Certificate ${b.key_value}`,
        kind: insured ? "insured" : "noninsured_trust",
        basis: b.basis,
        bankRssd: b.evidence.fdic?.bank_rssd ?? null,
        inCohort: cohort,
        state: text(row ? cellAt(row, "STALP") : id ? cellAt(id, "STALP") : null)?.trim() || null,
        reportDate: row ? isoDay(text(row.period) ?? text(cellAt(row, "REPDTE"))) : null,
        assets: row ? pick("ASSET") : null,
        deposits: row ? pick("DEP") : null,
        lines: bankLines,
        note: [note, basisNote(b)].filter(Boolean).join(" ") || null,
        fdicUrl: fdicInstitutionUrl(b.key_value),
        linkRef: b.evidence.fdic?.dataset && b.evidence.fdic.snapshot && b.evidence.fdic.row ? { dataset: b.evidence.fdic.dataset, snapshot: b.evidence.fdic.snapshot, row: b.evidence.fdic.row } : null,
      };
    });
    let partial = fdic.status === "rejected" || identity.status === "rejected" || y9c.status === "rejected";
    if (fdic.status === "rejected") out.historyNote = fdic.reason instanceof Stop ? fdic.reason.message : SENTENCE.error;
    if (chosen && lines) {
      try {
        const h = await readHistory(db, chosen.key_value, { source: lines.current, fields: lines.fields, row: lines.byCert.get(chosen.key_value) });
        out.history = h.history;
        out.historyNote = h.note;
        out.sources.history = h.history?.sources[0] ?? null;
      } catch (e) {
        partial = true;
        out.historyNote = e instanceof Stop ? e.message : SENTENCE.error;
      }
    }
    if (y9c.status === "fulfilled") out.y9c = y9c.value;
    else out.y9cNote = y9c.reason instanceof Stop ? y9c.reason.message : SENTENCE.error;
    // a read that failed in part is not kept, so the next visit asks again
    if (!partial) resultCache.set(key, { at: Date.now(), value: out });
    if (resultCache.size > 300) resultCache.delete(resultCache.keys().next().value!);
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, reason: e instanceof Stop ? e.message : SENTENCE.error };
  }
}
