import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Minus, Plus, ScanSearch, TriangleAlert } from "lucide-react";
import { getFilingDocument } from "@/lib/sec.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FactLocator {
  concept?: string;
  start?: string;
  end?: string;
  value?: number;
  unit?: string;
  elementId?: string;
  /** Free-text search when there is no structured fact */
  search?: string;
  /** Table cell (document-order table, row and cell indexes) for press releases and other non-XBRL exhibits */
  cell?: { t: number; r: number; c: number };
}

export type LocateStatus =
  | { kind: "idle" }
  | { kind: "exact"; count: number; how: string }
  | { kind: "text"; count: number; query: string }
  | { kind: "missing"; quote?: boolean };

const secBase = (cik: string, accn: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/`;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildSrcDoc(raw: string, base: string, contentType: string) {
  const hl = cssVar("--highlight", "oklch(0.9 0.16 98)");
  const soft = cssVar("--highlight-soft", "oklch(0.955 0.085 100)");
  const ink = cssVar("--foreground", "oklch(0.19 0.012 260)");
  const style = `<style>
    html{background:#fff}
    body{margin:0 auto!important;padding:28px 32px 120px!important;max-width:100%!important;box-sizing:border-box;color:#111;scroll-behavior:smooth}
    img{max-width:100%;height:auto}
    table{max-width:100%}
    .fu-hl{background:${hl}!important;outline:2px solid ${ink};outline-offset:2px;border-radius:2px;transition:outline-color .6s}
    .fu-hl-row td,.fu-hl-row th{background:${soft}!important}
    mark.fu-hl{color:inherit;padding:0 1px}
    @keyframes fuFlash{0%{box-shadow:0 0 0 0 ${hl}}50%{box-shadow:0 0 0 10px ${hl}}100%{box-shadow:0 0 0 0 transparent}}
    .fu-flash{animation:fuFlash 1.2s ease-out 2}
  </style>`;
  if (!/html/i.test(contentType) && !/<html|<body|<div|<table/i.test(raw.slice(0, 5000))) {
    const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<!doctype html><html><head><base href="${base}" target="_blank">${style}</head><body><pre style="white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace">${esc}</pre></body></html>`;
  }
  let html = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/<meta[^>]+http-equiv[^>]*>/gi, "");
  const head = `<base href="${base}" target="_blank">${style}`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  else html = `<head>${head}</head>${html}`;
  return html;
}

function isHidden(el: Element) {
  let n: Element | null = el;
  while (n) {
    const tag = n.tagName.toLowerCase();
    if (tag === "ix:header") return true;
    const style = (n as HTMLElement).style;
    if (style && style.display === "none") return true;
    n = n.parentElement;
  }
  return false;
}

function contextMatches(ctx: Element | null, start?: string, end?: string) {
  if (!ctx) return false;
  if (ctx.getElementsByTagName("xbrldi:explicitMember").length || ctx.getElementsByTagName("xbrldi:typedMember").length)
    return false;
  const text = (t: string) => ctx.getElementsByTagName(t)[0]?.textContent?.trim();
  const s = text("xbrli:startDate");
  const e = text("xbrli:endDate");
  const i = text("xbrli:instant");
  if (start) return s === start && e === end;
  return i === end || (!s && e === end);
}

function candidatesForValue(value: number, unit?: string): string[] {
  const fmt = (x: number, d = 0) =>
    Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (unit === "usdPerShare") return [fmt(value, 2)];
  if (unit === "shares") return [fmt(value / 1e6), fmt(value / 1e3), fmt(value), fmt(value / 1e6, 1)];
  return [fmt(value / 1e6), fmt(value / 1e3), fmt(value / 1e9, 1), fmt(value)].filter((s) => s !== "0");
}

function markText(doc: Document, query: string, limit = 40): HTMLElement[] {
  const marks: HTMLElement[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const lower = query.toLowerCase();
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    if (t.data.toLowerCase().includes(lower) && !isHidden(t.parentElement!)) nodes.push(t);
    if (nodes.length >= limit) break;
  }
  for (const t of nodes) {
    const idx = t.data.toLowerCase().indexOf(lower);
    if (idx < 0) continue;
    const range = doc.createRange();
    range.setStart(t, idx);
    range.setEnd(t, idx + query.length);
    const mark = doc.createElement("mark");
    mark.className = "fu-hl";
    try {
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      /* crossing element boundaries — skip */
    }
  }
  return marks;
}

const norm = (s: string) =>
  s
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Phrase spread across inline elements: highlight the smallest block that contains it. */
function markBlock(doc: Document, query: string): HTMLElement[] {
  const q = norm(query);
  if (q.length < 8) return [];
  const blocks = Array.from(doc.body.querySelectorAll<HTMLElement>("p, li, td, div, span, font"));
  const hits = blocks.filter((el) => !isHidden(el) && norm(el.textContent ?? "").includes(q));
  const smallest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  smallest.slice(0, 5).forEach((el) => el.classList.add("fu-hl"));
  return smallest.slice(0, 5);
}

export function FilingViewer({
  cik,
  accn,
  doc,
  locator,
  className,
  onStatus,
}: {
  cik: string;
  accn: string;
  doc: string;
  locator?: FactLocator;
  className?: string;
  onStatus?: (s: LocateStatus) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [hits, setHits] = useState<HTMLElement[]>([]);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(0.9);
  const [status, setStatus] = useState<LocateStatus>({ kind: "idle" });

  const q = useQuery({
    queryKey: ["filing-doc", cik, accn, doc],
    queryFn: () => getFilingDocument({ data: { cik: String(Number(cik)), accn, doc } }),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  const srcDoc = useMemo(
    () => (q.data ? buildSrcDoc(q.data.html, secBase(cik, accn), q.data.contentType) : undefined),
    [q.data, cik, accn],
  );

  const report = useCallback(
    (s: LocateStatus) => {
      setStatus(s);
      onStatus?.(s);
    },
    [onStatus],
  );

  const focusHit = useCallback((list: HTMLElement[], i: number) => {
    const el = list[i];
    if (!el) return;
    list.forEach((h) => h.classList.remove("fu-flash"));
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("fu-flash");
  }, []);

  const locate = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d?.body) return;
    d.body.style.setProperty("zoom", String(zoom));
    d.querySelectorAll(".fu-hl").forEach((e) => e.classList.remove("fu-hl"));
    d.querySelectorAll(".fu-hl-row").forEach((e) => e.classList.remove("fu-hl-row"));
    if (!locator) {
      report({ kind: "idle" });
      return;
    }
    let found: HTMLElement[] = [];
    let how = "";
    if (locator.cell) {
      const table = d.querySelectorAll("table")[locator.cell.t] as HTMLTableElement | undefined;
      const el = table?.rows[locator.cell.r]?.cells[locator.cell.c] as HTMLElement | undefined;
      if (el) {
        found = [el];
        how = `table ${locator.cell.t + 1}, row ${locator.cell.r + 1}`;
      }
    }
    if (!found.length && locator.elementId) {
      const el = d.getElementById(locator.elementId);
      if (el) {
        found = [el];
        how = `iXBRL fact #${locator.elementId}`;
      }
    }
    if (!found.length && locator.concept) {
      const contexts = new Map<string, Element>();
      for (const c of Array.from(d.getElementsByTagName("xbrli:context"))) {
        const id = c.getAttribute("id");
        if (id) contexts.set(id, c);
      }
      const facts = Array.from(d.getElementsByTagName("ix:nonFraction")) as HTMLElement[];
      found = facts.filter(
        (f) =>
          f.getAttribute("name") === locator.concept &&
          contextMatches(contexts.get(f.getAttribute("contextref") ?? f.getAttribute("contextRef") ?? "") ?? null, locator.start, locator.end) &&
          !isHidden(f),
      );
      if (found.length) how = `iXBRL tag ${locator.concept}`;
    }
    if (found.length) {
      found.forEach((el) => {
        el.classList.add("fu-hl");
        el.closest("tr")?.classList.add("fu-hl-row");
      });
      setHits(found);
      setActive(0);
      focusHit(found, 0);
      report({ kind: "exact", count: found.length, how });
      return;
    }
    const queries = locator.search ? [locator.search] : locator.value != null ? candidatesForValue(locator.value, locator.unit) : [];
    for (const query of queries) {
      let marks = markText(d, query);
      if (!marks.length && locator.search) marks = markBlock(d, query);
      if (marks.length) {
        marks.forEach((m) => m.closest("tr")?.classList.add("fu-hl-row"));
        setHits(marks);
        setActive(0);
        focusHit(marks, 0);
        report({ kind: "text", count: marks.length, query });
        return;
      }
    }
    setHits([]);
    report({ kind: "missing", quote: !!locator.search });
  }, [locator, zoom, focusHit, report]);

  // Re-run when the locator changes on an already-loaded document.
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === "complete" && srcDoc) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locator?.concept, locator?.start, locator?.end, locator?.elementId, locator?.search, locator?.value, locator?.cell?.t, locator?.cell?.r, locator?.cell?.c]);

  useEffect(() => {
    const d = frame.current?.contentDocument;
    d?.body?.style.setProperty("zoom", String(zoom));
  }, [zoom]);

  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    const next = (active + dir + hits.length) % hits.length;
    setActive(next);
    focusHit(hits, next);
  };

  const url = `${secBase(cik, accn)}${doc}`;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b bg-card px-3 py-1.5">
        <StatusPill status={status} loading={q.isLoading} />
        <div className="ml-auto flex items-center gap-1">
          {hits.length > 1 && (
            <div className="mr-1 flex items-center gap-0.5">
              <span className="num mr-1 text-[11px] text-muted-foreground">
                {active + 1}/{hits.length}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous match">
                <ChevronUp />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next match">
                <ChevronDown />
              </Button>
            </div>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">
            <Minus />
          </Button>
          <span className="num w-9 text-center text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" asChild aria-label="Open on SEC.gov">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/60">
        {q.isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/80 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span>Retrieving {doc} from SEC EDGAR…</span>
          </div>
        )}
        {q.isError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-8 text-center text-sm">
            <TriangleAlert className="size-5 text-negative" />
            <p className="max-w-sm text-muted-foreground">{(q.error as Error).message}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                Try again
              </Button>
              <Button size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  Open on SEC.gov
                </a>
              </Button>
            </div>
          </div>
        )}
        {srcDoc && (
          <iframe
            ref={frame}
            title={`SEC filing ${accn}`}
            srcDoc={srcDoc}
            onLoad={locate}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="h-full w-full border-0 bg-card"
          />
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, loading }: { status: LocateStatus; loading: boolean }) {
  if (loading) return <span className="eyebrow">Loading document</span>;
  switch (status.kind) {
    case "exact":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
          <span className="size-2 rounded-full bg-positive" />
          Located {status.how}
          {status.count > 1 ? ` · ${status.count} places` : ""}
        </span>
      );
    case "text":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
          <ScanSearch className="size-3.5 text-muted-foreground" />
          <span className="max-w-[22rem] truncate">Matched “{status.query}”</span>
          {status.count > 1 ? ` · ${status.count} places` : ""}
        </span>
      );
    case "missing":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5" />
          {status.quote ? "Couldn't find the quoted passage" : "Couldn't pinpoint the value"} — showing the full document
        </span>
      );
    default:
      return <span className="eyebrow">Source document</span>;
  }
}
