import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock3, Download, Eye, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, Search } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIrDownload, getIrImages, type IrDocRow } from "@/lib/ir.functions";
import { mergeStore, STORE_PREFIX, storeUrl, type StoreDoc } from "@/lib/ir/store";
import { fmtDate } from "@/lib/format";
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

/** Human title: filenames like "a8-kex991q4202609262026" become "Earnings release · Sep 2026". */
export function docTitle(d: Pick<IrDocRow, "title" | "period" | "filed" | "kind">) {
  const t = d.title?.trim() ?? "";
  const looksLikeFile = !t || /\d{5,}|^(ex|d)\d|ex[-_ ]?99|^[a-z0-9]+[_-][a-z0-9_-]+$/i.test(t) || !/\s/.test(t);
  if (!looksLikeFile) return t;
  const when = d.period ? fmtDate(d.period, { month: "short", year: "numeric" }) : d.filed ? fmtDate(d.filed, { month: "short", year: "numeric" }) : "";
  return [KIND_ONE[d.kind] ?? "Document", when].filter(Boolean).join(" · ");
}

function KindIcon({ ext }: { ext: string | null }) {
  if (/^(xlsx?|xlsm|csv)$/.test(ext ?? "")) return <FileSpreadsheet className="size-4 shrink-0 text-positive" />;
  if (/^pptx?$/.test(ext ?? "")) return <Presentation className="size-4 shrink-0 text-chart-3" />;
  if (/^(jpe?g|png|gif)$/.test(ext ?? "")) return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />;
  return <FileText className="size-4 shrink-0 text-muted-foreground" />;
}

const yearOf = (d: IrDocRow) => (d.filed ?? d.period ?? "").slice(0, 4);

export function IrLibrary({
  ticker,
  documents: own,
  images = 0,
  store = [],
}: {
  ticker: string;
  documents: IrDocRow[];
  images?: number;
  /** Filed Under pipeline store documents (ir/{T}.json); rows already in the app library are skipped. */
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
  const list = documents.filter(
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

  return (
    <Panel
      title="IR document library"
      subtitle={`${(files.length + images).toLocaleString()} files stored permanently${images ? ` (${images.toLocaleString()} slide images)` : ""}${extra.length ? ` (${extra.length.toLocaleString()} from the Filed Under document store)` : ""} · ${(total / 1e6).toFixed(1)} MB of documents · ${read.toLocaleString()} read for data · earnings releases, supplements, presentations and data files from EDGAR and the IR website`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Document type" value={kind} onChange={(v) => (setKind(v), setLimit(150))} options={[{ v: "all", l: "All" }, ...kinds.map((k) => ({ v: k, l: KIND_LABEL[k] ?? k }))]} size="xs" />
          {kind === "all" && images > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowImages((x) => !x)}>
              {wantImages && imgQ.isLoading ? "Loading images…" : showImages ? "Hide images" : `Show ${images.toLocaleString()} images`}
            </Button>
          )}
        </div>
      }
    >
      {years.length > 1 && (
        <div className="border-b px-4 pb-2 pt-3">
          <div className="flex items-end gap-[3px]" role="group" aria-label="Documents by year">
            {years.map(([y, n]) => (
              <Tooltip key={y} delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setYear((cur) => (cur === y ? null : y))}
                    aria-pressed={year === y}
                    aria-label={`${y}: ${n} documents`}
                    className="group flex min-w-0 flex-1 flex-col items-center gap-1"
                  >
                    <span
                      className={cn("w-full rounded-sm bg-chart-1/25 transition-colors group-hover:bg-chart-1/60", year === y && "bg-chart-1")}
                      style={{ height: 6 + (n / maxYear) * 34 }}
                    />
                    <span className={cn("num text-[9px] text-muted-foreground", year === y && "font-semibold text-foreground")}>’{y.slice(2)}</span>
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
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" className="h-8 pl-7 text-xs" aria-label="Search documents" />
        </div>
        <span className="text-xs text-muted-foreground">
          {list.length.toLocaleString()} shown{year ? ` · ${year}` : ""}
        </span>
        {year && (
          <Button size="sm" variant="ghost" onClick={() => setYear(null)}>
            Clear year
          </Button>
        )}
      </div>
      {!list.length ? (
        <p className="p-5 text-sm text-muted-foreground">{documents.length ? "No documents match these filters." : "No stored documents yet — the collector adds files for each company in rotation."}</p>
      ) : (
        <ul className="divide-y">
          {list.slice(0, limit).map((d) => (
            <li key={d.id} className="flex min-w-0 items-center gap-3 px-4 py-2">
              <KindIcon ext={d.ext} />
              <button onClick={() => view(d)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm hover:underline">{docTitle(d)}</p>
                <p className="num truncate text-[11px] text-muted-foreground">
                  {d.filed ? fmtDate(d.filed) : "IR website"} · {d.exhibit ?? (d.ext ?? "").toUpperCase()}
                  {d.pages ? ` · ${d.pages} pp` : ""} · {((d.bytes ?? 0) / 1024).toFixed(0)} KB
                </p>
              </button>
              <ReadState d={d} />
              <Badge variant="outline" className="hidden sm:inline-flex">
                {KIND_LABEL[d.kind] ?? d.kind}
              </Badge>
              <Button size="icon-sm" variant="ghost" aria-label={d.viewable ? "Open stored copy" : "Open original file"} onClick={() => view(d)} className="hidden sm:inline-flex">
                <Eye />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Download stored copy" onClick={() => save(d)}>
                <Download />
              </Button>
            </li>
          ))}
          {list.length > limit && (
            <li className="px-4 py-3 text-center">
              <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 300)}>
                Show more ({(list.length - limit).toLocaleString()} remaining)
              </Button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

function ReadState({ d }: { d: IrDocRow }) {
  if (d.extract_status?.startsWith("ok"))
    return (
      <Tooltip>
        <TooltipTrigger className="hidden items-center gap-1 text-[11px] text-positive sm:inline-flex">
          <CheckCircle2 className="size-3.5" />
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
