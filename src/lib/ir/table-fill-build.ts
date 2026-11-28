// Pure: table fill at rebuild time, and the quality summary every rebuild writes into stats.quality.
// The build reads a company's newest table documents (rebuild.server.ts supplies the reader, bounded in
// bytes, time and documents), fills each table's printed rows the stored facts do not cover
// (table-fill.ts), builds the payload from stored and filled facts together, then stores the printed
// layout of the section tables and the summary. A document that cannot be read leaves its tables as the
// stored facts give them.
import type { IrFact } from "@/lib/ir/kpis";
import type { IrPayload, IrQuality, PayloadFillConflict } from "@/lib/ir/payload";
import { assembleStatements, lineDiv, rowLabel, statementAnchors } from "@/lib/ir/statements";
import {
  fillDocument,
  isComparisonPosition,
  newestHeadDate,
  FILL_METHOD,
  quarterEnds,
  type DocFill,
  type MissReason,
} from "@/lib/ir/table-fill";
import type { TableCaption } from "@/lib/ir/table-captions";
import { proFormaDocument, resultsExhibit } from "@/lib/ir/reported-scope";
import { reduceDocument, type FillDoc } from "@/lib/ir/table-fill-cache";
import { inferFiled } from "@/lib/ir/doc-meta";

/** A stored document's row: filing date, stored kind, title. */
export interface DocMeta {
  filed: string | null;
  kind: string | null;
  title: string | null;
}

/** Words a statistical supplement prints on its cover or in its title. */
const SUPPLEMENT_WORDS =
  /\b(financial supplement|quarterly financial data supplement|supplemental (financial )?information|financial highlights|earnings supplement|financial data supplement|supplementa(l|ry) financial data)\b/i;

/** "supplement" when a document stored under another kind calls itself a supplement in its title or on its first page. */
export function kindHint(
  kind: string | null | undefined,
  title?: string | null,
  text?: string | null,
): "supplement" | undefined {
  if (kind === "supplement") return undefined;
  if (kind && !["other", "exhibit", "unknown"].includes(kind)) return undefined;
  if (title && SUPPLEMENT_WORDS.test(title)) return "supplement";
  const head = text
    ?.slice(0, 60_000)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);
  return head && SUPPLEMENT_WORDS.test(head) ? "supplement" : undefined;
}

/**
 * Document rows onto the payload's documents: the filing date from the document row where the facts carry
 * none, and `hint: "supplement"` for a supplement stored under another kind (from its title or first page).
 */
export function withDocMeta(p: IrPayload, meta: Map<string, DocMeta>, run?: FillRun): IrPayload {
  let changed = false;
  const docs = p.docs.map((d) => {
    const m = meta.get(d.id);
    if (!m) return d;
    const filed = d.filed ?? m.filed;
    const hint = kindHint(d.kind ?? m.kind, m.title, run?.texts.get(d.id));
    if (filed === d.filed && !hint) return d;
    changed = true;
    return { ...d, filed, ...(hint ? { hint } : {}) };
  });
  return changed ? { ...p, docs } : p;
}

/** Documents downloaded and parsed per rebuild when no reduced copy of them is stored yet. */
export const FILL_DOCS = 12;
/** Documents per company whose tables are filled in the full window: twelve quarters of releases, supplements and exhibits. */
export const FILL_HISTORY_DOCS = 60;
/** How far back from the newest document the fill reads every table document (months): at least the last 12 quarters. */
export const FILL_MONTHS = 37;
/**
 * Older documents whose tables are filled: the rebuild plan's primary statement documents past the full window
 * (doc-plan.ts `older`: one family a quarter, back 15 years), newest first. A statement's rows then run back as
 * far as the company's documents are stored; before this they stopped at 37 months, and Apple's balance sheet
 * showed 14 quarters of the 60 its releases print.
 */
export const FILL_OLDER_DOCS = 130;

export interface FillRun {
  /** stored facts plus the filled ones, for the build */
  facts: IrFact[];
  /** per document read: its fill */
  fills: Map<string, DocFill>;
  /** captions of every document read (also used for section titles), by document id */
  captions: Map<string, TableCaption[]>;
  /** the first part of each document read (for its kind hint) */
  texts: Map<string, string>;
  /** stored figures given the sign their print shows */
  signs: number;
  /** stored figures moved to the period of the printed column they sit in */
  moved: number;
  /** stored money figures read at another scale than their table's printed scale line, rescaled */
  scaled: number;
  /** filing date and kind of each document read */
  docs: Map<string, { filed: string | null; kind: string | null }>;
  /** documents chosen, read and not readable */
  chosen: number;
  read: number;
  failed: number;
  /** documents chosen but left for a later rebuild (no reduced copy yet and this rebuild's downloads spent) */
  waiting: number;
  /**
   * Documents stored without a filing date that print one: the first date in their opening text that falls
   * within 120 days after the newest period their statements report (doc-meta.ts `inferFiled`, the rule the
   * deep build uses for PDFs). The rebuild writes it to the document row.
   */
  dated: Map<string, string>;
  /** documents that introduce themselves as pro forma financial information: unread, their stored figures left out */
  proForma: Set<string>;
  /** documents with no stored table figure left unread because their 8-K reported no results (no Item 2.02) */
  notResults: number;
}

/** The date `n` months before a date ("YYYY-MM-DD"). */
export function monthsBefore(date: string, n: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, Math.min(d, 28))).toISOString().slice(0, 10);
}

/** A stored table document by its document row: id, filing date, kind, title. */
export interface TableDoc extends DocMeta {
  id: string;
  /** a document stored without a filing date: where the rebuild plan places it (doc-plan.ts), for its order only */
  placed?: string;
}

/**
 * Documents to fill, newest filing first (ties: more table facts first), at most `max` of the full window: those
 * with table facts, and the company's table documents by their rows (`rows`: releases, supplements and other HTML
 * exhibits), read even when no stored fact points into them. Documents filed before the window are taken only
 * when the plan names them (`older`), at most `maxOlder`, after the window's documents and newest first.
 */
export function fillDocs(
  facts: IrFact[],
  max = FILL_HISTORY_DOCS,
  rows: TableDoc[] = [],
  older?: ReadonlySet<string>,
  maxOlder = FILL_OLDER_DOCS,
): string[] {
  const by = new Map<string, { filed: string; n: number }>();
  for (const f of facts) {
    if (!f.document_id || typeof (f.locator as { t?: unknown }).t !== "number") continue;
    const d = by.get(f.document_id) ?? { filed: f.filed ?? "", n: 0 };
    d.n++;
    by.set(f.document_id, d);
  }
  // A document without a filing date takes the plan's place for its order and window, never as a filing date.
  for (const r of rows) {
    const d = by.get(r.id);
    if (d) d.filed = d.filed || r.filed || r.placed || "";
    else by.set(r.id, { filed: r.filed ?? r.placed ?? "", n: -1 });
  }
  const kinds = new Map(rows.map((r) => [r.id, r.kind]));
  for (const f of facts)
    if (f.document_id && !kinds.has(f.document_id))
      kinds.set(f.document_id, f.document_kind ?? null);
  const live = [...by.entries()].filter(([, d]) => d.n >= 2 || d.n === -1);
  const newest = live.reduce((m, [, d]) => (d.filed > m ? d.filed : m), "");
  const back = newest ? monthsBefore(newest, FILL_MONTHS) : "";
  // Newest quarter first; within a quarter releases and supplements before other exhibits, then newest filing.
  const quarter = (d: string) =>
    d.slice(0, 4) + String(Math.floor((Number(d.slice(5, 7)) - 1) / 3));
  const tier = (id: string) =>
    ["press-release", "supplement"].includes(kinds.get(id) ?? "") ? 0 : 1;
  const order = (list: typeof live) =>
    list.sort(
      (a, b) =>
        quarter(b[1].filed).localeCompare(quarter(a[1].filed)) ||
        tier(a[0]) - tier(b[0]) ||
        b[1].filed.localeCompare(a[1].filed) ||
        b[1].n - a[1].n ||
        a[0].localeCompare(b[0]),
    );
  const recent = order(live.filter(([, d]) => !d.filed || d.filed >= back)).slice(0, max);
  const before = older?.size
    ? order(live.filter(([id, d]) => !!d.filed && d.filed < back && older.has(id))).slice(0, maxOlder)
    : [];
  return [...recent, ...before].map(([id]) => id);
}

/** Documents read ahead of the one being filled (their downloads overlap; fills stay in order, one at a time). */
const READ_AHEAD = 4;

/**
 * Fill the newest documents' tables. `read` returns a document's stored text (rendition, else the HTML
 * original), or null when it cannot be read within its bounds; it is called once per document.
 */
export async function fillCompany(
  facts: IrFact[],
  read: (id: string) => Promise<string | FillDoc | "wait" | null>,
  opts: {
    maxDocs?: number;
    company?: string;
    /** the company's table documents by their rows (read even with no stored fact) */
    docs?: TableDoc[];
    /** period ends of the company's 10-Q and 10-K reports ("YYYY-MM-DD"), for its fiscal calendar */
    reports?: string[];
    /** the plan's primary statement documents filed before the full window (doc-plan.ts): filled too */
    older?: ReadonlySet<string>;
  } = {},
): Promise<FillRun> {
  // Facts a previous fill wrote are never inputs (the build is from stored facts only).
  const stored = facts.filter((f) => f.method !== FILL_METHOD);
  const rows = new Map((opts.docs ?? []).map((d) => [d.id, d]));
  const ids = fillDocs(stored, opts.maxDocs ?? FILL_HISTORY_DOCS, opts.docs, opts.older);
  const calendar = fiscalCalendar(stored, opts.reports);
  // Period ends known to the day: the report dates, and the ends at least two stored flow figures use.
  const exact = exactEnds(stored, opts.reports);
  const docMeta = new Map<string, { filed: string | null; kind: string | null }>();
  const byDoc = new Map<string, IrFact[]>();
  for (const f of stored)
    if (f.document_id) byDoc.set(f.document_id, [...(byDoc.get(f.document_id) ?? []), f]);
  const fills = new Map<string, DocFill>();
  const captions = new Map<string, TableCaption[]>();
  const texts = new Map<string, string>();
  const added: IrFact[] = [];
  const comparisons = new Set<IrFact>();
  const dated = new Map<string, string>();
  const proForma = new Set<string>();
  let notResults = 0;
  let read_ = 0;
  let failed = 0;
  let waiting = 0;
  // One document is filled at a time, in order, and its reduced grid is dropped once its fill is taken; the
  // next few are already being read, so a company with a hundred documents waits on its downloads only once.
  const pending = new Map<number, Promise<string | FillDoc | "wait" | null>>();
  const start = (i: number) => {
    if (i < ids.length && !pending.has(i)) pending.set(i, read(ids[i]).catch(() => null));
  };
  for (let at = 0; at < ids.length; at++) {
    const id = ids[at];
    for (let k = at; k <= at + READ_AHEAD; k++) start(k);
    const got = await pending.get(at)!;
    pending.delete(at);
    if (got === "wait") {
      waiting++;
      continue;
    }
    if (!got) {
      failed++;
      continue;
    }
    const doc = typeof got === "string" ? reduceDocument(got, opts.company) : got;
    read_++;
    // A pro forma exhibit prints another company's figures under this company's statement names: nothing of
    // it is read, and the figures a reader stored from it leave the series (`FillRun.proForma`).
    if (proFormaDocument(doc.head)) {
      proForma.add(id);
      continue;
    }
    texts.set(id, doc.head);
    const caps = doc.captions;
    captions.set(id, caps);
    const own = (byDoc.get(id) ?? []).filter((f) => {
      if (!isComparisonPosition(doc.grid, f.locator as {t?:number;r?:number;c?:number})) return true;
      comparisons.add(f);
      return false;
    });
    const row = rows.get(id);
    const tableFacts = own.filter((f) => typeof (f.locator as { t?: unknown }).t === "number");
    // A document no reader took a table figure from is read by its statement titles and column heads alone,
    // which cannot tell whose statements an exhibit prints: a further exhibit of an 8-K that reported no
    // results (no Item 2.02) is left unread (an acquired company's statements carry the same titles as this
    // company's). The release itself is the company's own announcement and is read.
    if (tableFacts.length < 2 && row?.kind !== "press-release" && resultsExhibit(row?.title) === false) {
      notResults++;
      continue;
    }
    let filed = own.find((f) => f.filed)?.filed ?? row?.filed ?? null;
    const inputOf = (date: string | null) => ({
      doc: id,
      html: "",
      grid: doc.grid,
      zeroDash: doc.zeroDash,
      facts: own,
      captions: new Map(caps.map((c) => [c.t, { title: c.title, unit: c.unit }])),
      filed: date,
      calendar,
      exact,
      statementsOnly: tableFacts.length < 2,
      meta: row ? { filed: date ?? row.filed, kind: row.kind, accn: null, doc: null } : undefined,
    });
    // A document stored without a filing date that prints one (`FillRun.dated`): the newest date in the heads
    // of its statement tables is the period it reports; the first date of its opening text within 120 days
    // after that is when it was published. Its statements are then read as any dated document's: without a
    // date no column head of a document with no stored fact can be settled.
    if (!filed) {
      const reports = fillDocument(inputOf(null))
        .statements.map((x) => doc.grid.find((t) => t.index === x.t))
        .map((t) => (t ? newestHeadDate(t) : null))
        .filter((x): x is string => !!x)
        .sort()
        .at(-1);
      const hit = reports ? inferFiled({ text: doc.head, periodEnd: reports }) : null;
      if (hit?.filed) {
        filed = hit.filed;
        dated.set(id, filed);
        for (const f of own) if (!f.filed) f.filed = filed;
      }
    }
    docMeta.set(id, { filed, kind: own[0]?.document_kind ?? row?.kind ?? null });
    const fill = fillDocument(inputOf(filed));
    fills.set(id, fill);
    added.push(...fill.facts);
  }
  // Stored figures whose printed negative the reader read as positive (the closing parenthesis in the next cell).
  const fixed = new Map<string, IrFact>();
  for (const fill of fills.values()) for (const f of fill.fixes) if (f.id) fixed.set(f.id, f);
  const levels = comparisons.size ? stored.filter((f) => !comparisons.has(f)) : stored;
  const kept = proForma.size ? levels.filter((f) => !f.document_id || !proForma.has(f.document_id)) : levels;
  const base = fixed.size ? kept.map((f) => (f.id && fixed.get(f.id)) || f) : kept;
  const fx = [...fixed.values()];
  return {
    facts: [...base, ...added],
    fills,
    captions,
    texts,
    signs: fx.filter((f) => (f.locator as { sign?: string }).sign === "printed").length,
    moved: fx.filter((f) => (f.locator as { moved?: string }).moved).length,
    scaled: fx.filter((f) => (f.locator as { scale?: string }).scale === "printed").length,
    docs: docMeta,
    chosen: ids.length,
    read: read_,
    failed,
    waiting,
    dated,
    proForma,
    notResults,
  };
}

/** Kinds of document whose tables the fill reads without a stored fact. */
export const TABLE_DOC_KINDS = ["press-release", "supplement", "other"];
/** How far back a document no fact points into is still read (months): the fill's history depth. */
export const TABLE_DOC_MONTHS = FILL_MONTHS;

/** A document row as the store keeps it, for `tableDocRows`. */
export interface StoredDocRow {
  id: string;
  kind: string | null;
  ext: string | null;
  filed: string | null;
  title: string | null;
  bytes: number | null;
  extract_status: string | null;
}

/**
 * The company's table documents by their rows: releases, supplements and other exhibits stored as HTML, filed
 * within the last 37 months of `today` (`FILL_MONTHS`) or named by the plan as an older primary statement
 * document (`older`), within the reader's size bound, not marked "no tables" by the table reader, and not
 * refused; newest first.
 */
export function tableDocRows(
  rows: StoredDocRow[],
  today: string,
  opts: {
    maxBytes?: number;
    refused?: Set<string>;
    older?: ReadonlySet<string>;
    /** documents stored without a filing date, by the date the plan places them at */
    placed?: Readonly<Record<string, string>>;
  } = {},
): TableDoc[] {
  const [y, m, d] = today.slice(0, 10).split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1 - TABLE_DOC_MONTHS, d)).toISOString().slice(0, 10);
  const at = (r: StoredDocRow) => r.filed ?? opts.placed?.[r.id] ?? null;
  return rows
    .filter(
      (r) =>
        !!at(r) &&
        (at(r)! >= back || !!opts.older?.has(r.id)) &&
        (!r.filed || r.filed <= today) &&
        TABLE_DOC_KINDS.includes(r.kind ?? "") &&
        /^html?$/i.test(r.ext ?? "") &&
        (r.bytes ?? 0) <= (opts.maxBytes ?? Infinity) &&
        r.extract_status !== "no tables" &&
        !opts.refused?.has(r.id),
    )
    .sort((a, b) => at(b)!.localeCompare(at(a)!) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, filed: r.filed, kind: r.kind, title: r.title, ...(r.filed ? {} : { placed: at(r)! }) }));
}

/**
 * The quarter and year ends of a company's SEC statement file (`CompanyDataset.statements`: quarterly and
 * annual, each statement with its `periods`), newest first: the periods its own 10-Q and 10-K filings report.
 */
export function statementPeriodEnds(file: {
  statements?: Record<string, Record<string, { periods?: { end?: string }[] } | undefined> | undefined>;
}): string[] {
  const out = new Set<string>();
  for (const freq of Object.values(file.statements ?? {}))
    for (const st of Object.values(freq ?? {}))
      for (const p of st?.periods ?? []) if (/^\d{4}-\d{2}-\d{2}$/.test(p.end ?? "")) out.add(p.end!);
  return [...out].sort().reverse();
}

/** Period ends known to the day: the 10-Q and 10-K report dates and every end at least two stored flow figures use. */
export function exactEnds(facts: IrFact[], reports: string[] = []): string[] {
  const n = new Map<string, number>();
  for (const f of facts)
    if ([3, 6, 9, 12].includes(f.months) && /^\d{4}-\d{2}-\d{2}$/.test(f.period_end ?? ""))
      n.set(f.period_end, (n.get(f.period_end) ?? 0) + 1);
  return [...new Set([...reports.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r)), ...[...n].filter(([, k]) => k >= 2).map(([e]) => e)])].sort();
}

/**
 * The company's fiscal quarter ends ("MM-DD"): the month and day of every period end at least two of its stored
 * flow facts use, and of its 10-Q and 10-K report dates, each stepped through the year by three months.
 */
export function fiscalCalendar(facts: IrFact[], reports: string[] = []): string[] {
  const n = new Map<string, number>();
  for (const f of facts)
    if ([3, 6, 9, 12].includes(f.months) && /^\d{4}-\d{2}-\d{2}$/.test(f.period_end ?? ""))
      n.set(f.period_end.slice(5), (n.get(f.period_end.slice(5)) ?? 0) + 1);
  const points = [...n].filter(([, k]) => k >= 2).map(([md]) => md);
  for (const r of reports) if (/^\d{4}-\d{2}-\d{2}$/.test(r)) points.push(r.slice(5));
  return quarterEnds(points);
}

/**
 * The printed layout of each section table read ([row, indent level, flags]: 1 bold, 2 rule above, 4 filled
 * from the document), label-only rows that only begin the next row's wrapped name taken out of the headings,
 * and conflicts between stored facts and the document, by payload document index.
 */
export function withFill(p: IrPayload, run: FillRun): IrPayload {
  const index = new Map(p.docs.map((d, i) => [d.id, i]));
  const tables = { ...(p.tables ?? {}) };
  const conflicts: PayloadFillConflict[] = [];
  // A section's table with no printed title still says which periods its columns print.
  const anchors = new Set(statementAnchors(p).map((a) => `${a.d}:${a.t}`));
  for (const [id, fill] of run.fills) {
    const d = index.get(id);
    if (d == null) continue;
    for (const t of fill.tables) {
      const key = `${d}:${t.t}`;
      const cap = tables[key] ?? (anchors.has(key) && t.cols?.length ? {} : undefined);
      if (!cap) continue;
      const wraps = new Set(t.wraps);
      const heads = cap.heads?.filter(([r]) => !wraps.has(r));
      tables[key] = {
        ...cap,
        ...(heads ? { heads } : {}),
        ...(t.style.length ? { rows: t.style } : {}),
        ...(t.cols?.length ? { cols: t.cols } : {}),
      };
      if (heads && !heads.length) delete tables[key].heads;
    }
    for (const c of fill.conflicts)
      conflicts.push({
        d,
        t: c.t,
        r: c.r,
        c: c.c,
        printed: c.printed,
        stored: c.stored,
        v: c.value,
      });
  }
  return {
    ...p,
    ...(Object.keys(tables).length ? { tables } : {}),
    ...(conflicts.length
      ? { fill: { conflicts: conflicts.slice(0, 200), n: conflicts.length } }
      : {}),
  };
}

const REASONS: MissReason[] = ["period", "unit", "label", "duplicate"];

/** Why printed rows of a statement table are not shown, beyond the row reasons: the table became no section. */
export type TableMissReason = MissReason | "section";

/**
 * The main document for the quality counts: of the documents read, the newest filing that prints a statement
 * table (ties: more statement tables, then a supplement).
 */
export function qualityDoc(run: FillRun): string | null {
  let best: { id: string; filed: string; n: number; sup: boolean } | null = null;
  for (const [id, fill] of run.fills) {
    const n = fill.statements.length;
    if (!n) continue;
    const m = run.docs.get(id);
    const cur = { id, filed: m?.filed ?? "", n, sup: m?.kind === "supplement" };
    if (
      !best ||
      cur.filed > best.filed ||
      (cur.filed === best.filed && (cur.n > best.n || (cur.n === best.n && cur.sup && !best.sup)))
    )
      best = cur;
  }
  return best?.id ?? null;
}

/**
 * The quality summary of a built payload (stats.quality); `run` is absent when no document was read.
 * - v: version of this summary (1).
 * - sections, mainSections: statement sections laid out, and those of the main document (newest supplement, else release).
 * - mainDoc: filing date and kind of that main document.
 * - rows: over every section table read by the fill: printed = numeric rows the tables print (rows with a figure
 *   after their label, column heads excluded); before = rows a stored fact covers; filled = rows added from the
 *   document; after = before + filled; missing = printed rows still not shown, by reason (period: no column of the
 *   row has a certain period; unit: unit or scale not certain; label: no printed name; duplicate: a name printed
 *   twice under one heading).
 * - main: the same counts over every statement table of the main document for quality (`qualityDoc`: the newest
 *   document read that prints a statement table), so percent shown is percent of the document's statements:
 *   tables {printed, shown}; a statement table that became no section counts all its printed rows as missing,
 *   by their row reasons where the fill read the table, the rows it read under "section", and every row under
 *   "period" where no column head of the table could be settled; doc = that document's filing date and kind.
 * - fill: docs chosen (newest table documents, at most FILL_DOCS), read, failed (not readable from markup within
 *   the bounds: no rendition or HTML, too large, timed out; image-only files count here), tables filled, cells
 *   written, shownCells (filled cells the payload shows in quarter, year or month columns), conflicts (stored fact
 *   text unlike the document at its own position), signs (stored positives printed as two-cell negatives, given
 *   the printed sign), moved (stored figures put under another column's period, moved to their column's period),
 *   waiting (documents chosen but left for a later rebuild: no reduced copy stored yet and this rebuild's
 *   downloads spent; the stale lane comes back while some wait, see scripts/lib/ir-rebuild-stale.ts),
 *   pass and at (written by rebuild.server.ts: rebuilds in a row that left documents waiting, and when),
 *   scaled (stored money figures read as whole dollars in a table printing "in thousands" and the like, scaled).
 * - dupLabels: sections showing one row name twice; mixedScale: sections whose money lines are at two printed
 *   scales; orphanHeads: headings with no line under them before the next spacer or the end.
 * - latest: newest quarter column; newest: filing date and kind of the newest document; ties: quarter tie-outs (ok/total).
 */
export function qualityOf(p: IrPayload, run?: FillRun): IrQuality {
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const sections = assembleStatements(p);
  const index = new Map(p.docs.map((d, i) => [d.id, i]));
  const main = sections.find((s) => s.group === "main")?.doc;
  const anchors = new Set(sections.map((s) => s.id));
  let printed = 0;
  let before = 0;
  let filled = 0;
  let mainPrinted = 0;
  let mainBefore = 0;
  let mainFilled = 0;
  let cells = 0;
  let conflicts = 0;
  let tablesRead = 0;
  const missing: Partial<Record<MissReason, number>> = {};
  const mainMissing: Partial<Record<TableMissReason, number>> = {};
  const add = (into: Partial<Record<string, number>>, r: string, n: number) => {
    if (n) into[r] = (into[r] ?? 0) + n;
  };
  for (const [id, fill] of run?.fills ?? []) {
    const d = index.get(id);
    conflicts += fill.conflicts.length;
    for (const t of fill.tables) {
      tablesRead++;
      cells += t.cells;
      // Only tables a section is laid out from count toward printed and shown rows.
      if (d == null || !anchors.has(`${d}:${t.t}`)) continue;
      printed += t.printed;
      before += t.covered;
      filled += t.filled;
      for (const r of REASONS) add(missing, r, t.missing[r] ?? 0);
    }
  }
  // The main document's statement tables, shown or not.
  const qDoc = run ? qualityDoc(run) : null;
  let mainTables = 0;
  let mainShown = 0;
  if (run && qDoc) {
    const fill = run.fills.get(qDoc)!;
    const d = index.get(qDoc);
    for (const st of fill.statements) {
      mainTables++;
      const t = fill.tables.find((x) => x.t === st.t);
      const shown = d != null && anchors.has(`${d}:${st.t}`);
      if (shown && t) {
        mainShown++;
        mainPrinted += t.printed;
        mainBefore += t.covered;
        mainFilled += t.filled;
        for (const r of REASONS) add(mainMissing, r, t.missing[r] ?? 0);
      } else if (t) {
        mainPrinted += t.printed;
        for (const r of REASONS) add(mainMissing, r, t.missing[r] ?? 0);
        add(mainMissing, "section", t.covered + t.filled);
      } else {
        mainPrinted += st.rows;
        add(mainMissing, "period", st.rows);
      }
    }
  }
  // Layout defects any reader would see.
  let dupLabels = 0;
  let mixedScale = 0;
  let orphanHeads = 0;
  for (const s of sections) {
    const names = new Map<string, number>();
    for (const r of s.rows)
      if (r.kind === "line") {
        const n = rowLabel(r, byKey).toLowerCase();
        names.set(n, (names.get(n) ?? 0) + 1);
      }
    if ([...names.values()].some((n) => n > 1)) dupLabels++;
    const divs = new Set(
      s.keys
        .map((k) => byKey.get(k))
        .filter((x) => x && x.unit === "usd")
        .map((x) => lineDiv(x!)),
    );
    if (divs.size > 1) mixedScale++;
    // A heading with no line under it before the next spacer band or the end of the section.
    s.rows.forEach((r, i) => {
      if (r.kind !== "head") return;
      const rest = s.rows.slice(i + 1);
      const stop = rest.findIndex((x) => x.kind === "gap");
      if (!(stop < 0 ? rest : rest.slice(0, stop)).some((x) => x.kind === "line")) orphanHeads++;
    });
  }
  const newest = p.docs.reduce<{ filed: string; kind: string | null } | null>(
    (m, d) => (d.filed && (!m || d.filed > m.filed) ? { filed: d.filed, kind: d.kind } : m),
    null,
  );
  const printedCells = p.series.reduce(
    (n, s) =>
      n +
      [...Object.values(s.q), ...Object.values(s.y), ...Object.values(s.mo ?? {})].filter(
        (c) => c.how === "printed",
      ).length,
    0,
  );
  return {
    v: 2,
    sections: sections.length,
    mainSections: sections.filter((s) => s.group === "main").length,
    mainDoc:
      main != null
        ? { filed: p.docs[main]?.filed ?? null, kind: p.docs[main]?.kind ?? null }
        : null,
    rows: { printed, before, after: before + filled, filled, missing },
    main: {
      printed: mainPrinted,
      before: mainBefore,
      after: mainBefore + mainFilled,
      missing: mainMissing,
      tables: { printed: mainTables, shown: mainShown },
      doc: qDoc ? (run?.docs.get(qDoc) ?? null) : null,
    },
    fill: {
      docs: run?.chosen ?? 0,
      read: run?.read ?? 0,
      failed: run?.failed ?? 0,
      tables: tablesRead,
      cells,
      shownCells: printedCells,
      conflicts,
      signs: run?.signs ?? 0,
      moved: run?.moved ?? 0,
      scaled: run?.scaled ?? 0,
      waiting: run?.waiting ?? 0,
    },
    dupLabels,
    mixedScale,
    orphanHeads,
    latest: p.quarters.at(-1) ?? null,
    newest,
    ties: { ok: p.stats.checksQ.ok, total: p.stats.checksQ.total },
  };
}
