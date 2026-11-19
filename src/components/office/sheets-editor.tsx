import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  AlignCenter, AlignLeft, AlignRight, AreaChart as AreaIcon, ArrowDownAZ, ArrowDownZA, BarChart3, Bold, Grid3x3, Italic,
  LineChart as LineIcon, PieChart as PieIcon, Redo2, Sigma, Trash2, Underline, Undo2, X,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { B, Group } from "@/components/office/writer-editor";
import { coverageOf } from "@/lib/coverage";
import { companyQuery, useQuotes } from "@/lib/data";
import { lookup } from "@/lib/financials/lookup";
import type { CompanyDataset } from "@/lib/financials/types";
import { colName, FormulaError, formatValue, parseRef, referencedSymbols, refOf, Sheet, type CellFormat, type Scalar } from "@/lib/sheet/formula";
import {
  chartData, clearRange, eachRef, fillRange, parseRange, rangeOf, shiftRows, sortRange, styleRange,
  type Rect, type SheetChart, type SheetData, type Workbook,
} from "@/lib/office/workbook";
import { inkOnFill } from "@/lib/office/cell-ink";
import { cn } from "@/lib/utils";

const RH = 22, HW = 44, DW = 96;
const FORMATS: { id: CellFormat; l: string }[] = [
  { id: "general", l: "General" }, { id: "number", l: "Number" }, { id: "usd", l: "Currency" }, { id: "usdM", l: "$ Millions" }, { id: "pct", l: "Percent" }, { id: "x", l: "Multiple (×)" },
];
const TABS = ["Home", "Insert", "Formulas", "Data", "View"] as const;
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Workbook state + formula engines (FU/PRICE data prefetched across all sheets). */
export function useWorkbook(initial: Workbook, onChange: () => void) {
  const wb = useRef<Workbook>(initial);
  const hist = useRef<{ past: string[]; future: string[] }>({ past: [JSON.stringify(initial)], future: [] });
  const [ver, setVer] = useState(0);
  const changed = useRef(onChange); changed.current = onChange;
  const commit = useCallback(() => {
    const snap = JSON.stringify(wb.current);
    const h = hist.current;
    if (h.past[h.past.length - 1] !== snap) { h.past.push(snap); if (h.past.length > 60) h.past.shift(); h.future = []; }
    setVer((v) => v + 1); changed.current();
  }, []);
  const undo = useCallback((redo = false) => {
    const h = hist.current;
    if (redo) { const n = h.future.pop(); if (!n) return; h.past.push(n); wb.current = JSON.parse(n); }
    else { if (h.past.length < 2) return; h.future.push(h.past.pop()!); wb.current = JSON.parse(h.past[h.past.length - 1]); }
    setVer((v) => v + 1); changed.current();
  }, []);

  const allCells = useMemo(() => Object.assign({}, ...wb.current.sheets.map((s) => s.cells)) as Record<string, string>, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const syms = useMemo(() => {
    const fu = new Set<string>(), price = new Set<string>();
    for (const s of wb.current.sheets) { const r = referencedSymbols(s.cells); r.fu.forEach((x) => fu.add(x)); r.price.forEach((x) => price.add(x)); }
    return { fu: [...fu].filter((t) => coverageOf(t)), price: [...price] };
  }, [allCells]);
  const ds = useQueries({ queries: syms.fu.map((t) => companyQuery(t)) });
  const dsKey = ds.map((d) => d.dataUpdatedAt).join();
  const dsMap = useMemo(() => { const m = new Map<string, CompanyDataset>(); ds.forEach((q, i) => q.data && m.set(syms.fu[i], q.data)); return m; }, [dsKey, syms.fu.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const quotes = useQuotes(syms.price);
  const qMap = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q.price])), [quotes.data]);
  const engines = useMemo(() => wb.current.sheets.map((s) => new Sheet({
    get: (ref) => s.cells[ref],
    fu: (t, m, p) => {
      const tk = t.toUpperCase();
      if (!coverageOf(tk)) return new FormulaError("#N/A", `${tk} not covered`);
      const d = dsMap.get(tk);
      if (!d) return new FormulaError("#LOADING");
      const r = lookup(d, m, p);
      return "error" in r ? new FormulaError("#N/A", r.error) : r.value;
    },
    price: (sym) => qMap.get(sym.toUpperCase()) ?? new FormulaError(quotes.isLoading ? "#LOADING" : "#N/A"),
  })), [ver, dsMap, qMap, quotes.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const enginesRef = useRef(engines); enginesRef.current = engines;
  const value = useCallback((si: number, ref: string): Scalar => enginesRef.current[si]?.value(ref) ?? null, []);
  return { wb, ver, commit, undo, value, engines };
}
export type WorkbookApi = ReturnType<typeof useWorkbook>;

export function SheetsEditor({ api }: { api: WorkbookApi }) {
  const { wb, commit, undo, engines } = api;
  const si = wb.current.active;
  const sh = wb.current.sheets[si];
  const eng = engines[si];
  const [tab, setTab] = useState<(typeof TABS)[number]>("Home");
  const [sel, setSel] = useState({ c: 0, r: 0 });
  const [anchor, setAnchor] = useState<{ c: number; r: number } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const rect: Rect = anchor
    ? { c0: Math.min(anchor.c, sel.c), c1: Math.max(anchor.c, sel.c), r0: Math.min(anchor.r, sel.r), r1: Math.max(anchor.r, sel.r) }
    : { c0: sel.c, c1: sel.c, r0: sel.r, r1: sel.r };
  const cur = refOf(sel.c, sel.r);
  const width = (c: number) => sh.widths[c] ?? DW;
  const left = useMemo(() => { const o = [HW]; for (let c = 0; c < sh.cols; c++) o.push(o[c] + (sh.widths[c] ?? DW)); return o; }, [sh.cols, sh.widths, api.ver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel({ c: 0, r: 0 }); setAnchor(null); setEdit(null); }, [si]);

  const mutate = (f: (s: SheetData) => void) => { f(sh); commit(); };
  const style = (p: Parameters<typeof styleRange>[2], fmt?: CellFormat) => mutate((s) => styleRange(s, rect, p, fmt));
  const st0 = sh.style[cur] ?? {};
  const commitEdit = (v: string | null, move?: [number, number]) => {
    if (v !== null) mutate((s) => { if (v === "") delete s.cells[cur]; else s.cells[cur] = v; });
    setEdit(null);
    if (move) go(sel.c + move[0], sel.r + move[1]);
    grid.current?.focus();
  };
  const go = (c: number, r: number, extend = false) => {
    if (extend) { if (!anchor) setAnchor(sel); } else setAnchor(null);
    setSel({ c: Math.max(0, Math.min(sh.cols - 1, c)), r: Math.max(0, Math.min(sh.rows - 1, r)) });
  };
  const sort = (desc: boolean) => {
    const r = rect.r0 === rect.r1 ? { ...rect, r0: 0, r1: Math.max(...Object.keys(sh.cells).map((k) => parseRef(k)?.r ?? 0)) } : rect;
    mutate((s) => sortRange(s, { ...r, c0: Math.min(r.c0, rect.c0), c1: Math.max(r.c1, rect.c1) }, sel.c, desc, r.r0 === 0 && typeof eng.value(refOf(sel.c, 0)) === "string", (ref) => eng.value(ref)));
  };
  const chart = (type: SheetChart["type"]) => {
    if (rect.c1 === rect.c0) return;
    const labels = rangeOf({ ...rect, c1: rect.c0 });
    const series: string[] = []; for (let c = rect.c0 + 1; c <= rect.c1; c++) series.push(rangeOf({ ...rect, c0: c, c1: c }));
    mutate((s) => s.charts.push({ id: `c${Date.now().toString(36).slice(-5)}`, type, title: String(eng.value(refOf(rect.c0, Math.max(0, rect.r0 - 1))) ?? "Chart") || "Chart", labels, series, at: refOf(rect.c1 + 2, rect.r0) }));
  };
  const autosum = () => {
    const c = sel.c; let r = sel.r - 1; while (r >= 0 && typeof eng.value(refOf(c, r)) === "number") r--;
    if (r === sel.r - 1) return setEdit("=SUM()");
    commitEdit(`=SUM(${refOf(c, r + 1)}:${refOf(c, sel.r - 1)})`);
  };

  function onKey(e: KeyboardEvent) {
    if (edit !== null) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); undo(true); return; }
    if (mod && k.toLowerCase() === "b") { e.preventDefault(); style({ b: !st0.b }); return; }
    if (mod && k.toLowerCase() === "i") { e.preventDefault(); style({ i: !st0.i }); return; }
    if (mod && k.toLowerCase() === "u") { e.preventDefault(); style({ u: !st0.u }); return; }
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); mutate((s) => fillRange(s, rect, "down")); return; }
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Enter: [0, 1], Tab: [1, 0] };
    if (moves[k]) { e.preventDefault(); const [dc, dr] = moves[k]; go(sel.c + (e.shiftKey && k === "Tab" ? -1 : dc), sel.r + (e.shiftKey && k === "Enter" ? -1 : dr), e.shiftKey && k.startsWith("Arrow")); return; }
    if (k === "F2") { e.preventDefault(); setEdit(sh.cells[cur] ?? ""); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); mutate((s) => clearRange(s, rect, "contents")); return; }
    if (k.length === 1 && !mod) { e.preventDefault(); setEdit(k); }
  }
  function onCopy(e: React.ClipboardEvent) {
    if (edit !== null) return;
    const rows: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) { const o: string[] = []; for (let c = rect.c0; c <= rect.c1; c++) o.push(formatValue(eng.value(refOf(c, r)), sh.fmt[refOf(c, r)])); rows.push(o.join("\t")); }
    e.clipboardData.setData("text/plain", rows.join("\n")); e.preventDefault();
  }
  function onPaste(e: React.ClipboardEvent) {
    if (edit !== null) return;
    const t = e.clipboardData.getData("text/plain"); if (!t) return;
    e.preventDefault();
    mutate((s) => t.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, ri) => line.split("\t").forEach((v, ci) => {
      const ref = refOf(sel.c + ci, sel.r + ri); if (v === "") delete s.cells[ref]; else s.cells[ref] = v;
    })));
  }

  const ic = "h-3.5 w-3.5";
  const selFmt = sh.fmt[cur] ?? "general";
  const inRect = (c: number, r: number) => c >= rect.c0 && c <= rect.c1 && r >= rect.r0 && r <= rect.r1;
  const val = eng.value(cur);
  const err = val instanceof FormulaError ? val.detail : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ribbon */}
      <div className="border-b bg-card" data-section="Sheets ribbon">
        <div className="flex h-7 items-end gap-0.5 px-2">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}
              className={cn("h-6 px-3 text-[11px]", tab === t ? "border-b-2 border-office font-semibold text-office" : "text-foreground/70 hover:text-foreground")}>{t}</button>
          ))}
        </div>
        <div className="flex h-[68px] items-stretch overflow-x-auto border-t bg-background/60 py-1">
          {tab === "Home" && (<>
            <Group name="Undo"><B title="Undo" on={() => undo()}><Undo2 className={ic} /></B><B title="Redo" on={() => undo(true)}><Redo2 className={ic} /></B></Group>
            <Group name="Font">
              <B title="Bold" active={st0.b} on={() => style({ b: !st0.b })}><Bold className={ic} /></B>
              <B title="Italic" active={st0.i} on={() => style({ i: !st0.i })}><Italic className={ic} /></B>
              <B title="Underline" active={st0.u} on={() => style({ u: !st0.u })}><Underline className={ic} /></B>
              <B title="Borders" active={st0.border} on={() => style({ border: !st0.border })}><Grid3x3 className={ic} /></B>
              <Swatch title="Fill colour" value={st0.fill} onPick={(v) => style({ fill: v })} label="Fill" />
              <Swatch title="Font colour" value={st0.color} onPick={(v) => style({ color: v })} label="A" />
            </Group>
            <Group name="Alignment">
              <B title="Align left" active={st0.align === "left"} on={() => style({ align: "left" })}><AlignLeft className={ic} /></B>
              <B title="Center" active={st0.align === "center"} on={() => style({ align: "center" })}><AlignCenter className={ic} /></B>
              <B title="Align right" active={st0.align === "right"} on={() => style({ align: "right" })}><AlignRight className={ic} /></B>
            </Group>
            <Group name="Number">
              <select aria-label="Number format" value={selFmt} onChange={(e) => style({}, e.target.value as CellFormat)}
                className="h-6 rounded-sm border bg-background px-1 text-[11px]">
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.l}</option>)}
              </select>
              <B title="Percent" on={() => style({}, "pct")} label="%" >{null}</B>
              <B title="$ Millions" on={() => style({}, "usdM")} label="$M">{null}</B>
            </Group>
            <Group name="Cells">
              <B title="Insert row above" on={() => mutate((s) => shiftRows(s, sel.r, 1))} label="Insert row">{null}</B>
              <B title="Delete row" on={() => mutate((s) => shiftRows(s, rect.r0, -(rect.r1 - rect.r0 + 1)))} label="Delete row">{null}</B>
            </Group>
            <Group name="Editing">
              <B title="AutoSum" on={autosum} label="AutoSum"><Sigma className={ic} /></B>
              <B title="Fill down (Ctrl+D)" on={() => mutate((s) => fillRange(s, rect, "down"))} label="Fill">{null}</B>
              <B title="Clear" on={() => mutate((s) => clearRange(s, rect))} label="Clear"><Trash2 className={ic} /></B>
            </Group>
          </>)}
          {tab === "Insert" && (
            <Group name="Charts (select labels + values)">
              <B title="Column chart" on={() => chart("bar")} label="Column"><BarChart3 className={ic} /></B>
              <B title="Line chart" on={() => chart("line")} label="Line"><LineIcon className={ic} /></B>
              <B title="Area chart" on={() => chart("area")} label="Area"><AreaIcon className={ic} /></B>
              <B title="Pie chart" on={() => chart("pie")} label="Pie"><PieIcon className={ic} /></B>
            </Group>
          )}
          {tab === "Formulas" && (<>
            <Group name="Function library">
              <B title="AutoSum" on={autosum} label="AutoSum"><Sigma className={ic} /></B>
              {["AVERAGE", "MIN", "MAX", "COUNT", "IF", "ROUND"].map((f) => <B key={f} title={f} on={() => setEdit(`=${f}(`)} label={f}>{null}</B>)}
            </Group>
            <Group name="FiledUnder data">
              <B title="SEC-sourced value" on={() => setEdit('=FU("AAPL","revenue","FY2025")')} label="FU()">{null}</B>
              <B title="Live price" on={() => setEdit('=PRICE("AAPL")')} label="PRICE()">{null}</B>
            </Group>
          </>)}
          {tab === "Data" && (
            <Group name="Sort & fill">
              <B title="Sort A to Z by this column" on={() => sort(false)} label="Sort A→Z"><ArrowDownAZ className={ic} /></B>
              <B title="Sort Z to A by this column" on={() => sort(true)} label="Sort Z→A"><ArrowDownZA className={ic} /></B>
              <B title="Fill right" on={() => mutate((s) => fillRange(s, rect, "right"))} label="Fill right">{null}</B>
            </Group>
          )}
          {tab === "View" && (<>
            <Group name="Freeze panes">
              <B title="Freeze panes at selection" on={() => mutate((s) => { s.freeze = { r: sel.r, c: sel.c }; })} label="Freeze panes">{null}</B>
              <B title="Freeze top row" on={() => mutate((s) => { s.freeze = { r: 1, c: 0 }; })} label="Top row">{null}</B>
              <B title="Freeze first column" on={() => mutate((s) => { s.freeze = { r: 0, c: 1 }; })} label="First column">{null}</B>
              <B title="Unfreeze" on={() => mutate((s) => { s.freeze = { r: 0, c: 0 }; })} label="Unfreeze">{null}</B>
            </Group>
            <Group name="Column width">
              <B title="Narrower" on={() => mutate((s) => { for (let c = rect.c0; c <= rect.c1; c++) s.widths[c] = Math.max(40, width(c) - 16); })} label="−">{null}</B>
              <B title="Wider" on={() => mutate((s) => { for (let c = rect.c0; c <= rect.c1; c++) s.widths[c] = Math.min(400, width(c) + 16); })} label="+">{null}</B>
            </Group>
          </>)}
        </div>
      </div>
      {/* formula bar */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b bg-card px-1 text-[11px]">
        <div className="w-20 rounded-sm border bg-background px-1.5 py-0.5 font-mono">{rangeOf(rect)}</div>
        <span className="px-1 italic text-muted-foreground">fx</span>
        <input aria-label="Formula bar" className="h-5 min-w-0 flex-1 rounded-sm border bg-background px-1.5 font-mono outline-none focus:border-office"
          value={edit ?? sh.cells[cur] ?? ""} onFocus={() => edit === null && setEdit(sh.cells[cur] ?? "")}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(edit, [0, 1]); if (e.key === "Escape") commitEdit(null); }} />
        {err && <span className="max-w-64 truncate text-destructive" title={err}>{err}</span>}
      </div>
      {/* grid */}
      <div ref={grid} tabIndex={0} onKeyDown={onKey} onCopy={onCopy} onPaste={onPaste} onMouseUp={() => setDrag(false)}
        className="relative min-h-0 flex-1 overflow-auto bg-background outline-none" data-section="Spreadsheet grid">
        <div className="relative" style={{ width: left[sh.cols], height: RH * (sh.rows + 1) }}>
          <table className="border-separate border-spacing-0 text-[11px]" style={{ tableLayout: "fixed", width: left[sh.cols] }}>
            <colgroup><col style={{ width: HW }} />{Array.from({ length: sh.cols }, (_, c) => <col key={c} style={{ width: width(c) }} />)}</colgroup>
            <thead>
              <tr style={{ height: RH }}>
                <th className="sticky left-0 top-0 z-30 border-b border-r bg-muted" />
                {Array.from({ length: sh.cols }, (_, c) => (
                  <th key={c} onMouseDown={() => { setAnchor({ c, r: 0 }); setSel({ c, r: sh.rows - 1 }); }}
                    className={cn("sticky top-0 z-20 cursor-default select-none border-b border-r bg-muted font-normal text-muted-foreground", c >= rect.c0 && c <= rect.c1 && "bg-office-soft font-semibold text-office")}
                    style={c < sh.freeze.c ? { left: left[c], zIndex: 25 } : undefined}>{colName(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: sh.rows }, (_, r) => (
                <tr key={r} style={{ height: RH }}>
                  <td onMouseDown={() => { setAnchor({ c: 0, r }); setSel({ c: sh.cols - 1, r }); }}
                    className={cn("sticky left-0 z-10 select-none border-b border-r bg-muted text-center text-muted-foreground", r >= rect.r0 && r <= rect.r1 && "bg-office-soft font-semibold text-office")}
                    style={r < sh.freeze.r ? { top: RH * (r + 1), zIndex: 15 } : undefined}>{r + 1}</td>
                  {Array.from({ length: sh.cols }, (_, c) => {
                    const ref = refOf(c, r);
                    const raw = sh.cells[ref];
                    const isCur = c === sel.c && r === sel.r;
                    const s = sh.style[ref];
                    const frozenR = r < sh.freeze.r, frozenC = c < sh.freeze.c;
                    let content: ReactNode = null, num = false;
                    if (isCur && edit !== null) {
                      content = <input autoFocus aria-label={`Edit ${ref}`} value={edit} onChange={(e) => setEdit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitEdit(edit, [0, e.shiftKey ? -1 : 1]); }
                          else if (e.key === "Tab") { e.preventDefault(); commitEdit(edit, [e.shiftKey ? -1 : 1, 0]); }
                          else if (e.key === "Escape") commitEdit(null);
                        }} onBlur={() => edit !== null && commitEdit(edit)}
                        className="absolute inset-0 z-10 h-full w-full border-2 border-office bg-background px-1 font-mono text-[11px] outline-none" />;
                    } else if (raw != null) {
                      const v = eng.value(ref);
                      num = typeof v === "number";
                      content = <span className={cn("block truncate px-1", v instanceof FormulaError && "text-destructive")}>{formatValue(v, sh.fmt[ref])}</span>;
                    }
                    return (
                      <td key={c}
                        onMouseDown={(e) => { if (e.button) return; if (e.shiftKey) { if (!anchor) setAnchor(sel); } else setAnchor({ c, r }); setSel({ c, r }); setDrag(true); if (edit !== null) commitEdit(edit); }}
                        onMouseEnter={() => drag && setSel({ c, r })}
                        onDoubleClick={() => setEdit(raw ?? "")}
                        className={cn("relative border-b border-r border-border/60 bg-background",
                          (frozenR || frozenC) && "sticky z-[5]", frozenR && "border-b-foreground/30", frozenC && c === sh.freeze.c - 1 && "border-r-foreground/30",
                          inRect(c, r) && !isCur && "bg-office-soft", isCur && "outline outline-2 -outline-offset-1 outline-office",
                          s?.border && "border-foreground/40")}
                        style={{
                          top: frozenR ? RH * (r + 1) : undefined, left: frozenC ? left[c] : undefined,
                          background: s?.fill && !inRect(c, r) ? s.fill : undefined, color: s?.color ?? (s?.fill && !inRect(c, r) ? inkOnFill(s.fill) : undefined),
                          fontWeight: s?.b ? 600 : undefined, fontStyle: s?.i ? "italic" : undefined, textDecoration: s?.u ? "underline" : undefined,
                          textAlign: s?.align ?? (num ? "right" : "left"),
                        }}>{content}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {sh.charts.map((ch) => {
            const p = parseRef(ch.at) ?? { c: 6, r: 1 };
            return (
              <div key={ch.id} className="absolute z-30 rounded-sm border bg-card shadow-md" style={{ left: left[Math.min(p.c, sh.cols)], top: RH * (p.r + 1), width: 460, height: 280 }}>
                <ChartView ch={ch} sh={sh} eng={eng} />
                <button aria-label="Delete chart" onClick={() => mutate((s) => { s.charts = s.charts.filter((x) => x.id !== ch.id); })}
                  className="absolute right-1 top-1 rounded-sm p-0.5 text-muted-foreground hover:bg-muted"><X className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      </div>
      {/* sheet tabs + status */}
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-t bg-card px-1 text-[11px]">
        {wb.current.sheets.map((s, i) => (
          <button key={i} onClick={() => { wb.current.active = i; commit(); }}
            onDoubleClick={() => { const n = prompt("Rename sheet", s.name); if (n) { s.name = n; commit(); } }}
            className={cn("h-6 rounded-b-sm px-3", i === si ? "border-b-2 border-office bg-background font-semibold text-office" : "text-foreground/70 hover:bg-muted")}>{s.name}</button>
        ))}
        <button aria-label="Add sheet" onClick={() => { wb.current.sheets.push({ ...structuredClone(wb.current.sheets[0]), name: `Sheet${wb.current.sheets.length + 1}`, cells: {}, fmt: {}, style: {}, widths: {}, charts: [], freeze: { r: 0, c: 0 }, rows: 100, cols: 26 }); wb.current.active = wb.current.sheets.length - 1; commit(); }}
          className="h-6 w-6 rounded-sm text-muted-foreground hover:bg-muted">+</button>
        <Stats rect={rect} eng={eng} />
      </div>
    </div>
  );
}

function Stats({ rect, eng }: { rect: Rect; eng: Sheet }) {
  const nums: number[] = [];
  let count = 0;
  eachRef({ ...rect, r1: Math.min(rect.r1, rect.r0 + 2000) }, (ref) => { const v = eng.value(ref); if (v != null && v !== "") count++; if (typeof v === "number") nums.push(v); });
  if (count < 2) return <span className="ml-auto pr-2 text-muted-foreground">Ready</span>;
  const sum = nums.reduce((a, b) => a + b, 0);
  return (
    <span className="ml-auto flex gap-4 pr-2 text-muted-foreground">
      {nums.length > 0 && <><span>Average: {formatValue(sum / nums.length, "number")}</span><span>Sum: {formatValue(sum, "number")}</span></>}
      <span>Count: {count}</span>
    </span>
  );
}

function Swatch({ title, value, onPick, label }: { title: string; value?: string; onPick: (v: string) => void; label: string }) {
  return (
    <label title={title} className="relative inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1 text-[11px] text-foreground/80 hover:bg-office-soft">
      <span className="font-semibold">{label}</span>
      <span className="h-1.5 w-3.5 rounded-[1px] border" style={{ background: value ?? "transparent" }} />
      <input type="color" aria-label={title} value={value ?? "#ffff00"} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      {value && <button aria-label={`Clear ${title}`} onClick={(e) => { e.preventDefault(); onPick(""); }} className="text-muted-foreground">×</button>}
    </label>
  );
}

function ChartView({ ch, sh, eng }: { ch: SheetChart; sh: SheetData; eng: Sheet }) {
  const data = useMemo(() => {
    try {
      const cells = (x: string) => { const out: Scalar[] = []; eachRef(parseRange(x, sh), (ref) => out.push(eng.value(ref))); return out; };
      return chartData(cells(ch.labels), ch.series.map(cells));

    } catch { return { rows: [], names: [] }; }
  }, [ch, sh, eng]);
  const fmt = (v: number) => Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Math.abs(v) < 1 && v !== 0 ? `${(v * 100).toFixed(0)}%` : v.toLocaleString();
  const axes = [<CartesianGrid key="g" strokeDasharray="3 3" stroke="var(--border)" />, <XAxis key="x" dataKey="label" tick={{ fontSize: 10 }} />, <YAxis key="y" tick={{ fontSize: 10 }} tickFormatter={fmt} width={44} />, <Tooltip key="t" formatter={(v: number) => fmt(v)} />, <Legend key="l" wrapperStyle={{ fontSize: 10 }} />];
  return (
    <div className="flex h-full flex-col p-2">
      <div className="truncate pr-5 text-center text-[12px] font-semibold">{ch.title}</div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {ch.type === "pie" ? (
            <PieChart><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Pie data={data.rows} dataKey={data.names[0] ?? "x"} nameKey="label" outerRadius="75%">{data.rows.map((_, i) => <Cell key={i} fill={PALETTE[i % 5]} />)}</Pie></PieChart>
          ) : ch.type === "line" ? (
            <LineChart data={data.rows}>{axes}{data.names.map((n, i) => <Line key={n} dataKey={n} stroke={PALETTE[i % 5]} strokeWidth={2} dot={false} />)}</LineChart>
          ) : ch.type === "area" ? (
            <AreaChart data={data.rows}>{axes}{data.names.map((n, i) => <Area key={n} dataKey={n} stroke={PALETTE[i % 5]} fill={PALETTE[i % 5]} fillOpacity={0.2} />)}</AreaChart>
          ) : (
            <BarChart data={data.rows}>{axes}{data.names.map((n, i) => <Bar key={n} dataKey={n} fill={PALETTE[i % 5]} />)}</BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
