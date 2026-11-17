import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, BarChart3, Bold, Circle, Copy, Gauge, Italic, List, Plus, Redo2, Square, Table2, Trash2, Type, Undo2,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { B, Group } from "@/components/office/writer-editor";
import { clampEl, duplicateSlide, H, makeSlide, uid, W, type Deck, type El, type Layout, type Slide, type Theme } from "@/lib/office/deck";
import { cn } from "@/lib/utils";

const TABS = ["Home", "Insert", "Design"] as const;
const LAYOUTS: { id: Layout; l: string }[] = [
  { id: "title", l: "Title" }, { id: "title_content", l: "Title & content" }, { id: "two_content", l: "Two content" },
  { id: "section", l: "Section" }, { id: "title_only", l: "Title only" }, { id: "blank", l: "Blank" },
];
const ACCENTS = ["#1F4E79", "#0F6E56", "#7A2E8E", "#B4442A", "#1C1F26", "#2B6CB0"];

export function useDeck(initial: Deck, onChange: () => void) {
  const deck = useRef<Deck>(initial);
  const hist = useRef<{ past: string[]; future: string[] }>({ past: [JSON.stringify(initial)], future: [] });
  const [ver, setVer] = useState(0);
  const [cur, setCur] = useState(0);
  const changed = useRef(onChange); changed.current = onChange;
  const commit = useCallback(() => {
    const snap = JSON.stringify(deck.current); const h = hist.current;
    if (h.past[h.past.length - 1] !== snap) { h.past.push(snap); if (h.past.length > 60) h.past.shift(); h.future = []; }
    setVer((v) => v + 1); changed.current();
  }, []);
  const undo = useCallback((redo = false) => {
    const h = hist.current;
    if (redo) { const n = h.future.pop(); if (!n) return; h.past.push(n); deck.current = JSON.parse(n); }
    else { if (h.past.length < 2) return; h.future.push(h.past.pop()!); deck.current = JSON.parse(h.past[h.past.length - 1]); }
    setCur((c) => Math.min(c, deck.current.slides.length - 1)); setVer((v) => v + 1); changed.current();
  }, []);
  return { deck, ver, commit, undo, cur: Math.min(cur, deck.current.slides.length - 1), setCur };
}
export type DeckApi = ReturnType<typeof useDeck>;

export function SlidesEditor({ api }: { api: DeckApi }) {
  const { deck, commit, undo, cur, setCur } = api;
  const d = deck.current;
  const slide = d.slides[cur];
  const [tab, setTab] = useState<(typeof TABS)[number]>("Home");
  const [sel, setSel] = useState<string | null>(null);
  const el = slide.els.find((e) => e.id === sel);
  useEffect(() => setSel(null), [cur]);
  const mutate = (f: () => void) => { f(); commit(); };
  const add = (e: Omit<El, "id">) => mutate(() => { const n = { ...e, id: uid() } as El; slide.els.push(n); setSel(n.id); });
  const setStyle = (p: NonNullable<El["style"]>) => el && mutate(() => { el.style = { ...el.style, ...p }; });
  const newSlide = (l: Layout) => mutate(() => { d.slides.splice(cur + 1, 0, makeSlide(l)); setCur(cur + 1); });
  const ic = "h-3.5 w-3.5";

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.closest("[data-agent-ignore]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); mutate(() => { slide.els = slide.els.filter((x) => x.id !== sel); }); setSel(null); }
      else if (e.key.startsWith("Arrow") && sel && el) {
        e.preventDefault(); const s = e.shiftKey ? 0.5 : 0.05;
        mutate(() => { Object.assign(el, clampEl({ ...el, x: el.x + (e.key === "ArrowRight" ? s : e.key === "ArrowLeft" ? -s : 0), y: el.y + (e.key === "ArrowDown" ? s : e.key === "ArrowUp" ? -s : 0) })); });
      } else if (!sel && (e.key === "PageDown" || e.key === "ArrowDown")) setCur(Math.min(d.slides.length - 1, cur + 1));
      else if (!sel && (e.key === "PageUp" || e.key === "ArrowUp")) setCur(Math.max(0, cur - 1));
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b bg-card" data-section="Slides ribbon">
        <div className="flex h-7 items-end gap-0.5 px-2">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}
              className={cn("h-6 px-3 text-[11px]", tab === t ? "border-b-2 border-office font-semibold text-office" : "text-foreground/70 hover:text-foreground")}>{t}</button>
          ))}
        </div>
        <div className="flex h-[68px] items-stretch overflow-x-auto border-t bg-background/60 py-1">
          {tab === "Home" && (<>
            <Group name="Undo"><B title="Undo" on={() => undo()}><Undo2 className={ic} /></B><B title="Redo" on={() => undo(true)}><Redo2 className={ic} /></B></Group>
            <Group name="Slides">
              <select aria-label="New slide layout" value="" onChange={(e) => e.target.value && newSlide(e.target.value as Layout)} className="h-6 rounded-sm border bg-background px-1 text-[11px]">
                <option value="">New slide…</option>{LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.l}</option>)}
              </select>
              <B title="Duplicate slide" on={() => mutate(() => setCur(duplicateSlide(d, cur)))}><Copy className={ic} /></B>
              <B title="Delete slide" disabled={d.slides.length < 2} on={() => mutate(() => { d.slides.splice(cur, 1); setCur(Math.max(0, cur - 1)); })}><Trash2 className={ic} /></B>
            </Group>
            <Group name="Font">
              <select aria-label="Font size" disabled={!el} value={el?.style?.size ?? 18} onChange={(e) => setStyle({ size: Number(e.target.value) })} className="h-6 w-14 rounded-sm border bg-background px-1 text-[11px]">
                {[9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <B title="Bold" disabled={!el} active={el?.style?.bold} on={() => setStyle({ bold: !el?.style?.bold })}><Bold className={ic} /></B>
              <B title="Italic" disabled={!el} active={el?.style?.italic} on={() => setStyle({ italic: !el?.style?.italic })}><Italic className={ic} /></B>
              <label title="Text colour" className="relative inline-flex h-6 items-center px-1 text-[11px] font-semibold">A<span className="ml-0.5 h-1.5 w-3 border" style={{ background: el?.style?.color }} />
                <input type="color" aria-label="Text colour" disabled={!el} onChange={(e) => setStyle({ color: e.target.value })} className="absolute inset-0 opacity-0" /></label>
              <label title="Fill" className="relative inline-flex h-6 items-center px-1 text-[11px]">Fill<span className="ml-0.5 h-1.5 w-3 border" style={{ background: el?.style?.fill }} />
                <input type="color" aria-label="Fill colour" disabled={!el} onChange={(e) => setStyle({ fill: e.target.value })} className="absolute inset-0 opacity-0" /></label>
            </Group>
            <Group name="Paragraph">
              {(["left", "center", "right"] as const).map((a) => {
                const I = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
                return <B key={a} title={`Align ${a}`} disabled={!el} active={el?.style?.align === a} on={() => setStyle({ align: a })}><I className={ic} /></B>;
              })}
            </Group>
            <Group name="Arrange">
              <B title="Bring to front" disabled={!el} on={() => el && mutate(() => { slide.els = [...slide.els.filter((x) => x !== el), el]; })} label="Front">{null}</B>
              <B title="Send to back" disabled={!el} on={() => el && mutate(() => { slide.els = [el, ...slide.els.filter((x) => x !== el)]; })} label="Back">{null}</B>
              <B title="Delete element" disabled={!el} on={() => mutate(() => { slide.els = slide.els.filter((x) => x.id !== sel); setSel(null); })}><Trash2 className={ic} /></B>
            </Group>
          </>)}
          {tab === "Insert" && (<>
            <Group name="Slides"><B title="New title & content slide" on={() => newSlide("title_content")} label="New slide"><Plus className={ic} /></B></Group>
            <Group name="Text">
              <B title="Text box" on={() => add({ type: "text", x: 1, y: 2, w: 5, h: 1, text: "Text", style: { size: 18 } })} label="Text box"><Type className={ic} /></B>
              <B title="Bullets" on={() => add({ type: "bullets", x: 1, y: 2, w: 6, h: 3, bullets: ["Point one", "Point two"], style: { size: 18 } })} label="Bullets"><List className={ic} /></B>
            </Group>
            <Group name="Data">
              <B title="Table" on={() => add({ type: "table", x: 0.6, y: 1.6, w: 8, h: 2.5, rows: [["Metric", "FY24", "FY25"], ["Revenue", "", ""], ["Margin", "", ""]], style: { size: 12 } })} label="Table"><Table2 className={ic} /></B>
              <B title="Chart" on={() => add({ type: "chart", x: 6.8, y: 1.6, w: 6, h: 4.5, chart: { type: "bar", labels: ["FY24", "FY25", "FY26"], series: [{ name: "Revenue", values: [1, 2, 3] }] } })} label="Chart"><BarChart3 className={ic} /></B>
              <B title="KPI card" on={() => add({ type: "metric", x: 0.6, y: 1.6, w: 3, h: 1.8, metric: { value: "$0", label: "Metric", delta: "+0%" } })} label="KPI card"><Gauge className={ic} /></B>
            </Group>
            <Group name="Shapes">
              <B title="Rectangle" on={() => add({ type: "shape", shape: "rect", x: 1, y: 2, w: 3, h: 1.5 })}><Square className={ic} /></B>
              <B title="Rounded rectangle" on={() => add({ type: "shape", shape: "rounded", x: 1, y: 2, w: 3, h: 1.5 })} label="Rounded">{null}</B>
              <B title="Ellipse" on={() => add({ type: "shape", shape: "ellipse", x: 1, y: 2, w: 2, h: 2 })}><Circle className={ic} /></B>
              <B title="Line" on={() => add({ type: "shape", shape: "line", x: 0.6, y: 1.35, w: 12.1, h: 0.01 })} label="Line">{null}</B>
            </Group>
          </>)}
          {tab === "Design" && (<>
            <Group name="Accent">
              {ACCENTS.map((c) => <button key={c} title={c} aria-label={`Accent ${c}`} onClick={() => mutate(() => { d.theme.accent = c; })}
                className={cn("h-5 w-5 rounded-sm border", d.theme.accent === c && "ring-2 ring-office")} style={{ background: c }} />)}
            </Group>
            <Group name="Font">
              <select aria-label="Theme font" value={d.theme.font} onChange={(e) => mutate(() => { d.theme.font = e.target.value as Theme["font"]; })} className="h-6 rounded-sm border bg-background px-1 text-[11px]">
                {["Aptos", "Calibri", "Georgia", "Arial"].map((f) => <option key={f}>{f}</option>)}
              </select>
            </Group>
            <Group name="Background"><B title="Light / dark" on={() => mutate(() => { d.theme.dark = !d.theme.dark; })} label={d.theme.dark ? "Dark" : "Light"}>{null}</B></Group>
          </>)}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[132px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r bg-card p-2" data-section="Slide sorter">
          {d.slides.map((s, i) => (
            <button key={s.id} onClick={() => setCur(i)} aria-label={`Slide ${i + 1}`}
              draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))} onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const from = Number(e.dataTransfer.getData("text/plain")); mutate(() => { const [m] = d.slides.splice(from, 1); d.slides.splice(i, 0, m); setCur(i); }); }}
              className="mb-2 flex w-full items-start gap-1 text-left">
              <span className="w-3 pt-0.5 text-[10px] text-muted-foreground">{i + 1}</span>
              <div className={cn("flex-1 overflow-hidden rounded-[2px] border", i === cur ? "ring-2 ring-office" : "hover:ring-1 hover:ring-office/40")}>
                <SlideView slide={s} theme={d.theme} width={100} />
              </div>
            </button>
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col bg-muted/50">
          <Stage api={api} slide={slide} sel={sel} setSel={setSel} />
          <textarea aria-label="Speaker notes" value={slide.notes} placeholder="Click to add notes"
            onChange={(e) => { slide.notes = e.target.value; commit(); }}
            className="h-16 shrink-0 resize-none border-t bg-card px-3 py-1.5 text-[11px] outline-none" />
          <div className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-3 text-[10.5px] text-muted-foreground">
            <span>Slide {cur + 1} of {d.slides.length}</span><span className="ml-auto">{d.theme.font} · 16:9</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stage({ api, slide, sel, setSel }: { api: DeckApi; slide: Slide; sel: string | null; setSel: (s: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const { width: w, height: h } = e.contentRect; setWidth(Math.max(200, Math.min(w - 48, ((h - 32) * W) / H))); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4" onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
      <div className="shadow-lg ring-1 ring-border"><SlideView slide={slide} theme={api.deck.current.theme} width={width} edit={{ api, sel, setSel }} /></div>
    </div>
  );
}

/** Renders a slide at a pixel width; with `edit` it supports select, drag, resize and inline text editing. */
export function SlideView({ slide, theme, width, edit }: { slide: Slide; theme: Theme; width: number; edit?: { api: DeckApi; sel: string | null; setSel: (s: string | null) => void } }) {
  const k = width / W; // px per inch
  const pt = (n: number) => (n / 72) * k;
  const ink = theme.dark ? "#F5F5F5" : "#1F2328";
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<{ id: string; mode: "move" | "size"; x: number; y: number; e: El } | null>(null);
  const onDown = (e: RPE, el: El, mode: "move" | "size") => {
    if (!edit || editing === el.id) return;
    e.stopPropagation(); edit.setSel(el.id);
    drag.current = { id: el.id, mode, x: e.clientX, y: e.clientY, e: { ...el } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPE) => {
    const g = drag.current; if (!g || !edit) return;
    const dx = (e.clientX - g.x) / k, dy = (e.clientY - g.y) / k;
    const el = slide.els.find((x) => x.id === g.id); if (!el) return;
    const snap = (v: number) => Math.round(v * 20) / 20;
    Object.assign(el, clampEl(g.mode === "move" ? { ...g.e, x: snap(g.e.x + dx), y: snap(g.e.y + dy) } : { ...g.e, w: snap(g.e.w + dx), h: snap(g.e.h + dy) }));
    edit.api.commit();
  };
  return (
    <div className="relative select-none overflow-hidden" style={{ width, height: (width * H) / W, background: slide.bg ?? (theme.dark ? "#141821" : "#FFFFFF"), fontFamily: `${theme.font}, Calibri, Arial, sans-serif`, color: ink }}
      onPointerMove={onMove} onPointerUp={() => (drag.current = null)}
      onPointerDown={(e) => { if (edit && e.target === e.currentTarget) { edit.setSel(null); setEditing(null); } }}>
      {slide.els.map((el) => {
        const st = el.style ?? {};
        const isSel = edit?.sel === el.id;
        const css: CSSProperties = {
          left: el.x * k, top: el.y * k, width: el.w * k, height: el.h * k, fontSize: pt(st.size ?? 18), fontWeight: st.bold ? 700 : undefined, fontStyle: st.italic ? "italic" : undefined,
          color: st.color ?? (el.role === "title" ? theme.accent : undefined), textAlign: st.align, background: el.type !== "shape" ? st.fill : undefined,
          display: "flex", flexDirection: "column", justifyContent: st.valign === "middle" ? "center" : st.valign === "bottom" ? "flex-end" : "flex-start",
        };
        return (
          <div key={el.id} className={cn("absolute", edit && "cursor-move", isSel && "outline outline-1 outline-office")} style={css}
            onPointerDown={(e) => onDown(e, el, "move")}
            onDoubleClick={() => edit && (el.type === "text" || el.type === "bullets" || el.type === "shape") && setEditing(el.id)}>
            {editing === el.id && edit ? (
              <textarea autoFocus aria-label="Edit text" defaultValue={el.type === "bullets" ? (el.bullets ?? []).join("\n") : el.text ?? ""}
                onBlur={(e) => { const v = e.target.value; if (el.type === "bullets") el.bullets = v.split("\n").filter((x) => x.trim()); else el.text = v; setEditing(null); edit.api.commit(); }}
                onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
                className="h-full w-full resize-none bg-background/80 p-0 outline-none" style={{ font: "inherit", color: "inherit", textAlign: "inherit" }} />
            ) : <ElBody el={el} theme={theme} pt={pt} k={k} ink={ink} empty={!!edit} />}
            {isSel && editing !== el.id && (
              <span onPointerDown={(e) => onDown(e, el, "size")} className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize border border-office bg-background" />
            )}
          </div>
        );
      })}
    </div>
  );
}

const PALETTE = (a: string) => [a, "#8FAADC", "#F4B183", "#A9D18E", "#FFD966"];

function ElBody({ el, theme, pt, k, ink, empty }: { el: El; theme: Theme; pt: (n: number) => number; k: number; ink: string; empty: boolean }) {
  const st = el.style ?? {};
  const ph = (t: string) => (empty ? <span className="opacity-40">{t}</span> : null);
  switch (el.type) {
    case "text":
      return el.text ? <div className="whitespace-pre-wrap leading-tight">{el.text}</div> : ph(el.role === "title" ? "Click to add title" : el.role === "subtitle" ? "Click to add subtitle" : "Text");
    case "bullets":
      return el.bullets?.length ? (
        <ul className="list-disc space-y-[0.35em] pl-[1.1em] leading-snug">{el.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      ) : ph("Double-click to add text");
    case "table":
      return (
        <table className="w-full border-collapse" style={{ fontSize: pt(st.size ?? 12) }}>
          <tbody>{(el.rows ?? []).map((r, ri) => (
            <tr key={ri} style={ri === 0 ? { background: theme.accent, color: "#FFFFFF", fontWeight: 700 } : ri % 2 === 0 ? { background: theme.dark ? "#1E2430" : "#F3F6FA" } : undefined}>
              {r.map((c, ci) => <td key={ci} className="border px-[0.4em] py-[0.2em]" style={{ borderColor: "#BFBFBF", textAlign: ci > 0 && /^[-$(]?[\d.,]+/.test(c) ? "right" : "left" }}>{c}</td>)}
            </tr>
          ))}</tbody>
        </table>
      );
    case "metric":
      return (
        <div className="flex h-full flex-col items-center justify-center rounded-md border text-center" style={{ borderColor: theme.accent, background: st.fill ?? (theme.dark ? "#1E2430" : "#F3F6FA") }}>
          <div style={{ fontSize: pt(st.size ?? 32), fontWeight: 700, color: theme.accent, lineHeight: 1.1 }}>{el.metric?.value}</div>
          <div style={{ fontSize: pt(12), color: ink }}>{el.metric?.label}</div>
          {el.metric?.delta && <div style={{ fontSize: pt(11), color: el.metric.delta.trim().startsWith("-") ? "#C00000" : "#2E7D32" }}>{el.metric.delta}</div>}
        </div>
      );
    case "shape": {
      const fill = st.fill ?? theme.accent;
      if (el.shape === "line") return <div className="absolute inset-x-0 top-0" style={{ borderTop: `${Math.max(1, k / 72)}px solid ${st.color ?? theme.accent}` }} />;
      return <div className="flex h-full w-full items-center justify-center" style={{ background: fill, borderRadius: el.shape === "ellipse" ? "50%" : el.shape === "rounded" ? pt(10) : 0, color: st.color ?? "#FFFFFF" }}>{el.text}</div>;
    }
    case "chart": {
      const c = el.chart; if (!c) return null;
      const rows = c.labels.map((l, i) => Object.fromEntries([["label", l], ...c.series.map((s) => [s.name, s.values[i] ?? 0])]));
      const pal = PALETTE(theme.accent);
      const f = Math.max(6, pt(10));
      const axes = [<CartesianGrid key="g" strokeDasharray="3 3" stroke="#D0D0D0" />, <XAxis key="x" dataKey="label" tick={{ fontSize: f, fill: ink }} />, <YAxis key="y" tick={{ fontSize: f, fill: ink }} width={f * 4} />, <Tooltip key="t" />, ...(c.series.length > 1 ? [<Legend key="l" wrapperStyle={{ fontSize: f }} />] : [])];
      return (
        <ResponsiveContainer width="100%" height="100%">
          {c.type === "pie" ? (
            <PieChart><Tooltip /><Legend wrapperStyle={{ fontSize: f }} /><Pie data={rows} dataKey={c.series[0]?.name ?? "x"} nameKey="label" outerRadius="75%" isAnimationActive={false}>{rows.map((_, i) => <Cell key={i} fill={pal[i % 5]} />)}</Pie></PieChart>
          ) : c.type === "line" ? (
            <LineChart data={rows}>{axes}{c.series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={pal[i % 5]} strokeWidth={2} dot={false} isAnimationActive={false} />)}</LineChart>
          ) : c.type === "area" ? (
            <AreaChart data={rows}>{axes}{c.series.map((s, i) => <Area key={s.name} dataKey={s.name} stroke={pal[i % 5]} fill={pal[i % 5]} fillOpacity={0.25} isAnimationActive={false} />)}</AreaChart>
          ) : (
            <BarChart data={rows}>{axes}{c.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={pal[i % 5]} isAnimationActive={false} />)}</BarChart>
          )}
        </ResponsiveContainer>
      );
    }
  }
}
