// Pure: table fill at rebuild time, and the quality summary every rebuild writes into stats.quality.
// The build reads a company's newest table documents (rebuild.server.ts supplies the reader, bounded in
// bytes, time and documents), fills each table's printed rows the stored facts do not cover
// (table-fill.ts), builds the payload from stored and filled facts together, then stores the printed
// layout of the section tables and the summary. A document that cannot be read leaves its tables as the
// stored facts give them.
import type { IrFact } from "@/lib/ir/kpis";
import type { IrPayload, IrQuality, PayloadFillConflict } from "@/lib/ir/payload";
import { assembleStatements, lineDiv, rowLabel } from "@/lib/ir/statements";
import { fillDocument, FILL_METHOD, type DocFill, type MissReason } from "@/lib/ir/table-fill";
import { tableCaptions, type TableCaption } from "@/lib/ir/table-captions";

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

/** Newest documents per company whose tables are filled (the anchor tables and their recent history). */
export const FILL_DOCS = 12;

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
  /** documents chosen, read and not readable */
  chosen: number;
  read: number;
  failed: number;
}

/** Documents with table facts, newest filing first (ties: more table facts first), at most `max`. */
export function fillDocs(facts: IrFact[], max = FILL_DOCS): string[] {
  const by = new Map<string, { filed: string; n: number }>();
  for (const f of facts) {
    if (!f.document_id || typeof (f.locator as { t?: unknown }).t !== "number") continue;
    const d = by.get(f.document_id) ?? { filed: f.filed ?? "", n: 0 };
    d.n++;
    by.set(f.document_id, d);
  }
  return [...by.entries()]
    .filter(([, d]) => d.n >= 2)
    .sort(
      (a, b) => b[1].filed.localeCompare(a[1].filed) || b[1].n - a[1].n || a[0].localeCompare(b[0]),
    )
    .slice(0, max)
    .map(([id]) => id);
}

/**
 * Fill the newest documents' tables. `read` returns a document's stored text (rendition, else the HTML
 * original), or null when it cannot be read within its bounds; it is called once per document.
 */
export async function fillCompany(
  facts: IrFact[],
  read: (id: string) => Promise<string | null>,
  opts: { maxDocs?: number; company?: string } = {},
): Promise<FillRun> {
  // Facts a previous fill wrote are never inputs (the build is from stored facts only).
  const stored = facts.filter((f) => f.method !== FILL_METHOD);
  const ids = fillDocs(stored, opts.maxDocs ?? FILL_DOCS);
  const byDoc = new Map<string, IrFact[]>();
  for (const f of stored)
    if (f.document_id) byDoc.set(f.document_id, [...(byDoc.get(f.document_id) ?? []), f]);
  const fills = new Map<string, DocFill>();
  const captions = new Map<string, TableCaption[]>();
  const texts = new Map<string, string>();
  const added: IrFact[] = [];
  let read_ = 0;
  let failed = 0;
  for (const id of ids) {
    const html = await read(id).catch(() => null);
    if (!html) {
      failed++;
      continue;
    }
    read_++;
    texts.set(id, html.slice(0, 60_000));
    const caps = tableCaptions(html, opts.company);
    captions.set(id, caps);
    const fill = fillDocument({
      doc: id,
      html,
      facts: byDoc.get(id) ?? [],
      captions: new Map(caps.map((c) => [c.t, { title: c.title, unit: c.unit }])),
    });
    fills.set(id, fill);
    added.push(...fill.facts);
  }
  // Stored figures whose printed negative the reader read as positive (the closing parenthesis in the next cell).
  const fixed = new Map<string, IrFact>();
  for (const fill of fills.values()) for (const f of fill.fixes) if (f.id) fixed.set(f.id, f);
  const base = fixed.size ? stored.map((f) => (f.id && fixed.get(f.id)) || f) : stored;
  const fx = [...fixed.values()];
  return {
    facts: [...base, ...added],
    fills,
    captions,
    texts,
    signs: fx.filter((f) => (f.locator as { sign?: string }).sign === "printed").length,
    moved: fx.filter((f) => (f.locator as { moved?: string }).moved).length,
    chosen: ids.length,
    read: read_,
    failed,
  };
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
  for (const [id, fill] of run.fills) {
    const d = index.get(id);
    if (d == null) continue;
    for (const t of fill.tables) {
      const key = `${d}:${t.t}`;
      const cap = tables[key];
      if (!cap) continue;
      const wraps = new Set(t.wraps);
      const heads = cap.heads?.filter(([r]) => !wraps.has(r));
      tables[key] = {
        ...cap,
        ...(heads ? { heads } : {}),
        ...(t.style.length ? { rows: t.style } : {}),
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
 * - main: the same counts for the main document's tables only (the figure to rank companies by).
 * - fill: docs chosen (newest table documents, at most FILL_DOCS), read, failed (not readable from markup within
 *   the bounds: no rendition or HTML, too large, timed out; image-only files count here), tables filled, cells
 *   written, shownCells (filled cells the payload shows in quarter, year or month columns), conflicts (stored fact
 *   text unlike the document at its own position), signs (stored positives printed as two-cell negatives, given
 *   the printed sign), moved (stored figures put under another column's period, moved to their column's period).
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
  const mainMissing: Partial<Record<MissReason, number>> = {};
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
      for (const r of REASONS) if (t.missing[r]) missing[r] = (missing[r] ?? 0) + t.missing[r]!;
      if (d === main) {
        mainPrinted += t.printed;
        mainBefore += t.covered;
        mainFilled += t.filled;
        for (const r of REASONS)
          if (t.missing[r]) mainMissing[r] = (mainMissing[r] ?? 0) + t.missing[r]!;
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
    v: 1,
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
    },
    dupLabels,
    mixedScale,
    orphanHeads,
    latest: p.quarters.at(-1) ?? null,
    newest,
    ties: { ok: p.stats.checksQ.ok, total: p.stats.checksQ.total },
  };
}
