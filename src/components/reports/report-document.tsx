import { useMemo } from "react";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { BrandedCover, BRAND_FONT } from "@/components/firm/branded-cover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { citationOrder } from "@/lib/reports/vet";
import { compressRefs, readableDates, refCaption, refTarget } from "@/lib/reports/present";
import { KINDS } from "@/lib/reports/kinds";
import type { Claim, Fact, ReportContent, ReportTable, TableCell } from "@/lib/reports/types";
import { readableOn, resolveBranding, type FirmBranding } from "@/lib/firm/core";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const citeCls = "cite num inline-block rounded-sm px-px align-baseline text-[9.5px] font-semibold leading-[1.2] hover:bg-highlight-soft text-[color:var(--brand-link,var(--color-primary))] hover:underline";

function Cite({ ids, order, facts, ticker }: { ids: string[]; order: Map<string, number>; facts: Map<string, Fact>; ticker: string }) {
  const { open } = useSource();
  const items = ids.map((id) => ({ id, f: facts.get(id), n: order.get(id) })).filter((x): x is { id: string; f: Fact; n: number } => !!x.f && !!x.n).sort((a, b) => a.n - b.n);
  if (!items.length) return null;
  if (items.length === 1) {
    const { f, n } = items[0];
    const t = refTarget(f.ref, ticker, f.text);
    if (t) return <sup className="ml-0.5"><button type="button" onClick={() => open(t)} className={citeCls} title={f.text} aria-label={`Source ${n}: ${f.text}`}>{n}</button></sup>;
  }
  return (
    <sup className="ml-0.5 whitespace-nowrap">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={citeCls} aria-label={`Sources ${compressRefs(items.map((x) => x.n))}`}>{compressRefs(items.map((x) => x.n))}</button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-96 overflow-y-auto p-0 text-xs">
          <ul className="divide-y">
            {items.map(({ id, f, n }) => {
              const t = refTarget(f.ref, ticker, f.text);
              return (
                <li key={id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1 px-3 py-2">
                  <span className="num text-muted-foreground">{n}.</span>
                  <span>
                    <span className="block">{readableDates(f.text)}</span>
                    <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{refCaption(f.ref)}</span>
                    {t && <button type="button" onClick={() => open(t)} className="mt-1 inline-flex items-center gap-0.5 font-medium text-[color:var(--color-primary)] hover:underline">Open source <ExternalLink className="size-3" /></button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </sup>
  );
}

function ClaimText({ c, order, facts, ticker }: { c: Claim; order: Map<string, number>; facts: Map<string, Fact>; ticker: string }) {
  return <>{readableDates(c.text)}<Cite ids={c.factIds} order={order} facts={facts} ticker={ticker} /></>;
}

function CellView({ cell, ticker, label }: { cell: TableCell | null; ticker: string; label: string }) {
  const { open } = useSource();
  if (!cell) return <span className="text-muted-foreground">—</span>;
  const base = cell.ref ? refTarget(cell.ref, ticker, cell.text) : null;
  const t = base && !base.doc && !base.external ? { ...base, label } : base;
  const cls = cn(cell.tone === "positive" && "text-positive", cell.tone === "negative" && "text-negative");
  if (!t) return <span className={cls} title={cell.ref ? refCaption(cell.ref) : undefined}>{cell.text}</span>;
  return <button type="button" onClick={() => open(t)} className={cn("cell-link hover:underline", cls)} title={refCaption(cell.ref!)}>{cell.text}</button>;
}

export function ReportTableView({ table, ticker }: { table: ReportTable; ticker: string }) {
  return (
    <figure className="report-table my-3 break-inside-avoid">
      <figcaption className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--brand-accent-ink,var(--color-muted-foreground))]">{table.title}</figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b-2 border-[color:var(--brand,currentColor)]">
              <th className="py-1 pr-3 text-left font-medium text-muted-foreground" />
              {table.columns.map((c) => <th key={c} className="num whitespace-nowrap py-1 pl-3 text-right font-medium text-muted-foreground">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.label} className="border-b border-border/70">
                <td className={cn("py-1 pr-3 text-left", r.bold && "font-semibold")}>{r.label}</td>
                {r.cells.map((c, i) => <td key={i} className={cn("num whitespace-nowrap py-1 pl-3 text-right", r.bold && "font-semibold")}><CellView cell={c} ticker={ticker} label={`${r.label} · ${table.columns[i]}`} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className="mt-1 text-[10.5px] text-muted-foreground">{table.note}</p>}
    </figure>
  );
}

export interface ReportBrand { branding: FirmBranding | null; logo: string | null; firmName: string | null; preparedBy: string | null }

/** The report as a document: branded cover, cited sections, tables and a numbered source list. */
export function ReportDocument({ content, brand, className }: { content: ReportContent; brand: ReportBrand; className?: string }) {
  const facts = useMemo(() => new Map(content.facts.map((f) => [f.id, f])), [content]);
  const order = useMemo(() => citationOrder(content.sections), [content]);
  const tables = new Map(content.tables.map((t) => [t.id, t]));
  const b = resolveBranding(brand.branding);
  const strong = readableOn(b.primary) === "#ffffff" ? b.primary : "#111111";
  const def = KINDS[content.kind];
  const sources = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id, n]) => ({ n, f: facts.get(id)! })).filter((x) => x.f);
  const { open } = useSource();
  const verified = content.qa.numbers ? `${content.qa.verifiedNumbers} of ${content.qa.numbers} figures matched to their sources` : "Every statement cites its sources";

  return (
    <article className={cn("report-doc bg-card text-card-foreground shadow-paper", className)} style={{ fontFamily: BRAND_FONT[b.font], ["--brand" as string]: strong, ["--brand-accent-ink" as string]: strong }}>
      <BrandedCover
        branding={brand.branding}
        logo={brand.logo}
        firmName={brand.firmName ?? "Filed Under"}
        kicker={def.label}
        title={content.title}
        subtitle={content.subtitle}
        meta={<>
          {content.name} ({content.ticker}) · {fmtDate(content.asOf, { month: "long", day: "numeric", year: "numeric" })}
          {content.priceAsOf ? ` · prices as of ${fmtDate(content.priceAsOf)}` : ""}
          {b.signature && brand.preparedBy ? ` · prepared by ${brand.preparedBy}` : ""}
        </>}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-7 py-2 text-[11px] text-muted-foreground" data-print-keep>
        <span className="inline-flex items-center gap-1 text-positive"><ShieldCheck className="size-3.5" /> {verified}</span>
        <span>{order.size} sources cited</span>
        {content.qa.removed.length > 0 && (
          <Popover>
            <PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" data-print-hide><Info className="size-3.5" /> {content.qa.removed.length} unsupported sentence{content.qa.removed.length === 1 ? "" : "s"} removed</button></PopoverTrigger>
            <PopoverContent className="w-96 space-y-2 text-xs">
              <p className="font-medium">Removed during source checks</p>
              {content.qa.removed.slice(0, 8).map((r, i) => <p key={i} className="border-l-2 pl-2 text-muted-foreground"><span className="text-foreground">{r.text}</span> — {r.reason}</p>)}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="report-body space-y-6 px-7 py-6 text-[13.5px] leading-relaxed">
        {content.sections.map((s) => (
          <section key={s.id} className="break-inside-avoid-page">
            <h3 className="mb-2 border-b pb-1 text-[15px] font-semibold tracking-tight" style={{ borderColor: b.accent }}>{s.title}</h3>
            {s.paragraphs.map((p, i) => <p key={i} className="mb-2.5 text-pretty"><ClaimText c={p} order={order} facts={facts} ticker={content.ticker} /></p>)}
            {s.bullets.length > 0 && (
              <ul className="mb-2 space-y-1.5 pl-4">
                {s.bullets.map((x, i) => <li key={i} className="list-disc text-pretty marker:text-[color:var(--brand)]"><ClaimText c={x} order={order} facts={facts} ticker={content.ticker} /></li>)}
              </ul>
            )}
            {s.tables.map((id) => tables.get(id) && <ReportTableView key={id} table={tables.get(id)!} ticker={content.ticker} />)}
          </section>
        ))}

        <section className="report-sources break-before-page border-t pt-4">
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em]">Sources</h3>
          <ol className="space-y-1 text-[11px] leading-snug">
            {sources.map(({ n, f }) => {
              const t = refTarget(f.ref, content.ticker, f.text);
              return (
                <li key={f.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-1">
                  <span className="num text-right text-muted-foreground">{n}.</span>
                  <span>
                    <span>{readableDates(f.text.length > 220 ? `${f.text.slice(0, 218)}…` : f.text)}</span>{" "}
                    <span className="text-muted-foreground">— {refCaption(f.ref)}</span>
                    {t && <button type="button" onClick={() => open(t)} className="ml-1 inline-flex items-center gap-0.5 text-[color:var(--color-primary)] hover:underline" data-print-hide>open <ExternalLink className="size-3" /></button>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <footer className="space-y-1 border-t px-7 py-3 text-[10px] leading-snug text-muted-foreground">
        <p className="flex justify-between gap-3"><span>{b.footer}</span><span>Generated {fmtDate(content.generatedAt)} · AI-drafted from cited sources; review before distribution</span></p>
        <p>{b.disclaimer}</p>
      </footer>
    </article>
  );
}
