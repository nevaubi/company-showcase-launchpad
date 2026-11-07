// The assistant's canvas: dashboard views it renders, live cloud browsers and file deliverables.
import { useEffect, useRef, useState } from "react";
import {
  AppWindow, ArrowDown, ArrowUp, Download, ExternalLink, FileText, Hand, Image as ImageIcon, LayoutDashboard, Pin, PinOff, Square, X,
} from "lucide-react";
import { ResearchMarkdown } from "@/components/research/markdown";
import { ViewRenderer, defaultSpan, spanClass } from "@/components/research/viz/view";
import { Button } from "@/components/ui/button";
import LoadingState, { PixelGrid } from "@/components/ui/loading-state";
import { browserConfigured, browserStatus, browserStop } from "@/lib/browser.functions";
import { fmtBytes } from "@/lib/research/files";
import { canvas, orderedViews, useCanvas, type BrowserRun, type CanvasFile, type CanvasView } from "@/lib/research/views";
import { cn } from "@/lib/utils";

function FileCard({ f }: { f: CanvasFile }) {
  const img = f.mime.startsWith("image/");
  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background">
      {img && <img src={f.url} alt={f.name} className="max-h-64 w-full border-b object-contain bg-muted/30" loading="lazy" />}
      <div className="flex items-center gap-2 p-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">{img ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{f.name}</p>
          <p className="text-[10.5px] text-muted-foreground">
            {fmtBytes(f.size)} · {f.source === "browser" ? "from browser" : "made by assistant"}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 shrink-0 gap-1 px-2 text-[11px]">
          <a href={f.url} download={f.name} target="_blank" rel="noreferrer">
            <Download className="size-3" /> Download
          </a>
        </Button>
      </div>
      {f.preview && !img && <pre className="max-h-40 overflow-auto border-t bg-muted/30 p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground scrollbar-thin">{f.preview}</pre>}
    </div>
  );
}

const renderFile = (id: string) => {
  const f = canvas.file(id);
  return f ? <FileCard f={f} /> : <p className="text-[12px] text-muted-foreground">File no longer available.</p>;
};

function ViewCard({ v, first, last }: { v: CanvasView; first: boolean; last: boolean }) {
  const s = v.spec;
  const status = useCanvas().rendered[v.id];
  return (
    <section className={cn("step-in group/card relative min-w-0 rounded-lg border bg-card p-3 shadow-paper", spanClass(defaultSpan(s)), v.pinned && "ring-1 ring-foreground/15")} aria-label={s.title ?? s.type}>
      <div className="absolute right-1.5 top-1.5 z-[2] flex items-center gap-0.5 rounded-md bg-card/90 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
        <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => canvas.togglePin(v.id)} aria-label={v.pinned ? "Unpin" : "Pin to top"} title={v.pinned ? "Unpin" : "Pin to top"}>
          {v.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" disabled={first} onClick={() => canvas.moveView(v.id, -1)} aria-label="Move up">
          <ArrowUp className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" disabled={last} onClick={() => canvas.moveView(v.id, 1)} aria-label="Move down">
          <ArrowDown className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => canvas.removeView(v.id)} aria-label="Remove view">
          <X className="size-3" />
        </Button>
      </div>
      {v.pinned && <Pin className="absolute left-1.5 top-1.5 size-3 text-muted-foreground" aria-label="Pinned" />}
      <div className={cn(v.pinned && "pl-3")}>
        <ViewRenderer spec={s} renderFile={renderFile} onStatus={(st) => canvas.reportRender(v.id, st)} />
      </div>
      {status && !status.ok && <p className="sr-only">This view could not be drawn.</p>}
    </section>
  );
}

function statusTone(r: BrowserRun) {
  if (r.status === "completed") return "bg-positive/15 text-positive";
  if (r.status === "failed" || r.status === "error") return "bg-negative/15 text-negative";
  if (r.done) return "bg-muted text-muted-foreground";
  return "bg-chart-1/15 text-foreground";
}

function BrowserCard({ r, single }: { r: BrowserRun; single: boolean }) {
  const [control, setControl] = useState(false);
  const live = r.liveUrl && !r.done ? (() => {
    try {
      const u = new URL(r.liveUrl);
      if (!control) {
        u.searchParams.set("readOnly", "true");
        u.searchParams.set("ui", "false");
      }
      return u.toString();
    } catch {
      return null;
    }
  })() : null;
  const steps = (r.steps ?? []).slice(single ? -10 : -5);
  return (
    <section className="step-in min-w-0 overflow-hidden rounded-lg border bg-card shadow-paper" aria-label={`Browser: ${r.goal}`}>
      <header className="flex items-center gap-2 border-b px-2.5 py-1.5">
        {r.done ? <AppWindow className="size-3.5 text-muted-foreground" /> : <PixelGrid variant="Orbit" />}
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium" title={r.goal}>{r.goal}</p>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", statusTone(r))}>{r.status}</span>
        {!r.done && (
          <>
            <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => setControl((c) => !c)} aria-pressed={control} title={control ? "Back to view only" : "Take control of this browser"} aria-label="Take control">
              <Hand className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Stop browser" title="Stop"
              onClick={() => browserStop({ data: { id: r.id, token: r.token } }).then(() => canvas.upsertRuns([{ id: r.id, status: "cancelled", done: true }])).catch(() => {})}>
              <Square className="size-2.5 fill-current" />
            </Button>
          </>
        )}
      </header>
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{r.currentUrl ?? (r.done ? "—" : "starting…")}</span>
        {r.currentUrl && (
          <a href={r.currentUrl} target="_blank" rel="noreferrer" className="shrink-0 hover:text-foreground" aria-label="Open page in a new tab">
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {live ? (
        <div className={cn("relative w-full bg-muted/30", single ? "aspect-[16/10]" : "aspect-video")}>
          <iframe src={live} title={`Live browser: ${r.goal}`} className={cn("absolute inset-0 size-full border-0", !control && "pointer-events-none")} allow="autoplay; clipboard-read; clipboard-write" referrerPolicy="no-referrer" />
        </div>
      ) : !r.done ? (
        <div className={cn("grid w-full place-items-center bg-muted/30", single ? "aspect-[16/10]" : "aspect-video")}>
          <LoadingState label="Launching browser" variant="Orbit" since={r.startedAt} />
        </div>
      ) : null}
      {steps.length > 0 && (
        <ol className="grid gap-0.5 border-t p-2 text-[11px]">
          {steps.map((s) => (
            <li key={s.id} className="flex min-w-0 items-baseline gap-1.5">
              <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", s.status === "completed" ? "bg-positive/70" : s.status === "error" ? "bg-negative/70" : "bg-foreground/50")} />
              <span className="min-w-0 truncate font-mono text-muted-foreground" title={s.input}>{s.input.replace(/\s+/g, " ")}</span>
            </li>
          ))}
        </ol>
      )}
      {(r.result || r.texts?.length || r.error) && (
        <div className="border-t p-2.5 text-[12px]">
          {r.error && <p className="text-negative">{r.error}</p>}
          {(r.result || r.texts?.length) && <ResearchMarkdown className="text-[12px] leading-relaxed">{r.result ?? r.texts![r.texts!.length - 1]}</ResearchMarkdown>}
          {r.costUsd && <p className="mt-1 font-mono text-[10px] text-muted-foreground">cost ${Number(r.costUsd).toFixed(4)}</p>}
        </div>
      )}
    </section>
  );
}

/** Polls active runs while the canvas is mounted, so the browser tab stays live between agent calls. */
function useRunPolling(runs: BrowserRun[]) {
  const active = runs.filter((r) => !r.done && r.token);
  const key = active.map((r) => r.id).join(",");
  const busy = useRef(false);
  useEffect(() => {
    if (!key) return;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const now = canvas.get().runs.filter((r) => !r.done && r.token);
        if (!now.length) return;
        const res = await browserStatus({ data: { runs: now.map((r) => ({ id: r.id, token: r.token })) } });
        canvas.upsertRuns(res.runs as Partial<BrowserRun>[]);
      } catch {
        /* next tick */
      } finally {
        busy.current = false;
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [key]);
}

function BrowserTab({ runs }: { runs: BrowserRun[] }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    browserConfigured()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(null));
  }, []);
  if (configured === false)
    return (
      <Empty icon={<AppWindow className="size-5" />} title="Web browser not configured">
        Add a <code className="rounded bg-muted px-1 font-mono text-[11px]">BROWSER_USE_API_KEY</code> secret to the project to let the assistant drive real browsers here.
      </Empty>
    );
  if (!runs.length)
    return (
      <Empty icon={<AppWindow className="size-5" />} title="No browsers yet">
        Ask the assistant to browse a site, download a report or check something visually. Up to four browsers run side by side.
      </Empty>
    );
  return (
    <div className={cn("grid grid-cols-1 gap-3", runs.length > 1 && "@3xl:grid-cols-2")}>
      {[...runs].reverse().map((r) => (
        <BrowserCard key={r.id} r={r} single={runs.length === 1} />
      ))}
    </div>
  );
}

function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <p className="mt-3 text-[13px] font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export function Canvas({ onClose }: { onClose: () => void }) {
  const st = useCanvas();
  useRunPolling(st.runs);
  const views = orderedViews(st.views);
  const tabs = [
    { id: "views" as const, label: "Views", n: st.views.length, icon: <LayoutDashboard className="size-3.5" /> },
    { id: "browser" as const, label: "Browser", n: st.runs.length, icon: <AppWindow className="size-3.5" /> },
    { id: "files" as const, label: "Files", n: st.files.length, icon: <FileText className="size-3.5" /> },
  ];
  const liveRuns = st.runs.filter((r) => !r.done).length;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-muted/20">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-2" role="tablist" aria-label="Canvas">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={st.tab === t.id} onClick={() => canvas.setTab(t.id)}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors", st.tab === t.id ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t.icon}
            {t.label}
            {t.n > 0 && <span className={cn("num rounded px-1 text-[10px] tabular-nums", st.tab === t.id ? "bg-ink-foreground/15" : "bg-muted")}>{t.n}</span>}
            {t.id === "browser" && liveRuns > 0 && <span className="size-1.5 animate-[pulse-dot_1s_ease-in-out_infinite] rounded-full bg-positive" aria-label={`${liveRuns} live`} />}
          </button>
        ))}
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Collapse canvas" title="Collapse canvas">
          <X />
        </Button>
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {st.tab === "views" &&
          (views.length || st.building ? (
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
              {views.map((v, i) => (
                <ViewCard key={v.id} v={v} first={i === 0} last={i === views.length - 1} />
              ))}
              {st.building && (
                <div className="step-in grid min-h-40 place-items-center rounded-lg border border-dashed bg-card/50 @xl:col-span-2" aria-live="polite">
                  <LoadingState label={st.building === "Building view" ? "Building view" : `Building ${st.building}`} variant="Drive" />
                </div>
              )}
            </div>
          ) : (
            <Empty icon={<LayoutDashboard className="size-5" />} title="Nothing rendered yet">
              Ask for a dashboard, a comparison or a model, and the assistant lays out KPI tiles, charts and tables here. Pin the ones you want to keep on top.
            </Empty>
          ))}
        {st.tab === "browser" && <BrowserTab runs={st.runs} />}
        {st.tab === "files" &&
          (st.files.length ? (
            <div className="grid grid-cols-1 gap-2 @3xl:grid-cols-2">
              {[...st.files].reverse().map((f) => (
                <FileCard key={f.id} f={f} />
              ))}
            </div>
          ) : (
            <Empty icon={<FileText className="size-5" />} title="No files yet">
              CSV, Excel, Markdown and JSON files the assistant makes, and files its browsers download, show up here.
            </Empty>
          ))}
      </div>
    </div>
  );
}
