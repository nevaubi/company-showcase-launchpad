// The IR tab's statements: every printed table of the company's documents as one section over its whole
// history, in the company's own order and names (sections assembled purely in src/lib/ir/statements.ts).
// Controls: current or all series, quarterly or annual, 8Q / 20Q / all, a category filter, line search,
// a jump list, Excel and per-section downloads. Sections render as they come near the screen, so a bank's
// page lays out quickly; nothing scrolls inside the page except a wide table sideways.
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronsDown,
  FileSpreadsheet,
  Info,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import wordmark from "@/assets/brand/wordmark.png.asset.json";
import { useFeatureGate } from "@/hooks/use-plan";
import { useUnitScale } from "@/hooks/use-preference";
import { Segmented } from "@/components/app/segmented";
import { IrPanel } from "@/components/ir/panel";
import { CheckDot } from "@/components/ir/marks";
import {
  GridCols,
  HeadCells,
  StatementSection,
  gridWidth,
  type SectionView,
  type ShownCell,
  type ShownRow,
} from "@/components/ir/statement-section";
import { IR } from "@/components/ir/typography";
import { ScrollGroupContext, scrollGroup } from "@/components/ir/scroll-group";
import { useGridFit } from "@/components/ir/grid-fit";
import { filterOptions, missingNote, sectionFilter } from "@/components/ir/statement-nav";
import {
  basisTag,
  isBlank,
  splitMark,
  isRatioLine,
  notePrinted,
  gridColWidth,
  FIGURE_CAP,
  NOTED_CAP,
  gridFigure,
  sectionHeightCss,
  totalKinds,
  type SectionBox,
} from "@/components/ir/table-style";
import type { VizLine } from "@/components/ir/viz-slots";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { coverageOf } from "@/lib/coverage";
import { useCompany } from "@/lib/data";
import { downloadBlob, fetchLogo, slug } from "@/lib/export/xlsx-theme";
import { inDimension, periodLong } from "@/lib/ir/display";
import { jumpGroups, missingHeadlines, missingStatements, sectorOf } from "@/lib/ir/sector-order";
import type {
  IrPayload,
  PayloadCell,
  PayloadCheck,
  PayloadGroup,
  PayloadSeries,
} from "@/lib/ir/payload";
import { fiscalCalendar, periodGrids, uniqueHeads, type IrPeriodKind } from "@/lib/ir/periods";
import {
  assembleStatements,
  currentCut,
  lineDiv,
  lineLabel,
  printedDecimals,
  printedFigure,
  printedSuffix,
  printsIn,
  rowLabel,
  rowCells,
  scaleNote,
  unplacedLines,
  sectionChecks,
  visibleRows,
  type Statement,
  type StatementRow,
} from "@/lib/ir/statements";
import { openIrCell, type IrFocus } from "@/components/ir/breakdowns";
import {
  hasYtd,
  isYtdSection,
  parseYtdKey,
  sortYtd,
  ytdHead,
  ytdInSpan,
  ytdLong,
  ytdRowCells,
} from "@/components/ir/ytd";
import { cn } from "@/lib/utils";

type Freq = "q" | "y";
const SPANS: Record<Freq, { v: string; l: string }[]> = {
  q: [
    { v: "8", l: "8Q" },
    { v: "20", l: "20Q" },
    { v: "all", l: "All" },
  ],
  y: [
    { v: "5", l: "5Y" },
    { v: "10", l: "10Y" },
    { v: "all", l: "All" },
  ],
};
const DEFAULT_SPAN: Record<Freq, string> = { q: "8", y: "5" };
const FREQ_FILE: Record<Freq, string> = { q: "quarterly", y: "annual" };
/** The label cell of the tab's column head row. */
const FREQ_HEAD: Record<Freq, string> = { q: "Quarter", y: "Fiscal year" };
/** Sections laid out on first paint; the rest mount as they come within about one screen. */
const EAGER = 1;
/** How far below the screen a section starts to mount. */
const MOUNT_MARGIN = "600px 0px";

const KIND_NAME: Record<string, string> = {
  "press-release": "earnings release",
  supplement: "supplement",
  presentation: "presentation",
  data: "data file",
  other: "document",
};

/** Figures read from sentences (no printed table places them), one list per category, after the statements. */
function textSection(p: IrPayload, sections: Statement[]): Statement | null {
  const rest = unplacedLines(p, sections).filter(
    (s) => Object.keys(s.q).length || Object.keys(s.y).length,
  );
  if (!rest.length) return null;
  const cats = [...new Set(rest.map((s) => s.cat))];
  const rows: StatementRow[] = [];
  for (const c of cats) {
    if (rows.length) rows.push({ kind: "gap" });
    for (const s of rest.filter((x) => x.cat === c))
      rows.push({ kind: "line", k: s.k, ks: [s.k], depth: 0, total: false });
  }
  return {
    id: "text",
    title: "Figures stated in the text of releases",
    titleFrom: "category",
    group: "more",
    unitLine: "Dollar figures in millions",
    div: 1e6,
    rows,
    keys: rest.map((s) => s.k),
    docs: new Set(rest.flatMap((s) => Object.values(s.q).map((c) => c.d))).size,
    last: "",
    first: "",
    cat: "kpi",
    doc: -1,
  };
}

function cellTitle(
  p: IrPayload,
  s: PayloadSeries,
  c: PayloadCell,
  e: string,
  freq: Freq,
  chk: PayloadCheck | undefined,
  held: boolean,
  /** the figure in full, when the grid shows it in short form */
  full?: string,
) {
  const doc = c.d != null ? p.docs[c.d] : undefined;
  const kind = KIND_NAME[doc?.kind ?? ""] ?? "document";
  return [
    `${lineLabel(s)}, ${parseYtdKey(e) ? ytdLong(e) : periodLong(c.m === 0 && c.e ? c.e : e, freq, c.m)}`,
    held ? `Held back: ${c.why ?? "its unit is contradicted by the documents"}` : null,
    full && full.replace(/\)$/, "").length > FIGURE_CAP ? `In full: ${full}` : null,
    c.f ? `Calculated: ${c.f.formula}` : c.x ? `Printed as “${c.x}”` : null,
    !c.f && c.how === "printed" ? "Read from the document's own table" : null,
    doc ? `In the ${kind}${doc.filed ? ` filed ${doc.filed}` : ""}` : null,
    c.alt
      ? `${c.alt.kind === "restated" ? "An earlier" : "Another"} document prints ${c.alt.v.toLocaleString("en-US")} (full units)`
      : null,
    chk
      ? chk.partial
        ? "Selected lines only: not all parts are printed"
        : chk.ok
          ? `${chk.n} parts add up to this total`
          : `Parts add up to ${chk.sum.toLocaleString("en-US")}, the printed total is ${chk.total.toLocaleString("en-US")} (full units)`
      : null,
    ...(c.flags ?? []).map((f) => f.why),
    "Click to open the source",
  ]
    .filter(Boolean)
    .join("\n");
}

/** One prepared view of a section for the controls in force, or null when nothing of it is in view. */
function sectionView(
  p: IrPayload,
  sec: Statement,
  byKey: Map<string, PayloadSeries>,
  checks: Map<string, PayloadCheck>,
  o: {
    freq: Freq;
    all: string[];
    span: string;
    cut?: string;
    dim: string;
    q: string;
    fy: ReturnType<typeof fiscalCalendar>;
    /** a year-to-date section (`isYtdSection`) under the quarterly switch: its columns as printed, or the
     *  quarters (printed first quarters, the others calculated from the year-to-date figures) */
    ytd?: "printed" | "quarters";
  },
): SectionView | null {
  const ytd = o.freq === "q" && isYtdSection(sec) ? (o.ytd ?? "printed") : undefined;
  const printedYtd = ytd === "printed";
  // A chip selects whole printed tables by their kind; a section without one (the text figures) by its lines.
  const secFilter = sectionFilter(sec);
  if (o.dim !== "all" && secFilter && secFilter !== o.dim) return null;
  const dimOk = (s: PayloadSeries) =>
    !!secFilter || inDimension({ cat: s.cat, met: s.met } as PayloadGroup, o.dim);
  const inTitle = !!o.q && sec.title.toLowerCase().includes(o.q);
  const match = o.q && !inTitle
    ? (s: PayloadSeries, row: Extract<StatementRow, { kind: "line" }>) =>
        s.label.toLowerCase().includes(o.q) || rowLabel(row, byKey).toLowerCase().includes(o.q)
    : undefined;
  const { rows, hidden } = visibleRows(sec, byKey, {
    cut: o.cut,
    has: (s) => (printedYtd ? hasYtd(s) : printsIn(s, o.all, o.freq)) && dimOk(s),
    match,
  });
  const lineRows = rows.filter(
    (r): r is Extract<StatementRow, { kind: "line" }> => r.kind === "line",
  );
  if (!lineRows.length) return null;
  const merged = new Map(
    lineRows.map((r) => [
      r,
      printedYtd ? ytdRowCells(r.ks, byKey) : rowCells(r.ks, byKey, o.freq, r.at),
    ]),
  );
  const present = new Set<string>();
  for (const m of merged.values())
    for (const e of [...Object.keys(m.cells), ...Object.keys(m.held)]) present.add(e);
  // A year-to-date section lays out its printed columns in time order; a period chip keeps those that end
  // within the quarters it covers.
  const cols = printedYtd
    ? ytdInSpan(sortYtd(present), o.all, o.span)
    : o.span === "all"
      ? o.all
      : o.all.slice(-Number(o.span));
  // The grid's columns follow the period chips, never the section's content: a section with no figure in
  // them is not in view.
  if (!cols.some((e) => present.has(e))) return null;
  const headMap = printedYtd
    ? new Map(cols.map((k) => [k, ytdHead(k)]))
    : uniqueHeads(cols, o.freq, o.fy);
  const tableChecks = sectionChecks(sec, byKey, checks);
  let tieOk = 0;
  let tieN = 0;
  let failing = 0;
  let flagged = 0;
  let held = 0;
  const lines: VizLine[] = [];
  // Which periods each printed table of the section prints, so a cell its own table leaves empty reads as
  // blank and a period no document prints as missing.
  const printed = new Map<string, Set<string>>();
  for (const m of merged.values())
    for (const e of cols) {
      const c = m.cells[e] ?? m.held[e];
      if (c) notePrinted(printed, c.d, c.l, e);
    }
  const kinds = totalKinds(
    rows.map((r) =>
      r.kind === "line"
        ? {
            kind: "line" as const,
            depth: r.depth,
            total: r.total,
            // printed marks of the anchor table (build format 3)
            bold: r.bold,
            rule: r.rule,
            up:
              r.up != null && rows.includes(sec.rows[r.up])
                ? rows.indexOf(sec.rows[r.up])
                : undefined,
            old: r.old,
          }
        : { kind: r.kind },
    ),
  );
  const shown: ShownRow[] = rows.map((r, i) => {
    if (r.kind === "gap") return { kind: "gap", id: `g${i}` };
    if (r.kind === "head") return { kind: "head", id: `h${i}`, text: r.text, depth: r.depth };
    const s = byKey.get(r.k)!;
    const m = merged.get(r)!;
    const div = s.unit === "usd" || s.unit === "count" ? lineDiv(s) : 1;
    const shownDiv = s.unit === "usd" && sec.id === "text" ? 1e6 : div;
    const dec = printedDecimals(s);
    // a quiet note after the name when the line's scale is not the section's ("in billions", "in dollars")
    const note = sec.id === "text" ? "" : scaleNote(div, s, sec.div);
    const suffix = printedSuffix(s);
    const cells: (ShownCell | null)[] = cols.map((e) => {
      const c = m.cells[e] ?? m.held[e];
      if (!c) return null;
      const isHeld = !m.cells[e];
      const owner = byKey.get(m.from[e]) ?? s;
      // Only a total the section prints with its parts carries the tie-out mark, checked against those parts.
      const chk = r.total && !printedYtd ? tableChecks.get(`${owner.k}|${o.freq}|${e}`) : undefined;
      if (chk && !chk.partial) {
        tieN++;
        if (chk.ok) tieOk++;
        else failing++;
      }
      if (c.flags?.length) flagged++;
      if (isHeld) held++;
      return {
        c,
        s: owner,
        text: gridFigure(
          printedFigure(c.v, shownDiv, dec, suffix),
          c.v,
          shownDiv,
          suffix,
          // Only a figure in full units has an exact short form ("50M" dollars); a figure in a printed
          // scale (thousands of shares) is never shortened: "15M" would read as fifteen million.
          shownDiv === 1 && (s.unit === "usd" || s.unit === "count")
            ? note
              ? NOTED_CAP
              : FIGURE_CAP
            : Infinity,
        ),
        held: isHeld,
        check: chk,
        title: cellTitle(
          p,
          owner,
          c,
          e,
          o.freq,
          chk,
          isHeld,
          printedFigure(c.v, shownDiv, dec, suffix),
        ),
        ...(printedYtd ? { e: c.e ?? parseYtdKey(e)?.e ?? e } : {}),
      };
    });
    // The charts plot quarters and years; printed year-to-date columns of different lengths are not a series.
    if (!printedYtd)
      lines.push({
        s,
        depth: r.depth,
        total: r.total,
        cells: cells.map((x) => (x && !x.held ? x.c : null)),
      });
    const label = rowLabel(r, byKey);
    return {
      kind: "line",
      id: `l${i}:${r.k}`,
      s,
      depth: r.depth,
      total: r.total,
      tk: kinds[i],
      mark: suffix,
      // a money line printed in dollars inside a table in millions is a per-share line
      ratio: isRatioLine(s.unit, s.unit === "usd" && div === 1 && sec.div > 1),
      old: r.old,
      tag:
        (r as { basis?: string }).basis === "restated"
          ? "Restated"
          : (r as { basis?: string }).basis === "older"
            ? "Older basis"
            : basisTag(label),
      blank: cols.map((e, j) => !cells[j] && isBlank(r.at, e, printed)),
      label,
      note,
      match: !!match?.(s, r),
      cells,
    };
  });
  return {
    sec,
    cols,
    heads: cols.map((e) => headMap.get(e)!),
    titles: printedYtd ? cols.map(ytdLong) : undefined,
    ytd,
    box: {
      rows: shown.filter((r) => r.kind !== "gap").length,
      gaps: shown.filter((r) => r.kind === "gap").length,
      heads: printedYtd ? 1 : 0,
    },
    rows: shown,
    tieOk,
    tieN,
    failing,
    flagged,
    held,
    hidden,
    lines,
  };
}

/** Mounts its section when it comes within about two screens; until then a block of about its height holds the place. */
function Lazy({
  eager,
  box,
  id,
  children,
}: {
  eager: boolean;
  /** the section's make-up: the placeholder is exactly its height (`sectionHeightCss`) */
  box: SectionBox;
  id: string;
  children: ReactNode;
}) {
  const [on, setOn] = useState(eager);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on || eager || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setOn(true), {
      rootMargin: MOUNT_MARGIN,
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on, eager]);
  useEffect(() => {
    const show = (e: Event) => (e as CustomEvent<string>).detail === id && setOn(true);
    window.addEventListener("ir-statement-show", show);
    return () => window.removeEventListener("ir-statement-show", show);
  }, [id]);
  return (
    <div
      ref={ref}
      data-statement-slot={id}
      className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+var(--ir-bar,0px))]"
    >
      {on || eager ? (
        children
      ) : (
        <div
          aria-hidden
          data-statement-hold
          style={{ "--hold": sectionHeightCss(box), height: "var(--hold)" } as CSSProperties}
        />
      )}
    </div>
  );
}

export interface StatementsSummary {
  tieOk: number;
  tieN: number;
  sections: number;
}

export function IrStatements({
  ticker,
  payload,
  focus,
  onFocusDone,
  onChecks,
  onSummary,
}: {
  ticker: string;
  payload: IrPayload;
  focus?: IrFocus;
  onFocusDone?: () => void;
  /** open the checks panel, for one section or all */
  onChecks: (secId?: string) => void;
  /** the tie-out count of what is in view, for the badge at the top of the tab */
  onSummary?: (s: StatementsSummary) => void;
}) {
  const gridRoot = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // One sideways position for the head row and every section (scroll-group.ts).
  const group = useMemo(() => scrollGroup(() => gridRoot.current), []);
  const [freq, setFreq] = useState<Freq>("q");
  const [span, setSpan] = useState(DEFAULT_SPAN.q);
  const [show, setShow] = useState<"cur" | "all">("cur");
  const [dim, setDim] = useState("all");
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  // Tables of older documents and lines only other copies print: collapsed, opened by the reader, a search or a jump.
  const [moreOpen, setMoreOpen] = useState(false);
  // Year-to-date sections the reader switched to quarters (by section id); printed columns otherwise.
  const [ytdMode, setYtdMode] = useState<Record<string, "printed" | "quarters">>({});
  const onYtd = useCallback(
    (id: string, v: "printed" | "quarters") => setYtdMode((m) => ({ ...m, [id]: v })),
    [],
  );
  const [scale] = useUnitScale();
  const { open } = useSource();
  const company = useCompany(ticker);
  const gate = useFeatureGate();

  const byKey = useMemo(() => new Map(payload.series.map((s) => [s.k, s])), [payload]);
  const checks = useMemo(() => {
    const m = new Map<string, PayloadCheck>();
    for (const c of payload.checks) m.set(`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c);
    return m;
  }, [payload]);
  const cov = coverageOf(ticker);
  const prof = company.data?.profile;
  const sectorText = cov?.sector ?? prof?.sector ?? "";
  const industryText = [cov?.industry ?? prof?.industry, prof?.sicDescription]
    .filter(Boolean)
    .join(" ");
  const sector = useMemo(() => sectorOf(sectorText, industryText), [sectorText, industryText]);
  const sections = useMemo(() => {
    const secs = assembleStatements(payload, { sector: sectorText, industry: industryText });
    const text = textSection(payload, secs);
    return text ? [...secs, text] : secs;
  }, [payload, sectorText, industryText]);
  const chips = useMemo(() => filterOptions(sections), [sections]);
  // A chip the company's tables no longer fill (another company, a rebuilt payload) falls back to all.
  useEffect(() => {
    if (dim !== "all" && !chips.some((c) => c.v === dim)) setDim("all");
  }, [chips, dim]);
  const absent = useMemo(
    () =>
      missingNote(missingStatements(sections, sector), missingHeadlines(payload, sections, sector)),
    [sections, sector, payload],
  );
  const grids = useMemo(() => periodGrids(payload), [payload]);
  const fy = useMemo(() => fiscalCalendar(payload), [payload]);
  const cut = useMemo(() => (show === "cur" ? currentCut(payload) : undefined), [payload, show]);
  const q = query.trim().toLowerCase();
  const all = grids[freq];

  const views = useMemo(() => {
    const out: SectionView[] = [];
    let hiddenSecs = 0;
    let hiddenLines = 0;
    for (const sec of sections) {
      const base = { freq, all, span, cut, dim, q, fy };
      let v = sectionView(payload, sec, byKey, checks, { ...base, ytd: ytdMode[sec.id] });
      // A year-to-date section offers its quarters beside its printed columns when both have figures; a
      // choice with nothing behind it falls back to the other.
      if (freq === "q" && isYtdSection(sec)) {
        const other = sectionView(payload, sec, byKey, checks, {
          ...base,
          ytd: v?.ytd === "quarters" ? "printed" : "quarters",
        });
        if (!v) v = other;
        else if (other) v = { ...v, ytdChoice: true };
      }
      if (v) {
        out.push(v);
        hiddenLines += v.hidden;
      } else if (cut && !q && dim === "all") {
        // A whole section hidden by "Current series" (it has lines, none current).
        const any = visibleRows(sec, byKey, { has: (s) => printsIn(s, all, freq) });
        if (any.rows.some((r) => r.kind === "line")) {
          hiddenSecs++;
          hiddenLines += any.rows.filter((r) => r.kind === "line").length;
        }
      }
    }
    return { out, hiddenSecs, hiddenLines };
  }, [sections, payload, byKey, checks, freq, all, span, cut, dim, q, fy, ytdMode]);

  const tieOk = views.out.reduce((n, v) => n + v.tieOk, 0);
  const tieN = views.out.reduce((n, v) => n + v.tieN, 0);
  useEffect(
    () => onSummary?.({ tieOk, tieN, sections: views.out.length }),
    [tieOk, tieN, views.out.length, onSummary],
  );

  const openCell = useCallback(
    (s: PayloadSeries, end: string, c: PayloadCell) =>
      void openIrCell(open, ticker, payload, s, end, freq, c),
    [open, ticker, payload, freq],
  );

  // Arriving from a workbook link: the section that prints the line, its period in view, the source open.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focus.freq === "m") return;
    const id = `${focus.line}|${focus.freq}|${focus.period}`;
    if (focused.current === id) return;
    focused.current = id;
    const s = byKey.get(focus.line) ?? byKey.get(payload.alias?.[focus.line] ?? "");
    const c = s && (focus.freq === "q" ? s.q : s.y)[focus.period];
    const sec =
      s && sections.find((x) => x.rows.some((r) => r.kind === "line" && r.ks.includes(s.k)));
    if (!s || !c) {
      toast.error("That number isn't in the current data", {
        description:
          "The line may have been renamed or re-read since the workbook was exported. Search for it below.",
      });
      onFocusDone?.();
      return;
    }
    setFreq(focus.freq);
    setShow("all");
    setSpan("all");
    setDim("all");
    setQuery("");
    openIrCell(open, ticker, payload, s, focus.period, focus.freq, c);
    if (sec) {
      if (sec.group === "more") setMoreOpen(true);
      jumpTo(sec.id);
    }
    onFocusDone?.();
  }, [focus, byKey, payload, sections, open, ticker, onFocusDone]);

  const downloadHistory = async () => {
    if (!gate("exports")) return;
    try {
      const { getIrHistoryDownload } = await import("@/lib/ir.functions");
      const url = await getIrHistoryDownload({ data: { ticker } });
      window.location.assign(url);
    } catch {
      toast.error("Could not download the history. Please try again.");
    }
  };

  const changeFreq = (f: Freq) => {
    setFreq(f);
    setSpan(DEFAULT_SPAN[f]);
  };

  const groupOf = (v: SectionView | Statement): PayloadGroup => {
    const sec = "sec" in v ? v.sec : v;
    return {
      id: sec.id,
      cat: sec.cat,
      met: "other",
      unit: "usd",
      label: sec.title,
      bd: null,
      root: null,
      rows: sec.rows.flatMap((r) => (r.kind === "line" ? [{ k: r.k, depth: r.depth }] : [])),
    };
  };
  const runExport = async (what: "view" | "all" | Statement) => {
    if (!gate("exports") || exporting) return;
    const key = typeof what === "string" ? what : what.id;
    setExporting(key);
    const toastId = toast.loading(
      what === "all" ? "Building the complete workbook…" : "Building the Excel workbook…",
    );
    try {
      const cov = coverageOf(ticker);
      const range = (cols: string[], f: Freq) =>
        cols.length ? `${periodLong(cols[0], f)} to ${periodLong(cols[cols.length - 1], f)}` : "";
      const viewOf =
        typeof what === "string" ? undefined : views.out.find((v) => v.sec.id === what.id);
      const opts =
        what === "all"
          ? {
              groups: sections.map(groupOf),
              freqs: ["q", "y"] as Freq[],
              cols: undefined,
              scope: `Complete history: all ${sections.length} sections, quarterly and annual`,
            }
          : what === "view"
            ? {
                groups: views.out.map(groupOf),
                freqs: [freq],
                cols: { [freq]: all.filter((e) => views.out.some((v) => v.cols.includes(e))) },
                scope: `${views.out.length} sections in view · ${FREQ_FILE[freq]}${q ? ` · lines matching “${query.trim()}”` : ""}`,
              }
            : {
                groups: [groupOf(what)],
                freqs: [freq],
                cols: { [freq]: viewOf?.cols ?? all },
                scope: `One section: ${what.title} · ${range(viewOf?.cols ?? [], freq)}`,
              };
      const [{ exportIrWorkbook }, logo] = await Promise.all([
        import("@/lib/export/ir-export-browser"),
        fetchLogo(wordmark.url),
      ]);
      const { blob, stats } = await exportIrWorkbook({
        ticker,
        company: cov?.shortName ?? company.data?.profile.name,
        cik: company.data?.profile.cik ?? cov?.cik ?? null,
        payload,
        scale,
        origin: window.location.origin,
        logo,
        ...opts,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const name =
        what === "all"
          ? `${ticker}-ir-statements-complete-${stamp}.xlsx`
          : what === "view"
            ? `${ticker}-ir-statements-${FREQ_FILE[freq]}-${stamp}.xlsx`
            : `${ticker}-${slug(what.title)}-${FREQ_FILE[freq]}.xlsx`;
      downloadBlob(blob, name);
      toast.success("Excel workbook downloaded", {
        id: toastId,
        description: `${stats.breakdowns.toLocaleString()} section${stats.breakdowns === 1 ? "" : "s"} · ${stats.values.toLocaleString()} values · ${(blob.size / 1e6).toFixed(1)} MB`,
        action: { label: "Save again", onClick: () => downloadBlob(blob, name) },
        duration: 8000,
      });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't build the workbook", {
        id: toastId,
        description: (e as Error).message,
      });
    } finally {
      setExporting(null);
    }
  };
  const exportRef = useRef(runExport);
  exportRef.current = runExport;
  const onExcel = useCallback((sec: Statement) => void exportRef.current(sec), []);
  const onCsv = useCallback(
    (sec: Statement, cols: string[]) => {
      if (!gate("exports")) return;
      const esc = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
      // A year-to-date section's printed columns ("9:2026-09-30") export under their length and end.
      const ytd = cols.length > 0 && cols.every((c) => parseYtdKey(c));
      const out = [
        [
          "Line",
          "Unit",
          ...cols.map((c) =>
            ytd ? esc(ytdLong(c)) : freq === "y" ? `Year ending ${c}` : `Quarter ending ${c}`,
          ),
        ].join(","),
      ];
      for (const r of sec.rows) {
        if (r.kind === "head") out.push(esc(r.text));
        if (r.kind !== "line") continue;
        const s = byKey.get(r.k);
        if (!s) continue;
        const m = ytd ? ytdRowCells(r.ks, byKey) : rowCells(r.ks, byKey, freq, r.at);
        out.push(
          [
            esc(`${"  ".repeat(r.depth)}${rowLabel(r, byKey)}`),
            s.unit,
            ...cols.map((c) => (m.cells[c] ? String(m.cells[c].v) : "")),
          ].join(","),
        );
      }
      downloadBlob(
        new Blob([out.join("\n")], { type: "text/csv;charset=utf-8" }),
        `${ticker}-${slug(sec.title)}-${ytd ? "year-to-date" : FREQ_FILE[freq]}.csv`,
      );
    },
    [byKey, freq, gate, ticker],
  );

  const lines = views.out.reduce((n, v) => n + v.rows.filter((r) => r.kind === "line").length, 0);
  // The grid's columns: the period chips over the tab's period grid, the same for every section.
  const gridCols = useMemo(() => (span === "all" ? all : all.slice(-Number(span))), [all, span]);
  const gridHeads = useMemo(() => uniqueHeads(gridCols, freq, fy), [gridCols, freq, fy]);
  // One column width for the whole tab: the grid's own, wider only when the tab's widest figure needs it.
  const widest = useMemo(() => {
    let w = 0;
    for (const v of views.out)
      for (const r of v.rows)
        if (r.kind === "line")
          for (const x of r.cells) {
            if (!x) continue;
            const [fig] = splitMark(x.text, r.mark);
            w = Math.max(w, fig.replace(/\)$/, "").length);
          }
    return w;
  }, [views.out]);
  // Whole period columns only, the label column taking the slack (grid-fit.ts).
  useGridFit(gridRoot, gridCols.length, widest);
  // A period chip or the period type opens the grid at its newest columns again.
  useLayoutEffect(() => {
    const h = headRef.current;
    return h ? group.add(h) : undefined;
  }, [group]);
  useLayoutEffect(() => group.reset(), [group, freq, span, gridCols.length]);
  const front = views.out.filter((v) => v.sec.group !== "more");
  const more = views.out.filter((v) => v.sec.group === "more");
  // A search shows its matches wherever they are.
  const moreShown = moreOpen || !!q;
  const jump = (id: string) => {
    if (more.some((v) => v.sec.id === id)) setMoreOpen(true);
    jumpTo(id);
  };
  const slot = (v: SectionView, i: number) => (
    <Lazy key={v.sec.id} id={v.sec.id} eager={i < EAGER} box={v.box}>
      <StatementSection
        view={v}
        ticker={ticker}
        payload={payload}
        freq={freq as IrPeriodKind}
        scale={scale}
        exporting={exporting === v.sec.id}
        onExcel={onExcel}
        onCsv={onCsv}
        onChecks={onChecks}
        openCell={openCell}
        onYtd={onYtd}
      />
    </Lazy>
  );

  return (
    <IrPanel
      section="IR statements"
      tour="ir-breakdowns"
      title="Statements"
      subtitle="Figures open the cell in the company’s original filing or supplement."
      actions={
        <>
          <Segmented
            label="Series shown"
            value={show}
            onChange={setShow}
            options={[
              {
                v: "cur",
                l: "Current series",
                title:
                  "Hides lines and tables the company no longer prints (nothing in the latest fifteen months), such as old segment structures. Their history stays under All series.",
              },
              { v: "all", l: "All series" },
            ]}
          />
          <Segmented
            label="Period type"
            value={freq}
            onChange={changeFreq}
            options={[
              { v: "q", l: "Quarterly" },
              { v: "y", l: "Annual" },
            ]}
          />
          <Segmented label="Periods shown" value={span} onChange={setSpan} options={SPANS[freq]} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-busy={exporting === "view" || exporting === "all"}
              >
                {exporting === "view" || exporting === "all" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileSpreadsheet />
                )}
                {exporting === "view" || exporting === "all" ? "Building…" : "Excel"}
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Styled workbook with live formulas, tie-out checks and a source link for every
                number
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!!exporting || !views.out.length}
                onSelect={() => runExport("view")}
                className="items-start gap-2.5 py-2"
              >
                <FileSpreadsheet className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Sections in view</span>
                  <span className="block text-xs text-muted-foreground">
                    {views.out.length} section{views.out.length === 1 ? "" : "s"} ·{" "}
                    {FREQ_FILE[freq]}
                    {dim !== "all" || q ? " · current filters" : ""}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!!exporting}
                onSelect={() => runExport("all")}
                className="items-start gap-2.5 py-2"
              >
                <ChevronsDown className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{payload.preview ? "All sections in this view" : "Complete history"}</span>
                  <span className="block text-xs text-muted-foreground">
                    All {sections.length} sections, quarterly and annual
                  </span>
                </span>
              </DropdownMenuItem>
              {payload.preview && (
                <DropdownMenuItem onSelect={() => void downloadHistory()}>
                  <ChevronsDown /> Download historical dataset (JSON)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <ScrollGroupContext.Provider value={group}>
        <div
          ref={gridRoot}
          data-statements-grid
          className="irg"
          style={{ "--col": gridColWidth(widest) } as CSSProperties}
        >
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5",
              IR.caption,
            )}
          >
            {payload.preview && (
              <span>{payload.preview.basis === "latest-filing" ? "Latest financial supplement" : "Recent statements"} · {payload.preview.basis === "latest-filing" ? payload.docs[0]?.filed : payload.quarters.at(-1)}</span>
            )}
            <span className="num">
              {front.length.toLocaleString()} section{front.length === 1 ? "" : "s"}
              {more.length ? ` and ${more.length.toLocaleString()} more` : ""} ·{" "}
              {lines.toLocaleString()} lines
            </span>
            {tieN > 0 && (
              <button
                type="button"
                onClick={() => onChecks()}
                className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tieOk === tieN ? (
                  <Check aria-hidden className="size-3 text-positive" />
                ) : (
                  <CheckDot />
                )}
                <span className="num">
                  {tieOk.toLocaleString()} of {tieN.toLocaleString()}
                </span>
                period totals in view tie out
              </button>
            )}
            {show === "cur" && views.hiddenLines > 0 && (
              <span>
                {views.hiddenLines.toLocaleString()} discontinued or older-basis line
                {views.hiddenLines === 1 ? "" : "s"}
                {views.hiddenSecs
                  ? ` (${views.hiddenSecs} whole section${views.hiddenSecs === 1 ? "" : "s"})`
                  : ""}{" "}
                hidden.{" "}
                <button
                  type="button"
                  onClick={() => setShow("all")}
                  className="rounded-sm text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Show all series
                </button>
              </span>
            )}
            <Tooltip>
              <TooltipTrigger className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                <Info className="size-3.5" /> How to read
              </TooltipTrigger>
              <TooltipContent align="end" className="max-w-sm space-y-1.5 text-xs">
                <p>
                  Each section is one table as the company's newest document prints it, with the
                  same table of earlier documents joined on, so its lines run over every period
                  stored. Figures are in the scale the table prints, stated under its title;
                  parentheses are negatives.
                </p>
                <p>
                  Rows, their names, indents and bold totals are read from the document's own
                  tables, figure by figure, so every printed figure opens the cell it came from.
                </p>
                <p>
                  A small tick marks a total whose printed parts add up to it. An amber dot marks a
                  figure that fails a check, a hollow ring one held back or printed differently
                  elsewhere; the checks panel lists them with the numbers.
                </p>
                <p>
                  Values with a dotted underline are calculated (
                  {freq === "q"
                    ? "fourth quarter = full year less the first three quarters"
                    : "full year = four quarters"}
                  ); hover one for the formula.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          {absent && (
            <p data-statements-absent className={cn("border-b px-4 py-1.5", IR.caption)}>
              {absent}
            </p>
          )}
          {/* One sticky layer of a constant height: the controls, then the grid's one column head row,
          which scrolls sideways with every section. */}
          <div
            data-statements-sticky
            className="irg-sticky sticky top-[var(--sticky-top,3.5rem)] z-30"
          >
            <div
              data-agent-controls
              data-statements-bar
              className="irg-bar flex items-center gap-2 border-b bg-card px-4 max-sm:flex-col max-sm:items-stretch max-sm:justify-center max-sm:gap-1"
            >
              {/* One line on a phone too (it scrolls sideways): the bar keeps its fixed height. */}
              <div className="no-scrollbar flex h-10 min-w-0 flex-1 items-center overflow-x-auto sm:h-8">
                <Segmented
                  label="Line type"
                  size="xs"
                  className="irt-hits max-w-none flex-nowrap"
                  value={dim}
                  onChange={setDim}
                  options={chips.map((d) => ({
                    v: d.v,
                    l: d.l,
                    title: d.v === "all" ? undefined : `${d.n} table${d.n === 1 ? "" : "s"}`,
                  }))}
                />
              </div>
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <Select value="" onValueChange={jump}>
                  <SelectTrigger
                    className="h-10 w-full text-xs sm:h-8 sm:w-56"
                    aria-label="Go to a section"
                  >
                    <SelectValue placeholder="Go to a section" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {jumpGroups(
                      front.map((v) => v.sec),
                      sector,
                    ).map((g) => (
                      <SelectGroup key={g.kind}>
                        <SelectLabel className="text-[11px]">{g.label}</SelectLabel>
                        {g.sections.map((sec) => (
                          <SelectItem key={sec.id} value={sec.id} className="text-xs">
                            {sec.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                    {more.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[11px]">More tables</SelectLabel>
                        {more.map((v) => (
                          <SelectItem key={v.sec.id} value={v.sec.id} className="text-xs">
                            {v.sec.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a line or statement"
                    className="h-10 pl-7 text-xs sm:h-8"
                    aria-label="Find a line"
                  />
                </div>
              </div>
            </div>
            <div
              ref={headRef}
              data-head-strip
              onScroll={(e) => group.follow(e.currentTarget)}
              className="irg-headstrip scrollbar-thin overflow-x-auto overflow-y-hidden"
            >
              <table
                aria-hidden
                className="irg-table irg-head"
                style={{ width: gridWidth(gridCols.length) }}
              >
                <GridCols n={gridCols.length} />
                <thead>
                  <tr>
                    <th className="irg-fc irg-hlabel">{FREQ_HEAD[freq]}</th>
                    <HeadCells
                      heads={gridCols.map((e) => gridHeads.get(e)!)}
                      titles={gridCols.map((e) => periodLong(e, freq))}
                    />
                  </tr>
                </thead>
              </table>
            </div>
          </div>
          {!views.out.length ? (
            <p className="p-4 text-[13px] text-muted-foreground">
              {q ? `No lines match “${query}”.` : "Nothing in this view for the selected periods."}
            </p>
          ) : (
            <div className="grid grid-cols-1 pb-4">
              {front.map((v, i) => (
                <Fragment key={v.sec.id}>
                  {v.sec.group === "other" && front[i - 1]?.sec.group !== "other" && (
                    <p
                      data-statement-group="other"
                      className={cn("border-t bg-secondary/40 px-4 py-1.5", IR.caption)}
                    >
                      Tables only other documents of this release print
                    </p>
                  )}
                  {slot(v, i)}
                </Fragment>
              ))}
              {more.length > 0 && (
                <div
                  data-statement-group="more"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5"
                >
                  <button
                    type="button"
                    aria-expanded={moreShown}
                    onClick={() => setMoreOpen((o) => !o)}
                    disabled={!!q}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors sm:h-7 duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                        moreShown && "rotate-180",
                      )}
                    />
                    {moreShown ? "Hide" : "Show"} {more.length.toLocaleString()} more table
                    {more.length === 1 ? "" : "s"}
                  </button>
                  <span className={IR.caption}>
                    Tables of older documents and lines only other copies of a table print
                  </span>
                </div>
              )}
              {moreShown && more.map((v, i) => slot(v, front.length + i))}
            </div>
          )}
        </div>
      </ScrollGroupContext.Provider>
    </IrPanel>
  );
}

/** Scrolls a section into view, mounting it first when it has not come on screen yet. */
function jumpTo(id: string) {
  window.dispatchEvent(new CustomEvent("ir-statement-show", { detail: id }));
  setTimeout(
    () =>
      document
        .querySelector(`[data-statement-slot="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    60,
  );
}
