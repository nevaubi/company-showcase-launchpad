// The checks behind the IR tab's tie-out badge, in a side panel: what was read, the SEC comparison, and
// every figure that needs a second look (totals whose parts don't add up, failed read-time checks, figures
// held back, figures another document prints differently), each with its numbers and its source. The
// statements keep only a quiet mark at such a figure.
import { useMemo, type ReactNode } from "react";
import { Check } from "lucide-react";
import { IrChecksLine } from "@/components/ir/checks";
import { AltMark, CheckDot, HeldMark } from "@/components/ir/marks";
import { IR } from "@/components/ir/typography";
import { openIrCell } from "@/components/ir/breakdowns";
import { useSource } from "@/components/source/source-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ConsistencySummary } from "@/lib/ir/consistency";
import { periodLong } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import type { SecCheck } from "@/lib/ir/sec-check";
import { assembleStatements, lineLabel } from "@/lib/ir/statements";
import { cn } from "@/lib/utils";

/** Items per list before the rest is counted. */
const CAP = 150;
const KIND_NAME: Record<string, string> = { "press-release": "earnings release", supplement: "supplement", presentation: "presentation", data: "data file", other: "document" };

interface Item {
  s: PayloadSeries;
  e: string;
  kind: "q" | "y";
  c: PayloadCell;
  text: string;
}

/** A checked figure: money in millions as most tables print it, other units as stored. */
const amount = (v: number, unit: string) => (unit === "usd" ? `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M` : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

export function IrChecksDrawer({
  open,
  onOpenChange,
  ticker,
  payload,
  section,
  check,
  consistency,
  late,
  timings,
  stats,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticker: string;
  payload: IrPayload;
  /** a section id to show only that section's figures */
  section?: string;
  check?: SecCheck | null;
  consistency?: ConsistencySummary;
  late?: boolean;
  timings?: { unpackMs: number; tidyMs: number; checkMs: number };
  stats: { label: string; value: string; hint?: string }[];
}) {
  const src = useSource();
  const sec = useMemo(() => (section && open ? assembleStatements(payload).find((s) => s.id === section) : undefined), [payload, section, open]);
  const lists = useMemo(() => {
    if (!open) return null;
    const keys = sec ? new Set(sec.keys) : null;
    const byKey = new Map(payload.series.map((s) => [s.k, s]));
    const failed: Item[] = [];
    for (const ck of payload.checks) {
      if (ck.ok || ck.partial || (keys && !keys.has(ck.k))) continue;
      const s = byKey.get(ck.k);
      const kind = ck.kind === "fy" ? "y" : "q";
      const c = s && (kind === "q" ? s.q : s.y)[ck.e];
      if (s && c) failed.push({ s, e: ck.e, kind, c, text: `parts add up to ${amount(ck.sum, s.unit)}, the printed total is ${amount(ck.total, s.unit)} (difference ${amount(ck.sum - ck.total, s.unit)})` });
    }
    const flagged: Item[] = [];
    const held: Item[] = [];
    const alt: Item[] = [];
    for (const s of payload.series) {
      if (keys && !keys.has(s.k)) continue;
      for (const kind of ["q", "y"] as const) {
        for (const [e, c] of Object.entries(kind === "q" ? s.q : s.y)) {
          for (const f of c.flags ?? []) flagged.push({ s, e, kind, c, text: f.why });
          if (c.alt) {
            const doc = c.alt.d != null ? payload.docs[c.alt.d] : undefined;
            alt.push({ s, e, kind, c, text: `shown ${amount(c.v, s.unit)}; ${c.alt.kind === "restated" ? "an earlier" : "another"} ${KIND_NAME[doc?.kind ?? ""] ?? "document"}${doc?.filed ? ` filed ${doc.filed}` : ""} prints ${amount(c.alt.v, s.unit)}` });
          }
        }
        for (const [e, c] of Object.entries((kind === "q" ? s.held?.q : s.held?.y) ?? {})) held.push({ s, e, kind, c, text: c.why ?? "unit, sign or period contradicted by the documents" });
      }
    }
    const newest = (a: Item, b: Item) => b.e.localeCompare(a.e) || a.s.label.localeCompare(b.s.label);
    return { failed: failed.sort(newest), flagged: flagged.sort(newest), held: held.sort(newest), alt: alt.sort(newest) };
  }, [open, payload, sec]);

  const openItem = (x: Item) => openIrCell(src.open, ticker, payload, x.s, x.e, x.kind, x.c);
  const list = (title: string, items: Item[], mark: ReactNode, note: string) =>
    items.length > 0 && (
      <section className="border-t px-4 py-3" data-section={`IR checks: ${title}`}>
        <h3 className={IR.group}>
          {title} <span className={cn("font-normal", IR.caption)}>· {items.length.toLocaleString()}</span>
        </h3>
        <p className={cn("mb-1.5", IR.caption)}>{note}</p>
        <ul className="grid grid-cols-1 gap-0.5">
          {items.slice(0, CAP).map((x, i) => (
            <li key={`${x.s.k}|${x.kind}|${x.e}|${i}`}>
              <button type="button" onClick={() => openItem(x)} className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left text-[12px] hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="shrink-0 translate-y-[-1px]">{mark}</span>
                <span className="min-w-0">
                  <span className="font-medium">{lineLabel(x.s)}</span>
                  <span className="text-muted-foreground">, {periodLong(x.c.m === 0 && x.c.e ? x.c.e : x.e, x.kind, x.c.m)}: </span>
                  {x.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {items.length > CAP && <p className={cn("mt-1", IR.caption)}>{(items.length - CAP).toLocaleString()} more, in the Excel workbook's checks sheet.</p>}
      </section>
    );
  const none = lists && !lists.failed.length && !lists.flagged.length && !lists.held.length && !lists.alt.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl" data-section="IR checks panel">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="text-sm font-semibold">{sec ? `Checks: ${sec.title}` : "Checks"}</SheetTitle>
          <SheetDescription className="text-xs">
            Every figure is read from a stored document and checked where it can be: parts against their printed total, quarters against the year, calculated values against their parts, consolidated lines against the 10-Q and 10-K. Nothing is corrected. Click an item to open its source.
          </SheetDescription>
        </SheetHeader>
        {!sec && (
          <dl className="grid grid-cols-2 gap-px border-b bg-border">
            {stats.map((x, i) => (
              <div key={x.label} className={cn("min-w-0 bg-background px-4 py-2.5", i === stats.length - 1 && stats.length % 2 === 1 && "col-span-2")}>
                <dt className={IR.caption}>{x.label}</dt>
                <dd className="num text-[15px] font-semibold leading-6">{x.value}</dd>
                {x.hint && <dd className={cn("num truncate", IR.caption)}>{x.hint}</dd>}
              </div>
            ))}
          </dl>
        )}
        {!sec && <IrChecksLine ticker={ticker} payload={payload} check={check} consistency={consistency} timings={timings} late={late} />}
        {!sec && payload.stats.ttm ? (
          <p className={cn("border-t px-4 py-2", IR.caption)} data-section="IR trailing twelve months">
            {payload.stats.ttm.toLocaleString()} trailing-twelve-month figure{payload.stats.ttm === 1 ? "" : "s"} (twelve months that end off the fiscal year, or printed as TTM or LTM) {payload.stats.ttm === 1 ? "is" : "are"} left out of the year and quarter columns, so none is read as a fiscal year or a quarter.
          </p>
        ) : null}
        {lists && (
          <>
            {list("Totals whose parts don't add up", lists.failed, <CheckDot />, "The printed parts of the total, summed, against the printed total.")}
            {list("Figures that fail a check", lists.flagged, <CheckDot />, "Against the 10-Q or 10-K, the year, or the formula of a calculated value. The figure stays, marked.")}
            {list("Figures held back", lists.held, <HeldMark />, "Their unit, sign or period is contradicted by the documents or the filing: never summed, charted or exported.")}
            {list("Printed differently in another document", lists.alt, <AltMark />, "The newest printing is shown; the other stays one click away.")}
            {none && (
              <p className="flex items-center gap-2 border-t px-4 py-3 text-[13px]">
                <Check className="size-3.5 text-positive" /> No figure {sec ? "in this section " : ""}fails a check.
              </p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
