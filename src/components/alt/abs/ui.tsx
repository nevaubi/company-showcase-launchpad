// Small pieces the Securitized credit view shares: a label with its definition on hover, a figure that
// opens where it comes from, links to EDGAR, sortable column heads and quiet notes.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { indexUrl } from "@/lib/abs/edgar";
import type { Definition } from "@/lib/abs/view/definitions";
import { bytes, count, shortHash } from "@/lib/abs/view/format";

/** A label with the definition of the figure behind it, on hover and on keyboard focus. */
export function Help({ def, children, className }: { def: Definition | null; children: ReactNode; className?: string }) {
  if (!def) return <span className={className}>{children}</span>;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs border bg-popover px-3 py-2 text-left text-popover-foreground shadow-md">
        <p className="text-[12px] font-semibold">{def.label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {def.kind === "derived" ? "Derived by this page" : "Stored figure"} · {def.unit}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed">{def.what}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Where a figure on the page comes from. */
export type Trace = {
  label: string;
  /** the figure as the page prints it, with its unit */
  shown: string;
  /** the stored text, or the formula of a derived figure */
  stored?: string;
  accession: string;
  /** a CIK under which EDGAR lists the filing */
  cik: number | null;
  form?: string;
  filed?: string;
  /** the period the records state */
  period?: string | null;
  metric?: string;
  bucket?: string;
  n?: number;
  missing?: number;
  /** for a derived share: numerator and denominator as printed */
  parts?: { label: string; value: string }[];
  file?: { name: string; bytes: number | null; sha256: string | null } | null;
  definition?: Definition | null;
};

/** A figure that opens its trace: filing, asset file, stored figure, records behind it and left out. */
export function Traced({ trace, children, className }: { trace: Trace | null; children: ReactNode; className?: string }) {
  if (!trace) return <span className={className}>{children}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${trace.label}: ${trace.shown}. Show where this figure comes from`}
          className={cn(
            "num rounded-sm text-inherit transition-colors duration-150 hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 text-[12px]" data-agent-ignore>
        <TraceBody trace={trace} />
      </PopoverContent>
    </Popover>
  );
}

function TraceBody({ trace }: { trace: Trace }) {
  const rows: [string, ReactNode][] = [];
  if (trace.stored != null) rows.push(["Stored", <span className="num break-all">{trace.stored}</span>]);
  for (const p of trace.parts ?? []) rows.push([p.label, <span className="num">{p.value}</span>]);
  if (trace.metric) rows.push(["Figure", <code className="text-[11px]">{trace.metric}{trace.bucket ? ` · ${trace.bucket}` : ""}</code>]);
  if (trace.n != null)
    rows.push([
      "Records",
      <span className="num">
        {count(trace.n)} counted{trace.missing ? `, ${count(trace.missing)} left out (field blank or unreadable)` : ""}
      </span>,
    ]);
  rows.push(["Filing", <span className="num">{trace.accession}{trace.form ? ` · ${trace.form}` : ""}{trace.filed ? ` · filed ${trace.filed}` : ""}</span>]);
  if (trace.period) rows.push(["Records' period", <span className="num">{trace.period}</span>]);
  if (trace.file)
    rows.push([
      "Asset file",
      <span className="num">
        {trace.file.name} · {bytes(trace.file.bytes)}
        {trace.file.sha256 && (
          <span className="mt-0.5 block break-all text-[10.5px] text-muted-foreground">SHA-256 {trace.file.sha256}</span>
        )}
      </span>,
    ]);
  return (
    <div className="grid gap-2">
      <div>
        <p className="text-[13px] font-semibold">{trace.label}</p>
        <p className="num text-[13px]">{trace.shown}</p>
      </div>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-[11.5px]">{v}</dd>
          </div>
        ))}
      </dl>
      {trace.definition && <p className="border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">{trace.definition.what}</p>}
      {trace.cik != null && (
        <SecLink href={indexUrl(trace.cik, trace.accession)} className="text-[11.5px]">
          Filing index on sec.gov
        </SecLink>
      )}
    </div>
  );
}

/** An outside link to SEC, marked as one. */
export function SecLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <ExternalLink className="size-3 opacity-60" aria-hidden />
    </a>
  );
}

/** The EDGAR list of a filer's ABS-EE filings. */
export const edgarFilerUrl = (cik: number) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, "0")}&type=ABS-EE&dateb=&owner=include&count=40`;

/** A column head that sorts; the arrow shows the direction of the sort in force. */
export function SortHead({
  active,
  dir,
  onClick,
  children,
  align = "right",
  className,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-8 px-2 align-bottom font-normal", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex min-h-7 items-end gap-0.5 rounded-sm text-[11px] leading-tight text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse text-right",
          active && "text-foreground",
        )}
      >
        <span>{children}</span>
        {active ? (
          dir === "asc" ? <ArrowUp className="mb-0.5 size-3 shrink-0" aria-hidden /> : <ArrowDown className="mb-0.5 size-3 shrink-0" aria-hidden />
        ) : (
          <span className="size-3 shrink-0" aria-hidden />
        )}
      </button>
    </th>
  );
}

/** A quiet line of explanation. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** A small marker beside a filing or a deal. */
export function Tag({ children, tone = "muted", title }: { children: ReactNode; tone?: "muted" | "warn"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 text-[10.5px] leading-none whitespace-nowrap",
        tone === "warn" ? "border-warning/40 bg-warning-soft text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** The SHA-256 of a file: shortened, the whole value on hover. */
export function Hash({ sha256 }: { sha256: string | null }) {
  if (!sha256) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="num cursor-default" title={`SHA-256 ${sha256}`}>
      {shortHash(sha256)}
    </span>
  );
}
