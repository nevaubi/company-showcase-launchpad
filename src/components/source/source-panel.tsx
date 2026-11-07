import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Calculator, FileText, Sigma, Sparkles, X } from "lucide-react";
import { requestResearch } from "@/lib/research/request";
import { useSource } from "./source-context";
import { FilingViewer, type FactLocator } from "./filing-viewer";
import { useCompany } from "@/lib/data";
import { getFilingIndex } from "@/lib/sec.functions";
import { fmtDate, fmtValueLong, SEC_FORM_LABEL } from "@/lib/format";
import type { Filing, SourceRef } from "@/lib/financials/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ActiveDoc {
  accn: string;
  /** Specific document inside the filing (exhibit, Form 4 XML); defaults to the primary document */
  doc?: string;
  locator?: FactLocator;
  label?: string;
  /** Stored IR document id */
  irDoc?: string;
}

export const PANEL_WIDTH = "min(50vw, 920px)";

export function SourcePanel() {
  const { target, close } = useSource();
  const company = useCompany(target?.ticker ?? "AAPL");
  const filings = company.data?.filings;
  const byAccn = useMemo(() => new Map((filings ?? []).map((f) => [f.accn, f])), [filings]);
  const [active, setActive] = useState<ActiveDoc | null>(null);

  useEffect(() => {
    if (!target) return setActive(null);
    if (target.external) return setActive(null);
    if (target.doc?.irDoc) {
      setActive({ accn: target.doc.accn, irDoc: target.doc.irDoc, locator: target.doc.search ? { search: target.doc.search } : undefined });
    } else if (target.doc) {
      setActive({ accn: target.doc.accn, doc: target.doc.doc ? renderableDoc(target.doc.doc) : undefined, locator: target.doc.search ? { search: target.doc.search } : undefined });
    } else if (target.src) {
      setActive({ accn: target.src.accn, doc: target.src.doc, irDoc: target.src.irDoc, locator: locatorOf(target.src, target.unit as string, target.elementId) });
    } else if (target.derived?.parts.length) {
      const p = target.derived.parts[0];
      setActive({ accn: p.accn, doc: p.doc, irDoc: p.irDoc, locator: locatorOf(p, target.unit as string), label: p.label });
    }
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const open = !!target;
  const filing = active ? byAccn.get(active.accn) : undefined;
  const cik = target?.doc?.cik ?? company.data?.profile.cik ?? "";

  return (
    <aside
      aria-hidden={!open}
      aria-label="Source evidence"
      style={{ width: PANEL_WIDTH }}
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex max-w-full flex-col border-l border-rule bg-background transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
        open ? "translate-x-0 shadow-panel" : "pointer-events-none invisible translate-x-full",
        "max-lg:!w-full",
      )}
    >
      {target && (
        <>
          <header className="flex items-start gap-3 border-b px-5 pb-4 pt-4">
            <div className="min-w-0 flex-1">
              <p className="eyebrow flex items-center gap-1.5">
                <FileText className="size-3" /> Source attribution · {target.ticker}
              </p>
              <h2 className="mt-1.5 truncate text-lg font-semibold leading-tight">
                {target.label}
                {target.periodLabel && <span className="font-normal text-muted-foreground"> · {target.periodLabel}</span>}
              </h2>
              {!target.doc && !target.external && (
                <p className="num mt-1 text-2xl font-medium tracking-tight">
                  <span className="hl">{fmtValueLong(target.value, target.unit)}</span>
                  {target.approx && <span className="ml-2 align-middle text-xs text-muted-foreground">approx.</span>}
                </p>
              )}
              {target.doc?.title && <p className="mt-1 text-sm text-muted-foreground">{target.doc.title}</p>}
            </div>
            <Button variant="ghost" size="icon" onClick={close} aria-label="Close source panel">
              <X />
            </Button>
          </header>

          <div className="max-h-[38%] shrink-0 space-y-3 overflow-y-auto border-b bg-card/60 px-5 py-3 scrollbar-thin">
            {target.external && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Source</dt><dd className="break-all">{sourceHost(target.external.url)}</dd>
              <dt className="text-muted-foreground">Date</dt><dd>{target.external.date ? fmtDate(target.external.date) : "Not supplied"}</dd>
              <dt className="text-muted-foreground">Evidence</dt><dd>{target.external.confidence ?? "Public source · not independently verified"}</dd>
            </dl>}
            {target.src && <FactCard src={target.src} filing={byAccn.get(target.src.accn)} cik={cik} />}
            {target.derived && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Sigma className="size-3.5" /> Calculated
                  <span className="font-normal text-muted-foreground">— {target.derived.formula}</span>
                </p>
                <ul className="mt-2 divide-y rounded-md border bg-card">
                  {target.derived.parts.map((p, i) => {
                    const f = byAccn.get(p.accn);
                    const isActive = active?.accn === p.accn && active?.label === p.label;
                    return (
                      <li key={`${p.accn}-${p.concept}-${i}`}>
                        <button
                          onClick={() => setActive({ accn: p.accn, doc: p.doc, irDoc: p.irDoc, locator: locatorOf(p, target.unit as string), label: p.label })}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary",
                            isActive && "bg-highlight-soft",
                          )}
                        >
                          <span className="num w-4 text-center text-muted-foreground">{p.sign < 0 ? "−" : "+"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{p.label}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {p.concept} · {f ? `${f.form} filed ${fmtDate(f.filed)}` : p.accn}
                            </span>
                          </span>
                          <span className="num text-sm">{fmtValueLong(p.value, guessUnit(p.concept, target.unit as string))}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {target.src && target.alts && target.alts.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Same value also reported in</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[target.src.accn, ...target.alts].map((a) => {
                    const f = byAccn.get(a);
                    return (
                      <button
                        key={a}
                        onClick={() => { if (target.src) setActive({ accn: a, locator: locatorOf(target.src, target.unit as string) }); }}
                        className={cn(
                          "rounded border bg-card px-2 py-1 text-[11px] transition-colors hover:border-rule hover:bg-secondary",
                          active?.accn === a && "border-foreground/40 bg-highlight-soft",
                        )}
                      >
                        <span className="font-medium">{f?.form ?? "Filing"}</span>{" "}
                        <span className="text-muted-foreground">{f ? fmtDate(f.filed) : a}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {target.doc && filing && <DocMeta filing={filing} cik={cik} />}
          </div>

          <div className="min-h-0 flex-1">
            {target.external ? <div className="space-y-4 p-5">
              {target.external.quote && <blockquote className="border-l-2 border-highlight pl-4 text-sm leading-relaxed">“{target.external.quote}”</blockquote>}
              <Button variant="outline" size="sm" asChild><a href={target.external.url} target="_blank" rel="noreferrer">Open original record <ArrowUpRight /></a></Button>
            </div> : active?.irDoc ? (
              <FilingViewer key={active.irDoc} irDocId={active.irDoc} cik={cik} accn={active.accn} doc="" locator={active.locator} className="h-full" />
            ) : active && cik ? (
              <ResolvedViewer cik={cik} accn={active.accn} doc={active.doc} filing={filing} locator={active.locator} />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <Calculator className="mr-2 size-4" /> Select a component to view its source filing.
              </div>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2">
            <span className="text-[11px] text-muted-foreground">{target.ticker} · Evidence</span>
            <Button size="xs" variant="outline" onClick={() => {
              requestResearch(`Investigate ${target.ticker}: ${target.label}. Cross-check this evidence and explain its investment implications. ${target.external ? `Source: ${target.external.url}\n${target.external.quote ?? ""}` : `Filing: ${target.doc?.accn ?? target.src?.accn ?? "derived components"}\n${target.doc?.search ?? ""}`}`);
              close();
            }}><Sparkles /> Investigate</Button>
          </footer>
        </>
      )}
    </aside>
  );
}

function ResolvedViewer({
  cik,
  accn,
  doc: explicitDoc,
  filing,
  locator,
}: {
  cik: string;
  accn: string;
  doc?: string;
  filing?: Filing;
  locator?: FactLocator;
}) {
  const idx = useQuery({
    queryKey: ["filing-index", cik, accn],
    queryFn: () => getFilingIndex({ data: { cik: String(Number(cik)), accn } }),
    enabled: !explicitDoc && !filing,
    staleTime: Infinity,
  });
  const doc = explicitDoc || (filing ? renderableDoc(filing.doc) : idx.data?.documents.find((d) => /\.html?$/i.test(d.name))?.name);
  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {idx.isError ? "Couldn't resolve this filing's documents." : "Resolving filing documents…"}
      </div>
    );
  }
  return <FilingViewer key={`${accn}/${doc}`} cik={cik} accn={accn} doc={doc} locator={locator} className="h-full" />;
}

function FactCard({ src, filing, cik }: { src: SourceRef; filing?: Filing; cik: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      <dt className="text-muted-foreground">Filing</dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        {filing ? (
          <>
            <Badge variant="outline">{filing.form}</Badge>
            <span>{SEC_FORM_LABEL[filing.form] ?? filing.form}</span>
            <span className="text-muted-foreground">filed {fmtDate(filing.filed)}</span>
          </>
        ) : (
          <span>{src.accn}</span>
        )}
      </dd>
      <dt className="text-muted-foreground">{src.concept.includes(" · ") ? "Location" : "XBRL concept"}</dt>
      <dd className="num truncate text-xs">{src.concept}</dd>
      <dt className="text-muted-foreground">Period</dt>
      <dd>{src.start ? `${fmtDate(src.start)} – ${fmtDate(src.end)}` : `As of ${fmtDate(src.end)}`}</dd>
      <dt className="text-muted-foreground">Accession</dt>
      <dd>
        <a
          className="num inline-flex items-center gap-1 text-xs text-link hover:underline"
          href={`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${src.accn.replace(/-/g, "")}/${src.accn}-index.htm`}
          target="_blank"
          rel="noreferrer"
        >
          {src.accn} <ArrowUpRight className="size-3" />
        </a>
      </dd>
    </dl>
  );
}

function DocMeta({ filing, cik }: { filing: Filing; cik: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      <dt className="text-muted-foreground">Form</dt>
      <dd>
        {filing.form} · {SEC_FORM_LABEL[filing.form] ?? ""}
      </dd>
      <dt className="text-muted-foreground">Filed</dt>
      <dd>{fmtDate(filing.filed)}</dd>
      {filing.report && (
        <>
          <dt className="text-muted-foreground">Period</dt>
          <dd>{fmtDate(filing.report)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Accession</dt>
      <dd>
        <a
          className="num inline-flex items-center gap-1 text-xs text-link hover:underline"
          href={`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accn.replace(/-/g, "")}/${filing.accn}-index.htm`}
          target="_blank"
          rel="noreferrer"
        >
          {filing.accn} <ArrowUpRight className="size-3" />
        </a>
      </dd>
    </dl>
  );
}

/** Raw ownership XML (Forms 3/4/5) renders through the SEC's XSL stylesheet as readable HTML. */
function renderableDoc(doc: string) {
  if (/\.xml$/i.test(doc) && !doc.includes("/")) return `xslF345X05/${doc}`;
  return doc;
}

function locatorOf(src: SourceRef, unit: string, elementId?: string): FactLocator {
  return { concept: src.concept, start: src.start, end: src.end, value: src.value, unit: guessUnit(src.concept, unit), elementId, cell: src.cell, box: src.box, search: src.search };
}

function guessUnit(concept: string, fallback: string) {
  if (/EarningsPerShare/.test(concept)) return "usdPerShare";
  if (/NumberOfShares|SharesOutstanding/.test(concept)) return "shares";
  if (fallback === "pct" || fallback === "ratio") return "usd";
  return fallback;
}

function sourceHost(url: string) {
  try { return new URL(url).hostname; } catch { return "Public record"; }
}
