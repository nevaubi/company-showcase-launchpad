import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock3, Download, Eye, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, Search } from "lucide-react";
import { toast } from "sonner";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { collapseDocCopies } from "@/lib/ir/dedupe";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrDownload, getIrImages, type IrDocRow } from "@/lib/ir.functions";
import { mergeStore, STORE_PREFIX, storeUrl, type StoreDoc } from "@/lib/ir/store";
import { EXT_PREFIX } from "@/lib/ir/external";
import { fmtDate } from "@/lib/format";
import { libraryTitle } from "@/lib/ir/display";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  "press-release": "Releases",
  presentation: "Presentations",
  supplement: "Supplements",
  data: "Data files",
  transcript: "Transcripts",
  image: "Images",
  report: "Reports",
  "annual-report": "Annual reports",
  proxy: "Proxy",
  "sec-copy": "SEC filings",
  other: "Other",
};
const KIND_ONE: Record<string, string> = {
  "press-release": "Earnings release",
  presentation: "Presentation",
  supplement: "Financial supplement",
  data: "Data file",
  transcript: "Transcript",
  image: "Image",
  report: "Report",
  "annual-report": "Annual report",
  proxy: "Proxy statement",
  "sec-copy": "SEC filing",
  other: "Exhibit",
};

/** Human title for a stored document (see `libraryTitle`). */
export const docTitle = (d: Pick<IrDocRow, "title" | "period" | "filed" | "kind">) => libraryTitle(d, KIND_ONE[d.kind] ?? "Document");

function KindIcon({ ext }: { ext: string | null }) {
  if (/^(xlsx?|xlsm|csv)$/.test(ext ?? "")) return <FileSpreadsheet className="size-4 shrink-0 text-positive" />;
  if (/^pptx?$/.test(ext ?? "")) return <Presentation className="size-4 shrink-0 text-chart-3" />;
  if (/^(jpe?g|png|gif)$/.test(ext ?? "")) return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />;
  return <FileText className="size-4 shrink-0 text-muted-foreground" />;
}

/** Calendar year a document was filed (or the year its period names: "Q1 FY26" → 2026). */
const yearOf = (d: IrDocRow) => {
  for (const x of [d.filed, d.period]) {
    if (!x) continue;
    const iso = x.match(/^(19|20)\d{2}/);
    if (iso) return iso[0];
    const full = x.match(/\b(19|20)\d{2}\b/);
    if (full) return full[0];
    const fy = x.match(/\bFY\s?(\d{2})\b/i);
    if (fy) return `20${fy[1]}`;
  }
  return "";
};

export function IrLibrary({
  ticker,
  documents: own,
  images = 0,
  store = [],
  embedded,
}: {
  embedded?: boolean;
  ticker: string;
  documents: IrDocRow[];
  images?: number;
  /** FiledUnder pipeline store documents (ir/{T}.json); rows already in the app library are skipped. */
  store?: StoreDoc[];
}) {
  const storeById = useMemo(() => new Map(store.map((d) => [`${STORE_PREFIX}${d.id}`, d])), [store]);
  const extra = useMemo(() => mergeStore(own, store), [own, store]);
  const files = useMemo(() => (extra.length ? [...own, ...extra] : own), [own, extra]);
  const { open } = useSource();
  const download = useServerFn(getIrDownload);
  const fetchImages = useServerFn(getIrImages);
  const [kind, setKind] = useState<string>("all");
  const [year, setYear] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showImages, setShowImages] = useState(false);
  const [limit, setLimit] = useState(150);
  // The whole list renders without a "show more" step: further rows follow in the background.

  const wantImages = images > 0 && (showImages || kind === "image");
  const imgQ = useQuery({ queryKey: ["ir-images", ticker], queryFn: () => fetchImages({ data: { ticker } }), enabled: wantImages, staleTime: 10 * 60_000 });
  const documents = useMemo(() => (wantImages && imgQ.data ? [...files, ...imgQ.data] : files), [files, imgQ.data, wantImages]);
  const kinds = useMemo(() => {
    const k = new Set(files.map((d) => d.kind));
    if (images) k.add("image");
    return [...k].sort((a, b) => (KIND_LABEL[a] ?? a).localeCompare(KIND_LABEL[b] ?? b));
  }, [files, images]);

  const years = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of documents) if (d.kind !== "image" && yearOf(d)) m.set(yearOf(d), (m.get(yearOf(d)) ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [documents]);
  const maxYear = Math.max(1, ...years.map(([, n]) => n));
  const q = query.trim().toLowerCase();
  const { docs: unique, copies } = useMemo(() => collapseDocCopies(documents), [documents]);
  const list = unique.filter(
    (d) =>
      (kind === "all" || d.kind === kind) &&
      (showImages || kind === "image" || d.kind !== "image") &&
      (!year || yearOf(d) === year) &&
      (!q || docTitle(d).toLowerCase().includes(q) || d.title.toLowerCase().includes(q)),
  );
  const total = files.reduce((n, d) => n + (d.bytes ?? 0), 0);
  const read = files.filter((d) => d.extract_status?.startsWith("ok")).length;

  const openStore = async (d: IrDocRow, mode: "view" | "save") => {
    const s = storeById.get(d.id);
    if (!s?.storage_path) {
      toast.error("This document isn't stored");
      return;
    }
    try {
      const url = await storeUrl(s.storage_path);
      if (mode === "view") window.open(url, "_blank", "noopener");
      else window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const view = async (d: IrDocRow) => {
    if (d.source === "store") {
      // A stored document with page text opens in the source panel, like the app's own copies.
      const s = storeById.get(d.id);
      if (s?.text_path) {
        open({ ticker, label: docTitle(d), unit: "usd", value: 0, doc: { accn: d.accn ?? "", doc: "", filed: d.filed ?? undefined, title: docTitle(d), irDoc: `${EXT_PREFIX}${s.id}` } });
        return;
      }
      await openStore(d, "view");
      return;
    }
    if (d.viewable) {
      open({ ticker, label: docTitle(d), unit: "usd", value: 0, doc: { accn: d.accn ?? "", doc: "", filed: d.filed ?? undefined, title: docTitle(d), irDoc: d.id } });
      return;
    }
    try {
      const { url } = await download({ data: { id: d.id } });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const save = async (d: IrDocRow) => {
    if (d.source === "store") {
      await openStore(d, "save");
      return;
    }
    try {
      const { url } = await download({ data: { id: d.id } });
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    if (limit >= list.length) return;
    const t = setTimeout(() => setLimit((n) => n + 300), 16);
    return () => clearTimeout(t);
  }, [limit, list.length]);

  const body = (
    <>
      <div className={cn("flex flex-wrap items-center gap-2 border-b px-4 py-2", IR.caption)}>
        <span>
          {(files.length + images).toLocaleString()} files stored permanently{images ? ` (${images.toLocaleString()} slide images)` : ""}
          {extra.length ? `, ${extra.length.toLocaleString()} from the FiledUnder document store` : ""} · {(total / 1e6).toFixed(1)} MB · {read.toLocaleString()} read for figures
          {copies.size ? ` · ${[...copies.values()].reduce((n, c) => n + c.length, 0).toLocaleString()} duplicate copies shown under the copy that was read` : ""}
        </span>
        <div data-agent-controls className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label="Document type" value={kind} onChange={(v) => (setKind(v), setLimit(150))} options={[{ v: "all", l: "All" }, ...kinds.map((k) => ({ v: k, l: KIND_LABEL[k] ?? k }))]} size="xs" />
          {kind === "all" && images > 0 && (
            <Button size="sm" variant="ghost" aria-pressed={showImages} onClick={() => setShowImages((x) => !x)}>
              {wantImages && imgQ.isLoading ? "Loading images…" : showImages ? "Hide images" : `Show ${images.toLocaleString()} images`}
            </Button>
          )}
        </div>
      </div>
      {years.length > 1 && (
        <div className="border-b px-4 pb-2 pt-3">
          <div className="flex items-end gap-[3px]" role="group" aria-label="Documents by year">
            {years.map(([y, n]) => (
              <Tooltip key={y} delayDuration={150}>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => setYear((cur) => (cur === y ? null : y))} aria-pressed={year === y} aria-label={`${y}: ${n} documents`} className="group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className={cn("w-full rounded-sm bg-muted-foreground/70 transition-colors duration-150 group-hover:bg-foreground/70 motion-reduce:transition-none", year === y && "bg-foreground")} style={{ height: 6 + (n / maxYear) * 30 }} />
                    <span className={cn("num text-[10px] text-muted-foreground", year === y && "font-semibold text-foreground")}>’{y.slice(2)}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {y}: {n} documents
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" className="h-8 pl-7 text-[13px]" aria-label="Search documents" />
        </div>
        <span className={IR.caption}>
          {list.length.toLocaleString()} shown{year ? ` · ${year}` : ""}
        </span>
        {year && (
          <Button size="sm" variant="ghost" onClick={() => setYear(null)}>
            Clear year
          </Button>
        )}
      </div>
      {!list.length ? (
        <p className="px-4 py-4 text-[13px] text-muted-foreground">{documents.length ? "No documents match these filters." : "No stored documents yet. The collector adds files for each company in rotation."}</p>
      ) : (
        <ul className="divide-y">
          {list.slice(0, limit).map((d) => {
            const dup = copies.get(d.id);
            return (
              <li key={d.id} className="flex min-w-0 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none">
                <KindIcon ext={d.ext} />
                <button type="button" onClick={() => view(d)} className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className={cn("truncate hover:underline", IR.row)}>{docTitle(d)}</p>
                  <p className={cn("num truncate", IR.caption)}>
                    {d.filed ? fmtDate(d.filed) : "IR website"} · {d.exhibit ?? (d.ext ?? "").toUpperCase()}
                    {d.pages ? ` · ${d.pages} pp` : ""} · {((d.bytes ?? 0) / 1024).toFixed(0)} KB
                    {dup ? ` · also stored as ${dup.map((c) => ((c as IrDocRow).ext ?? "copy").toUpperCase()).join(", ")}` : ""}
                  </p>
                </button>
                <ReadState d={d} />
                <Badge variant="outline" className="hidden rounded-sm sm:inline-flex">
                  {KIND_ONE[d.kind] ?? d.kind}
                </Badge>
                <Button size="icon-sm" variant="ghost" aria-label={d.viewable ? "Open stored copy" : "Open original file"} onClick={() => view(d)} className="hidden sm:inline-flex">
                  <Eye />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Download stored copy" onClick={() => save(d)}>
                  <Download />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  if (embedded) return body;
  return (
    <IrPanel section="Source documents" title="Stored documents" bodyClassName="p-0">
      {body}
    </IrPanel>
  );
}

function ReadState({ d }: { d: IrDocRow }) {
  if (d.extract_status?.startsWith("ok"))
    return (
      <Tooltip>
        <TooltipTrigger className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
          <CheckCircle2 className="size-3.5 text-positive" />
          <span className="num">{(d.extract_facts ?? 0).toLocaleString()}</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{(d.extract_facts ?? 0).toLocaleString()} data points read from this document</TooltipContent>
      </Tooltip>
    );
  if (!d.extract_status && d.viewable && ["press-release", "supplement", "presentation", "data", "other"].includes(d.kind))
    return (
      <Tooltip>
        <TooltipTrigger className="hidden items-center text-muted-foreground sm:inline-flex" aria-label="Waiting to be read">
          <Clock3 className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="text-xs">Waiting to be read</TooltipContent>
      </Tooltip>
    );
  return null;
}
