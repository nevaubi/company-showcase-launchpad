import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceButton } from "@/components/source/evidence-button";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { AltChart } from "@/components/alt/alt-chart";
import { AltRecords } from "@/components/alt/alt-records";
import { MedicareDrugTable } from "@/components/alt/alt-views";
import { DepositsByState } from "@/components/alt/deposits-by-state";
import { MedicareByState } from "@/components/alt/medicare-by-state";
import { PlantsTri } from "@/components/alt/plants-tri";
import { CompanyPlantHazards } from "@/components/alt/plant-hazards";
import { OfficialBanking } from "@/components/company/official/official-banking";
import { OrangeBook } from "@/components/company/official/orange-book";
import { AppLink } from "@/components/company/official/record-link";
import { fmtAlt, fmtChange, fmtDay } from "@/lib/alt/catalog";
import { BANK_RISK, bpChange, buildCompanyAlt, type CompanyAlt, type DatasetView, type Figure, type Flag } from "@/lib/alt/company";
import { revenuePoints, yearOnYear } from "@/lib/alt/derive";
import { altCompanyQuery, type AltRow } from "@/lib/alt/query";
import { useCompany } from "@/lib/data";
import { bankScopeLine, guardAltRows, guardEntry, reviewCaveat } from "@/lib/sources/company/guard";
import { datasetHref, FDIC_NATIVE_DATASET, soleBankCertificate } from "@/lib/sources/links";
import { cn } from "@/lib/utils";

/** In-page id of a dataset's panel (theme sections own the `alt-<theme>` ids). */
const panelId = (dataset: string) => `alt-ds-${dataset}`;

/** Section names kept from the previous layout so the assistant's anchors still resolve. */
const SECTION_NAME: Record<string, string> = { medicare: "Medicare drugs", medicare_states: "Medicare drugs by state", tri: "Plants", deposits: "Deposits by state" };
/** Datasets whose own component needs the full panel width. */
/** Datasets whose own component already shows its headline figures. */
const OWN_STATS = new Set(["medicare_states", "deposits", "tri"]);
const WIDE = new Set(["medicare_states", "deposits", "tri", "bank", "medicare"]);

/** An in-page link: scrolls smoothly to the section (respecting reduced motion) without touching the route. */
export function SectionLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        document.getElementById(to)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }}
    >
      {children}
    </a>
  );
}

/** One company's alt data and what it says: hook shared by the tab and the Overview snapshot. */
export function useCompanyAlt(ticker: string) {
  const q = useQuery(altCompanyQuery(ticker));
  const company = useCompany(ticker);
  const income = company.data?.statements?.annual?.income;
  // a mapped company shows bank and deposits rows only of banks the official mapping proves (guard.ts)
  const alt = useMemo<CompanyAlt | null>(() => (q.data ? buildCompanyAlt(guardAltRows(ticker, q.data as AltRow[]), new Date().toISOString().slice(0, 10), revenuePoints(income as never)) : null), [q.data, income, ticker]);
  return { q, alt };
}

function figureTarget(ticker: string, f: Figure): SourceTarget | null {
  const r = f.rows.find((x) => x.source_url);
  if (f.revenue?.accn && r?.source_url) {
    return {
      ticker,
      label: f.label,
      unit: "pct",
      value: 0,
      external: { url: r.source_url, date: r.date ?? undefined },
      derived: { formula: f.formula ?? f.label, parts: [{ label: "Revenue", sign: 1, accn: f.revenue.accn, concept: f.revenue.concept ?? "us-gaap:Revenues", end: f.revenue.end, value: f.revenue.value }] },
    };
  }
  return r?.source_url ? { ticker, label: f.label, unit: r.unit ?? "", value: r.value ?? 0, external: { url: r.source_url, date: r.date ?? undefined, quote: f.formula } } : null;
}

function Figures({ ticker, figures }: { ticker: string; figures: Figure[] }) {
  const { open } = useSource();
  if (!figures.length) return null;
  return (
    <div className="grid grid-cols-1 border-b sm:grid-cols-2">
      {figures.slice(0, 3).map((f, i) => {
        const t = figureTarget(ticker, f);
        const body = (
          <>
            <span className="block truncate text-[11px] text-muted-foreground">{f.label}</span>
            <span className={cn("block truncate font-semibold leading-tight", /^[\d$<>.,%×+\u2212\u2013 KMBT-]+( lb)?$/.test(f.value) ? "num text-lg" : "text-[13px] leading-6")}>{f.value}</span>
            {f.sub && <span className={cn("num block text-[11px]", f.tone === "positive" ? "text-positive" : f.tone === "negative" ? "text-negative" : "text-muted-foreground")} title={f.sub}>{f.sub}</span>}
          </>
        );
        const cls = cn("flex min-w-0 flex-col justify-start px-3.5 py-2 text-left", i % 2 === 1 && "sm:border-l", i > 0 && "border-t sm:border-t-0", i > 1 && "sm:border-t");
        return t ? (
          <button key={f.label} type="button" onClick={() => open(t)} title={`Source: ${f.label}`} className={cn(cls, "transition-colors duration-150 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{body}</button>
        ) : (
          <div key={f.label} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

/** The badge a flagged dataset carries: what the rule found, in its own words. */
export const flagBadge = (f: Flag) => (f.kind === "rise" ? "Unusual rise" : f.direction === "up" ? "Above its range" : "Below its range");

function FlagLine({ flag, ticker, label }: { flag: Flag; ticker: string; label?: string }) {
  const up = flag.direction === "up";
  const src = flag.rows.find((r) => r.source_url);
  return (
    <div className="flex min-h-7 items-start gap-2 px-3.5 py-1.5 text-[13px]">
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[3px]", up ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground")}>{up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}</span>
      <span className="min-w-0 flex-1">
        {label && <span className="font-medium">{label}: </span>}
        <span>{flag.text}</span>
        <span className="block text-[11px] text-muted-foreground">{flag.rule}</span>
      </span>
      {src?.source_url && <EvidenceButton ticker={ticker} title={`${label ?? flag.dataset}: ${src.title}`} url={src.source_url} date={src.date ?? undefined} />}
    </div>
  );
}

function BankTable({ ticker, view }: { ticker: string; view: DatasetView }) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = view.table;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[13px]">
        <thead>
          <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
            <th className="pl-3.5 font-normal">Call report line</th><th className="font-normal">Quarter</th><th className="text-right font-normal">Latest</th><th className="text-right font-normal">vs a year earlier</th><th className="w-[140px] pl-4 font-normal">Last 12 quarters</th><th className="w-[72px]" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = view.rows.filter((x) => x.title === r.title && x.value != null && x.date).sort((a, b) => a.date!.localeCompare(b.date!));
            const y = yearOnYear(s, today);
            const isRate = r.unit === "%";
            const delta = y?.prior ? (isRate ? bpChange(y.latest.value! - y.prior.value!) : fmtChange(y.change)) : "–";
            const risk = BANK_RISK.includes(r.title);
            const up = y?.prior ? y.latest.value! > y.prior.value! : null;
            return (
              <tr key={r.title} className="h-7 border-b last:border-0">
                <td className="truncate pl-3.5">{r.title}</td>
                <td className="num text-[11px] text-muted-foreground">{r.date}</td>
                <td className="num text-right font-medium">{fmtAlt(r.value, r.unit)}</td>
                <td className={cn("num text-right", up == null ? "text-muted-foreground" : risk ? (up ? "text-negative" : "text-positive") : "")}>{delta}</td>
                <td className="pl-4"><Spark values={s.slice(-12).map((x) => x.value!)} /></td>
                <td className="pr-2 text-right">{r.source_url && <EvidenceButton ticker={ticker} title={r.title} url={r.source_url} date={r.date ?? undefined} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 120).toFixed(1)},${(18 - ((v - lo) / (hi - lo || 1)) * 16).toFixed(1)}`).join(" ");
  return <svg width={120} height={20} aria-hidden className="block"><polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth={1.25} /></svg>;
}

/** Where a bank panel's figures come from in the official library: the company's proven banks, or the one certificate its rows carry. */
function BankRecordsLink({ ticker, rows }: { ticker: string; rows: DatasetView["rows"] }) {
  if (guardEntry(ticker)) return <SectionLink to="official-banks" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">Insured banks</SectionLink>;
  const cert = soleBankCertificate(rows as never);
  return cert ? <AppLink href={datasetHref(FDIC_NATIVE_DATASET, { entity: cert })} className="text-[11px] text-muted-foreground">FDIC records</AppLink> : null;
}

function DatasetPanel({ ticker, view, span }: { ticker: string; view: DatasetView; span?: boolean }) {
  const name = SECTION_NAME[view.dataset] ?? view.label;
  const series = view.dataset === "settlement" || view.dataset === "attention" || view.dataset === "complaints";
  const caveat = view.dataset === "bank" || view.dataset === "deposits" ? reviewCaveat(ticker) : null;
  const scope = view.dataset === "bank" ? bankScopeLine(ticker, Number(soleBankCertificate(view.rows as never)) || null) : null;
  return (
    <div data-section={name} id={panelId(view.dataset)} className={cn("min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]", (WIDE.has(view.dataset) || span) && "xl:col-span-2")}>
      <Panel
        collapse={false}
        className="h-full rounded-md border bg-card shadow-paper"
        bodyClassName="p-0"
        title={<span className="flex items-center gap-2">{view.label}{view.flag && <span className={cn("rounded-[3px] px-1.5 text-[10px] font-medium leading-4", view.flag.direction === "up" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground")}>{flagBadge(view.flag)}</span>}</span>}
        subtitle={`${view.source} · latest ${fmtDay(view.latest)} · ${view.count.toLocaleString("en-US")} records`}
        actions={view.dataset === "bank" ? <BankRecordsLink ticker={ticker} rows={view.rows} /> : undefined}
      >
        {caveat && <p className="border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">{caveat}</p>}
        {scope && <p className="border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">{scope}</p>}
        {!OWN_STATS.has(view.dataset) && <Figures ticker={ticker} figures={view.figures} />}
        {view.coverage && <p className="border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">{view.coverage}</p>}
        {view.flag && <div className="border-b"><FlagLine flag={view.flag} ticker={ticker} /></div>}
        {view.chart && view.chart.points.length > 1 && (
          <div className="border-b px-3.5 pb-1 pt-2">
            <div className="mb-1 text-[11px] text-muted-foreground">{view.chart.title}</div>
            <AltChart height={96} points={view.chart.points} kind={view.chart.kind} unit={view.chart.unit} label={`${view.label}: ${view.chart.title}`} />
          </div>
        )}
        {view.dataset === "bank" ? <BankTable ticker={ticker} view={view} />
          : view.dataset === "medicare" ? <MedicareDrugTable ticker={ticker} rows={view.table as AltRow[]} />
          : view.dataset === "medicare_states" ? <MedicareByState ticker={ticker} rows={view.table as AltRow[]} />
          : view.dataset === "deposits" ? <DepositsByState ticker={ticker} rows={view.table as AltRow[]} />
          : view.dataset === "tri" ? <><CompanyPlantHazards ticker={ticker} /><PlantsTri ticker={ticker} rows={view.table as AltRow[]} /></>
          : <AltRecords rows={view.table as AltRow[]} ticker={ticker} series={series} pageSize={series ? 4 : 6} />}
        {view.dataset === "fda" && <OrangeBook ticker={ticker} rows={view.rows} />}
      </Panel>
    </div>
  );
}

function Summary({ ticker, alt }: { ticker: string; alt: CompanyAlt }) {
  const label = (d: string) => alt.views.find((v) => v.dataset === d)?.label ?? d;
  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div data-section="What changed" className="min-w-0 rounded-md border bg-card shadow-paper">
        <header className="border-b px-3.5 py-2">
          <h2 className="text-[14px] font-semibold">What changed</h2>
          <p className="text-[11px] text-muted-foreground">Readings unusual for this company's own history, and material records of the last 90 days</p>
        </header>
        {alt.flags.map((f) => <div key={f.dataset} className="border-b last:border-0"><FlagLine flag={f} ticker={ticker} label={label(f.dataset)} /></div>)}
        {alt.notable.length > 0 && <AltRecords rows={alt.notable as AltRow[]} ticker={ticker} pageSize={5} />}
        {!alt.flags.length && !alt.notable.length && <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Nothing unusual against this company's own history, and no activist stakes, red-flag 8-K items, recalls or large awards in the last 90 days.</p>}
      </div>
      <div data-section="Alt data coverage" className="min-w-0 rounded-md border bg-card shadow-paper">
        <header className="border-b px-3.5 py-2">
          <h2 className="text-[14px] font-semibold">Datasets on file</h2>
          <p className="text-[11px] text-muted-foreground">{alt.views.length} of 17 public datasets cover {ticker}; newest record {fmtDay(alt.latest)}</p>
        </header>
        <table className="w-full table-fixed text-[13px]">
          <tbody>
            {alt.themes.flatMap((t) => t.views.map((v, i) => (
              <tr key={v.dataset} className={cn("h-7", i === 0 ? "border-t first:border-t-0" : "")}>
                <td className="w-[30%] truncate pl-3.5 pr-2 text-[11px] text-muted-foreground sm:w-[34%]" title={t.label}>{i === 0 ? t.short : ""}</td>
                <td className="truncate"><SectionLink to={panelId(v.dataset)} className="hover:underline">{v.label}</SectionLink>{v.flag && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" aria-label="unusual" />}</td>
                <td className="num w-[6.5rem] whitespace-nowrap pl-2 pr-3.5 text-right text-[11px] text-muted-foreground">{fmtDay(v.latest)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The company Alt data tab: summary, then each theme's datasets as compact panels. */
export function AltCompanyTab({ ticker }: { ticker: string }) {
  const { q, alt } = useCompanyAlt(ticker);
  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  if (q.isError && !q.data) return <Panel title="Alternative data"><p role="alert" className="text-sm text-muted-foreground">Public records are temporarily unavailable.</p><Button variant="outline" size="xs" className="mt-2" onClick={() => q.refetch()}>Retry</Button></Panel>;
  const official = !!guardEntry(ticker);
  const banking = alt?.themes.find((t) => t.id === "banking");
  const officialSection = official && !banking && (
    <section id="alt-official-banking" data-section="Official bank records" className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]">
      <h2 className="mb-3 text-[14px] font-semibold">Banking</h2>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2"><OfficialBanking ticker={ticker} /></div>
    </section>
  );
  if (!alt?.views.length) return <div className="grid grid-cols-1 gap-5"><Panel title="Alternative data" collapse={false}><p className="text-[13px] text-muted-foreground">No public alt data on file for {ticker} yet. Datasets fill in as the collectors reach the company.</p></Panel>{officialSection}</div>;
  return (
    <div className="grid grid-cols-1 gap-5" data-section="Alternative data">
      <Summary ticker={ticker} alt={alt} />
      {alt.themes.length > 1 && (
        <nav aria-label="Alt data sections" data-tour="alt-sections" className="sticky top-[var(--sticky-top,3.5rem)] z-10 -mx-1 flex flex-wrap gap-1 border-b bg-background/95 px-1 py-1.5 backdrop-blur">
          {alt.themes.map((t) => (
            <SectionLink key={t.id} to={t.anchor} className="inline-flex min-h-7 items-center gap-1 rounded-[4px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="sm:hidden">{t.short}</span><span className="max-sm:hidden">{t.label}</span> <span className="num text-[11px]">{t.views.length}</span></SectionLink>
          ))}
        </nav>
      )}
      {alt.themes.map((t) => (
        <section key={t.id} id={t.anchor} data-section={t.label} className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]">
          <h2 className="mb-3 text-[14px] font-semibold">{t.label}</h2>
          {(() => {
            const active = t.views.filter((v) => !v.quiet);
            const quiet = t.views.filter((v) => v.quiet);
            // a lone half-width panel at the end of a theme takes the full row instead of leaving a hole
            const half = active.filter((x) => !WIDE.has(x.dataset));
            return (
              <>
                {/* a proven company's official bank records lead its Banking theme; the call-report panels below link up to them */}
                {official && t.id === "banking" && (
                  <div className={cn("grid grid-cols-1 gap-3 xl:grid-cols-2", (active.length > 0 || quiet.length > 0) && "mb-3")}>
                    <OfficialBanking ticker={ticker} />
                  </div>
                )}
                {active.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {active.map((v) => <DatasetPanel key={v.dataset} ticker={ticker} view={v} span={!WIDE.has(v.dataset) && half.length % 2 === 1 && half[half.length - 1] === v} />)}
                  </div>
                )}
                {quiet.length > 0 && (
                  <ul className={cn("rounded-md border bg-card text-[13px] shadow-paper", active.length > 0 && "mt-3")}>
                    {quiet.map((v) => (
                      <li key={v.dataset} id={panelId(v.dataset)} data-section={SECTION_NAME[v.dataset] ?? v.label} className="flex min-h-7 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] flex-wrap items-center gap-x-2 border-b px-3.5 py-1 last:border-0">
                        <span className="font-medium">{v.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{v.quiet}</span>
                        <span className="num text-[11px] text-muted-foreground">{v.count.toLocaleString("en-US")} records · newest {fmtDay(v.latest)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
        </section>
      ))}
      {officialSection}
    </div>
  );
}
