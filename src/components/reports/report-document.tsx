import { Fragment, useMemo } from "react";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { BrandedCover, BRAND_FONT } from "@/components/firm/branded-cover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { citationOrder, numbersIn } from "@/lib/reports/vet";
import { KINDS } from "@/lib/reports/kinds";
import type { Claim, Fact, FactRef, ReportContent, ReportTable, TableCell } from "@/lib/reports/types";
import { resolveBranding, type FirmBranding } from "@/lib/firm/core";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Turn a fact/cell reference into a source-panel target (null for market/firm data, shown as a note). */
export function refTarget(ref: FactRef, ticker: string, text: string): SourceTarget | null {
  const n = numbersIn(text).at(-1);
  const unit = !n ? "usd" : n.kind === "pct" ? "pct" : n.kind === "mult" ? "ratio" : /\$\d+\.\d{2}$/.test(n.raw) && Math.abs(n.value) < 5000 ? "usdPerShare" : "usd";
  const label = text.length > 90 ? `${text.slice(0, 88)}…` : text;
  switch (ref.kind) {
    case "sec": return { ticker, label, unit, value: ref.src.value, src: ref.src };
    case "derived": return { ticker, label, unit, value: n?.value ?? 0, derived: { formula: ref.formula, parts: ref.parts } };
    case "filing": return { ticker, label: ref.label, unit: "usd", value: 0, doc: { accn: ref.accn, doc: ref.doc, form: ref.form, filed: ref.filed, title: ref.label } };
    case "web": return { ticker, label: ref.label, unit: "usd", value: 0, external: { url: ref.url, quote: ref.quote, date: ref.date, confidence: "Verbatim quote checked against the transcript" } };
    default: return null;
  }
}

export function refCaption(ref: FactRef): string {
  switch (ref.kind) {
    case "sec": return `SEC XBRL · ${ref.src.concept} · ${ref.src.start ? `${ref.src.start} → ` : ""}${ref.src.end} · ${ref.src.accn}`;
    case "derived": return `Calculated · ${ref.formula}`;
    case "filing": return `${ref.form === "4" ? "Form 4" : `Form ${ref.form}`} filed ${ref.filed} · ${ref.accn}`;
    case "web": return `${ref.label}${ref.url ? ` · ${new URL(ref.url).hostname.replace(/^www\./, "")}` : ""}`;
    case "market": return `Market data as of ${ref.asOf} (third-party; not from SEC filings)`;
    case "firm": return `Firm coverage record as of ${ref.asOf}`;
  }
}

function Cite({ ids, order, facts, ticker }: { ids: string[]; order: Map<string, number>; facts: Map<string, Fact>; ticker: string }) {
  const { open } = useSource();
  if (!ids.length) return null;
  return (
    <sup className="ml-0.5 whitespace-nowrap">
      {ids.map((id, i) => {
        const f = facts.get(id);
        const n = order.get(id);
        if (!f || !n) return null;
        const t = refTarget(f.ref, ticker, f.text);
        return (
          <Fragment key={id}>
            {i > 0 && <span className="text-muted-foreground">,</span>}
            {t ? (
              <button type="button" onClick={() => open(t)} className="cite num text-[9.5px] font-semibold text-[color:var(--brand-link,var(--color-primary))] hover:underline" title={f.text} aria-label={`Source ${n}: ${f.text}`}>{n}</button>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="cite num text-[9.5px] font-semibold text-[color:var(--brand-link,var(--color-primary))] hover:underline" aria-label={`Source ${n}`}>{n}</button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-xs"><p className="font-medium">{f.text}</p><p className="mt-1 text-muted-foreground">{refCaption(f.ref)}</p></PopoverContent>
              </Popover>
            )}
          </Fragment>
        );
      })}
    </sup>
  );
}

function ClaimText({ c, order, facts, ticker }: { c: Claim; order: Map<string, number>; facts: Map<string, Fact>; ticker: string }) {
  return <>{c.text}<Cite ids={c.factIds} order={order} facts={facts} ticker={ticker} /></>;
}

function CellView({ cell, ticker }: { cell: TableCell | null; ticker: string }) {
  const { open } = useSource();
  if (!cell) return <span className="text-muted-foreground">—</span>;
  const t = cell.ref ? refTarget(cell.ref, ticker, cell.text) : null;
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
                {r.cells.map((c, i) => <td key={i} className={cn("num whitespace-nowrap py-1 pl-3 text-right", r.bold && "font-semibold")}><CellView cell={c} ticker={ticker} /></td>)}
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
  const def = KINDS[content.kind];
  const sources = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id, n]) => ({ n, f: facts.get(id)! })).filter((x) => x.f);
  const { open } = useSource();
  const verified = content.qa.numbers ? `${content.qa.verifiedNumbers} of ${content.qa.numbers} figures matched to their sources` : "Every statement cites its sources";

  return (
    <article className={cn("report-doc bg-card text-card-foreground shadow-paper", className)} style={{ fontFamily: BRAND_FONT[b.font], ["--brand" as string]: b.primary, ["--brand-accent-ink" as string]: b.primary }}>
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
                    <span>{f.text.length > 220 ? `${f.text.slice(0, 218)}…` : f.text}</span>{" "}
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
