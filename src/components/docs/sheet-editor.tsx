import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { companyQuery, useQuotes } from "@/lib/data";
import { sheetAssist } from "@/lib/docs.functions";
import { lookup, STATEMENT_KEYS } from "@/lib/financials/lookup";
import type { CompanyDataset } from "@/lib/financials/types";
import { colName, FormulaError, formatValue, parseRef, referencedSymbols, refOf, Sheet, type CellFormat } from "@/lib/sheet/formula";
import { cn } from "@/lib/utils";

export interface SheetContent {
  rows: number;
  cols: number;
  cells: Record<string, string>;
  formats: Record<string, CellFormat>;
}

const FORMATS: { id: CellFormat; l: string }[] = [
  { id: "general", l: "Auto" },
  { id: "number", l: "1,234" },
  { id: "usd", l: "$" },
  { id: "usdM", l: "$M" },
  { id: "pct", l: "%" },
  { id: "x", l: "×" },
];

interface Sel {
  c: number;
  r: number;
}

export function SheetEditor({ initial, onChange }: { initial: Partial<SheetContent>; onChange: (c: SheetContent) => void }) {
  const [cells, setCells] = useState<Record<string, string>>(initial.cells ?? {});
  const [formats, setFormats] = useState<Record<string, CellFormat>>(initial.formats ?? {});
  const [dims, setDims] = useState({ rows: Math.max(initial.rows ?? 40, 20), cols: Math.max(initial.cols ?? 12, 8) });
  const [sel, setSel] = useState<Sel>({ c: 0, r: 0 });
  const [anchor, setAnchor] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { open } = useSource();

  // ---- data for FU()/PRICE() ----
  const syms = useMemo(() => referencedSymbols(cells), [cells]);
  const fuTickers = syms.fu.filter((t) => coverageOf(t));
  const datasets = useQueries({ queries: fuTickers.map((t) => companyQuery(t)) });
  const dsMap = useMemo(() => {
    const m = new Map<string, CompanyDataset>();
    datasets.forEach((q, i) => q.data && m.set(fuTickers[i], q.data));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets.map((d) => d.dataUpdatedAt).join(), fuTickers.join()]);
  const quotes = useQuotes(syms.price);
  const qMap = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q.price])), [quotes.data]);

  const sheet = useMemo(
    () =>
      new Sheet({
        get: (ref) => cells[ref],
        fu: (t, m, p) => {
          const tk = t.toUpperCase();
          if (!coverageOf(tk)) return new FormulaError("#N/A", `${tk} not covered`);
          const d = dsMap.get(tk);
          if (!d) return new FormulaError("#LOADING");
          const r = lookup(d, m, p);
          return "error" in r ? new FormulaError("#N/A", r.error) : r.value;
        },
        price: (s) => qMap.get(s.toUpperCase()) ?? new FormulaError(quotes.isLoading ? "#LOADING" : "#N/A"),
      }),
    [cells, dsMap, qMap, quotes.isLoading],
  );

  // ---- autosave ----
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onChange({ ...dims, cells, formats }), 700);
    return () => clearTimeout(t);
  }, [cells, formats, dims, onChange]);

  const selRef = refOf(sel.c, sel.r);
  const range = useMemo(() => {
    const a = anchor ?? sel;
    return { c0: Math.min(a.c, sel.c), c1: Math.max(a.c, sel.c), r0: Math.min(a.r, sel.r), r1: Math.max(a.r, sel.r) };
  }, [anchor, sel]);
  const inRange = (c: number, r: number) => c >= range.c0 && c <= range.c1 && r >= range.r0 && r <= range.r1;
  const fmtOf = (ref: string) => formats[ref] ?? formats[ref.replace(/\d+$/, "")] ?? "general";

  const commit = useCallback(
    (ref: string, value: string) => {
      setCells((cs) => {
        const next = { ...cs };
        if (value === "") delete next[ref];
        else next[ref] = value;
        return next;
      });
    },
    [setCells],
  );

  const move = (dc: number, dr: number, extend = false) => {
    setSel((s) => {
      const n = { c: Math.max(0, Math.min(dims.cols - 1, s.c + dc)), r: Math.max(0, Math.min(dims.rows - 1, s.r + dr)) };
      if (!extend) setAnchor(null);
      else if (!anchor) setAnchor(s);
      return n;
    });
  };

  const rangeRefs = () => {
    const out: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) out.push(refOf(c, r));
    return out;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    const k = e.key;
    if (k === "ArrowUp") (e.preventDefault(), move(0, -1, e.shiftKey));
    else if (k === "ArrowDown") (e.preventDefault(), move(0, 1, e.shiftKey));
    else if (k === "ArrowLeft") (e.preventDefault(), move(-1, 0, e.shiftKey));
    else if (k === "ArrowRight") (e.preventDefault(), move(1, 0, e.shiftKey));
    else if (k === "Tab") (e.preventDefault(), move(e.shiftKey ? -1 : 1, 0));
    else if (k === "Enter" || k === "F2") (e.preventDefault(), setEditing(cells[selRef] ?? ""));
    else if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      setCells((cs) => {
        const n = { ...cs };
        rangeRefs().forEach((r) => delete n[r]);
        return n;
      });
    } else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "c") {
      const lines: string[] = [];
      for (let r = range.r0; r <= range.r1; r++) {
        const row: string[] = [];
        for (let c = range.c0; c <= range.c1; c++) row.push(formatValue(sheet.value(refOf(c, r)), "general"));
        lines.push(row.join("\t"));
      }
      navigator.clipboard?.writeText(lines.join("\n"));
      toast.success("Copied");
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setEditing(k);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing !== null) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
    setCells((cs) => {
      const n = { ...cs };
      rows.forEach((line, dr) =>
        line.split("\t").forEach((v, dc) => {
          const ref = refOf(sel.c + dc, sel.r + dr);
          if (v.trim() === "") delete n[ref];
          else n[ref] = v.trim();
        }),
      );
      return n;
    });
    setDims((d) => ({ rows: Math.max(d.rows, sel.r + rows.length + 5), cols: Math.max(d.cols, sel.c + Math.max(...rows.map((l) => l.split("\t").length)) + 1) }));
  };

  const setFormat = (f: CellFormat) => {
    setFormats((fs) => {
      const n = { ...fs };
      // Whole selected columns → column format, otherwise per cell
      const fullCols = range.r0 === 0 && range.r1 === dims.rows - 1;
      if (fullCols) for (let c = range.c0; c <= range.c1; c++) n[colName(c)] = f;
      else rangeRefs().forEach((r) => (n[r] = f));
      return n;
    });
  };

  const exportCsv = () => {
    let maxR = 0;
    let maxC = 0;
    for (const ref of Object.keys(cells)) {
      const p = parseRef(ref);
      if (p) {
        maxR = Math.max(maxR, p.r);
        maxC = Math.max(maxC, p.c);
      }
    }
    const lines: string[] = [];
    for (let r = 0; r <= maxR; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxC; c++) row.push(`"${formatValue(sheet.value(refOf(c, r)), fmtOf(refOf(c, r))).replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "sheet.csv";
    a.click();
  };

  // Source for an FU() formula in the selected cell
  const fuMatch = (cells[selRef] ?? "").match(/FU\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/i);
  const openSource = () => {
    if (!fuMatch) return;
    const [, t, m, p] = fuMatch;
    const d = dsMap.get(t.toUpperCase());
    if (!d) return;
    const r = lookup(d, m, p ?? "latest");
    if ("error" in r) return void toast.error(r.error);
    if (r.cell) {
      open({ ticker: d.profile.ticker, label: r.label, periodLabel: r.period, unit: r.unit, value: r.value, src: r.cell.src, derived: r.cell.derived, alts: r.cell.alts, approx: r.cell.approx });
    } else if (r.ttm) {
      const st = d.statements.quarterly[r.statement];
      const row = st.rows.find((x) => x.label === r.label)!;
      open({
        ticker: d.profile.ticker,
        label: `${r.label} (TTM)`,
        periodLabel: r.period,
        unit: r.unit,
        value: r.value,
        derived: {
          formula: `Sum of ${r.ttm.map((i) => st.periods[i].label).join(" + ")}`,
          parts: r.ttm.flatMap((i) => {
            const c = row.cells[i]!;
            return c.src ? [{ ...c.src, label: st.periods[i].label, sign: 1 as const }] : (c.derived?.parts ?? []).map((pp) => ({ ...pp, label: `${st.periods[i].label} · ${pp.label}` }));
          }),
        },
      });
    }
  };

  const runAi = async () => {
    if (aiPrompt.trim().length < 3) return;
    setAiBusy(true);
    try {
      const mentioned = COVERAGE.filter((c) => new RegExp(`\\b(${c.ticker}|${c.shortName})\\b`, "i").test(aiPrompt));
      const list = mentioned.length ? mentioned : COVERAGE.slice(0, 3);
      const ds = await Promise.all(list.map((c) => qc.fetchQuery(companyQuery(c.ticker))));
      const catalog = [
        `Metric keys by statement: ${STATEMENT_KEYS.map((k) => `${k}: ${ds[0].statements.annual[k].rows.map((r) => r.key).join(", ")}`).join(" | ")}`,
        ...ds.map((d) => `${d.profile.ticker}: annual periods ${d.statements.annual.income.periods.slice(-5).map((p) => p.label).join(", ")}; quarterly ${d.statements.quarterly.income.periods.slice(-8).map((p) => p.label).join(", ")}`),
        `Other covered tickers: ${COVERAGE.map((c) => c.ticker).join(", ")}`,
      ].join("\n");
      const snapshot = Object.entries(cells)
        .slice(0, 300)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      const patch = await sheetAssist({ data: { instruction: aiPrompt, anchor: selRef, snapshot, catalog } });
      let maxR = 0;
      let maxC = 0;
      setCells((cs) => {
        const n = { ...cs };
        for (const { ref, value } of patch.cells) {
          const p = parseRef(ref);
          if (!p) continue;
          maxR = Math.max(maxR, p.r);
          maxC = Math.max(maxC, p.c);
          if (value === "") delete n[ref.toUpperCase()];
          else n[ref.toUpperCase()] = value;
        }
        return n;
      });
      setFormats((fs) => {
        const n = { ...fs };
        for (const f of patch.formats) if (/^[A-Z]{1,3}$/.test(f.column)) n[f.column] = f.format;
        return n;
      });
      setDims((d) => ({ rows: Math.max(d.rows, maxR + 5), cols: Math.max(d.cols, maxC + 2) }));
      toast.success(patch.note || `Wrote ${patch.cells.length} cells`);
      setAiPrompt("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const raw = cells[selRef] ?? "";
  const val = sheet.value(selRef);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="flex rounded-md border bg-secondary/50 p-0.5">
          {FORMATS.map((f) => (
            <button key={f.id} onClick={() => setFormat(f.id)} className={cn("num rounded px-2 py-0.5 text-[11px]", fmtOf(selRef) === f.id ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}>
              {f.l}
            </button>
          ))}
        </div>
        <Button size="xs" variant="ghost" onClick={() => setDims((d) => ({ ...d, rows: d.rows + 10 }))}>
          <Plus /> Rows
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setDims((d) => ({ ...d, cols: d.cols + 2 }))}>
          <Plus /> Columns
        </Button>
        <Button size="xs" variant="ghost" onClick={exportCsv}>
          <Download /> CSV
        </Button>
        {fuMatch && (
          <Button size="xs" variant="outline" onClick={openSource}>
            <FileText /> Source
          </Button>
        )}
        <form
          className="ml-auto flex min-w-72 flex-1 items-center gap-1.5 sm:max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            runAi();
          }}
        >
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <Input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={`Build at ${selRef}: e.g. "NVDA and AMD-style margin table, last 6 quarters"`} className="h-8 text-xs" disabled={aiBusy} />
          <Button size="xs" variant="ink" type="submit" disabled={aiBusy || aiPrompt.trim().length < 3}>
            {aiBusy ? <Loader2 className="animate-spin" /> : "Build"}
          </Button>
        </form>
      </div>

      <div className="flex items-center gap-2 border-b bg-card px-3 py-1.5">
        <span className="num w-14 rounded border bg-secondary/50 px-1.5 py-0.5 text-center text-xs">{range.c0 !== range.c1 || range.r0 !== range.r1 ? `${refOf(range.c0, range.r0)}:${refOf(range.c1, range.r1)}` : selRef}</span>
        <span className="num text-xs italic text-muted-foreground">fx</span>
        <input
          value={editing ?? raw}
          onChange={(e) => setEditing(e.target.value)}
          onFocus={() => editing === null && setEditing(raw)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(selRef, editing ?? raw);
              setEditing(null);
              move(0, 1);
              grid.current?.focus();
            } else if (e.key === "Escape") {
              setEditing(null);
              grid.current?.focus();
            }
          }}
          className="num min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          placeholder='Type a value or formula — e.g. =FU("AAPL","revenue","FY2025","B")'
        />
        {val instanceof FormulaError && <span className="truncate text-[11px] text-negative">{val.detail ?? val.code}</span>}
      </div>

      <div ref={grid} tabIndex={0} onKeyDown={onKey} onPaste={onPaste} className="min-h-0 flex-1 overflow-auto bg-card outline-none scrollbar-thin">
        <table className="border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-10 border-b border-r bg-secondary" />
              {Array.from({ length: dims.cols }).map((_, c) => (
                <th
                  key={c}
                  onClick={() => {
                    setAnchor({ c, r: 0 });
                    setSel({ c, r: dims.rows - 1 });
                  }}
                  className={cn("num sticky top-0 z-10 min-w-28 cursor-pointer border-b border-r bg-secondary px-2 py-1 text-[10.5px] font-medium text-muted-foreground", c >= range.c0 && c <= range.c1 && "bg-highlight-soft text-foreground")}
                >
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: dims.rows }).map((_, r) => (
              <tr key={r}>
                <th className={cn("num sticky left-0 z-10 border-b border-r bg-secondary px-1.5 text-right text-[10.5px] font-medium text-muted-foreground", r >= range.r0 && r <= range.r1 && "bg-highlight-soft text-foreground")}>{r + 1}</th>
                {Array.from({ length: dims.cols }).map((_, c) => {
                  const ref = refOf(c, r);
                  const isSel = sel.c === c && sel.r === r;
                  const v = sheet.value(ref);
                  const text = formatValue(v, fmtOf(ref));
                  const numeric = typeof v === "number";
                  const isFu = /^=.*\bFU\(/i.test(cells[ref] ?? "");
                  return (
                    <td
                      key={c}
                      onMouseDown={(e) => {
                        if (editing !== null && !isSel) {
                          commit(selRef, editing);
                          setEditing(null);
                        }
                        if (e.shiftKey) setAnchor((a) => a ?? sel);
                        else setAnchor(null);
                        setSel({ c, r });
                      }}
                      onDoubleClick={() => setEditing(cells[ref] ?? "")}
                      className={cn(
                        "relative h-7 max-w-64 border-b border-r px-2",
                        inRange(c, r) && !isSel && "bg-highlight-soft/50",
                        isSel && "outline outline-2 -outline-offset-1 outline-foreground",
                        numeric && "num text-right",
                        v instanceof FormulaError && "text-negative",
                        r === 0 && cells[ref] && !numeric && "font-semibold",
                      )}
                    >
                      {isSel && editing !== null ? (
                        <input
                          autoFocus
                          value={editing}
                          onChange={(e) => setEditing(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Tab") {
                              e.preventDefault();
                              commit(ref, editing);
                              setEditing(null);
                              move(e.key === "Tab" ? 1 : 0, e.key === "Enter" ? 1 : 0);
                              grid.current?.focus();
                            } else if (e.key === "Escape") {
                              setEditing(null);
                              grid.current?.focus();
                            }
                          }}
                          onBlur={() => {
                            if (editing !== null) commit(ref, editing);
                            setEditing(null);
                          }}
                          className="num absolute inset-0 w-full bg-card px-2 text-[12.5px] outline-none"
                        />
                      ) : (
                        <span className="block truncate">
                          {text}
                          {isFu && <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-chart-2" />}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t bg-card px-3 py-1.5 text-[10.5px] text-muted-foreground">
        Functions: SUM, AVERAGE, MIN, MAX, MEDIAN, ROUND, IF, GROWTH(new,old), CAGR(first,last,years), PRICE("NVDA"), and <span className="num">FU("TICKER","metric","period",["M"|"B"])</span> for any reported SEC value — dotted cells are sourced; select one and click Source.
      </p>
    </div>
  );
}

