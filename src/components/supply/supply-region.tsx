import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileSignature, Gavel, Landmark, Newspaper } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { signalsQuery, type Signal } from "@/components/supply/supply-intel";
import { getCountryScores, getRegionDossier } from "@/lib/supply-region.functions";
import { agreementTerms, markTerms, termCount, type CountryScore, type RiskTier } from "@/lib/supply/region";
import { countryExposure, type SignalLite } from "@/lib/supply/analytics";
import { countryOf } from "@/lib/supply/place-kind";
import { quoteLink, signalConfidence } from "@/lib/supply/counterparty";
import type { ProLink } from "@/lib/supply/core";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TIER: Record<RiskTier, { label: string; cls: string }> = {
  high: { label: "High", cls: "bg-negative-soft text-negative" },
  elevated: { label: "Elevated", cls: "bg-warning-soft text-foreground" },
  moderate: { label: "Moderate", cls: "bg-muted text-foreground" },
  low: { label: "Low", cls: "bg-positive-soft text-positive" },
  unrated: { label: "Unrated", cls: "bg-muted text-muted-foreground" },
};
export function TierBadge({ t }: { t: RiskTier }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium leading-4", TIER[t].cls)}>{TIER[t].label}</span>;
}

/** −2.5 … +2.5 governance estimate as a centred bar. */
function GovBar({ v, label }: { v: number | null; label: string }) {
  if (v == null) return <span className="text-[11px] text-muted-foreground" title={label}>–</span>;
  const w = Math.min(50, (Math.abs(v) / 2.5) * 50);
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${v.toFixed(2)} (World Bank WGI, −2.5 weak … +2.5 strong)`}>
      <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div className={cn("absolute inset-y-0", v < 0 ? "bg-negative" : "bg-positive")} style={v < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
      </div>
      <span className="num w-9 text-right text-[11px] text-muted-foreground">{v > 0 ? "+" : ""}{v.toFixed(2).replace("-", "−")}</span>
    </div>
  );
}

const scoresQuery = (fetch: (a: { data: { countries: string[] } }) => Promise<{ rows: CountryScore[] }>, countries: string[]) => ({
  queryKey: ["country_scores", countries],
  queryFn: () => fetch({ data: { countries } }),
  enabled: countries.length > 0,
  staleTime: 24 * 3_600_000,
});

// ---------------------------------------------------------------- risk register

export function RegionRiskRegister({ ticker, name, links, signals, revenue, selected, onCountry }: {
  ticker: string; name: string; links: ProLink[]; signals: SignalLite[]; revenue: Record<string, number | undefined>;
  selected: string | null; onCountry: (c: string) => void;
}) {
  const rows = useMemo(
    () => countryExposure(links.filter((l) => l.ticker === ticker), signals.filter((s) => s.ticker === ticker), revenue).filter((r) => r.country !== "United States" && r.country.length < 40).slice(0, 24),
    [ticker, links, signals, revenue],
  );
  const countries = useMemo(() => rows.map((r) => r.country).sort(), [rows]);
  const fetchScores = useServerFn(getCountryScores);
  const { data, isLoading } = useQuery(scoresQuery(fetchScores, countries));
  const by = useMemo(() => new Map((data?.rows ?? []).map((s) => [s.country, s])), [data]);
  const rank: Record<RiskTier, number> = { high: 4, elevated: 3, moderate: 2, unrated: 1, low: 0 };
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const ta = rank[by.get(a.country)?.tier ?? "unrated"] + (a.hotspot ? 1.5 : 0) + Math.min(3, (a.singleSource + a.risks) / 2);
    const tb = rank[by.get(b.country)?.tier ?? "unrated"] + (b.hotspot ? 1.5 : 0) + Math.min(3, (b.singleSource + b.risks) / 2);
    return tb - ta;
  }), [rows, by]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  return (
    <Panel title={`Region risk register · ${name}`} collapse={false} className="min-w-0">
      {!rows.length ? <p className="text-xs text-muted-foreground">No country outside the U.S. is tied to {ticker} in its filings yet.</p> : (<>
      <p className="mb-2 text-xs text-muted-foreground">
        Every country {name}'s own filings, calls or named counterparties tie to, ranked by governance risk (World Bank WGI), hotspot status and
        stated risk and single-source items. Pick a country for its dossier and the region shock.
      </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th scope="col" className="py-1.5 pr-2 font-medium">Country</th>
                <th scope="col" className="px-2 font-medium">Risk</th>
                <th scope="col" className="px-2 font-medium">Stability</th>
                <th scope="col" className="px-2 font-medium">Rule of law</th>
                <th scope="col" className="px-2 font-medium">Regulation</th>
                <th scope="col" className="px-2 text-right font-medium">GDP growth</th>
                <th scope="col" className="px-2 font-medium">Ties in {ticker}'s sources</th>
                <th scope="col" className="pl-2 text-right font-medium">Stated flows</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const s = by.get(r.country);
                return (
                  <tr key={r.country} className={cn("border-b border-border/60 transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none", selected === r.country && "bg-highlight-soft")}>
                    <td className="py-1 pr-2">
                      <button type="button" onClick={() => onCountry(r.country)} aria-pressed={selected === r.country} className="inline-flex min-h-7 items-center gap-1.5 rounded text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {r.country}
                        {r.hotspot && <span className="rounded bg-negative-soft px-1 text-[11px] font-normal text-negative">hotspot</span>}
                      </button>
                    </td>
                    <td className="px-2">{isLoading ? <Skeleton className="h-4 w-12" /> : <TierBadge t={s?.tier ?? "unrated"} />}</td>
                    <td className="px-2"><GovBar v={s?.stability ?? null} label="Political stability" /></td>
                    <td className="px-2"><GovBar v={s?.ruleOfLaw ?? null} label="Rule of law" /></td>
                    <td className="px-2"><GovBar v={s?.regulatory ?? null} label="Regulatory quality" /></td>
                    <td className="num px-2 text-right">{s?.gdpGrowth != null ? `${s.gdpGrowth.toFixed(1).replace("-", "−")}%` : <span className="text-muted-foreground">–</span>}</td>
                    <td className="px-2 text-[11px] text-muted-foreground">
                      {[r.links && count(r.links, "link"), r.hq && `${r.hq} based there`, r.singleSource && `${r.singleSource} single source`, r.facilities && count(r.facilities, "site"), r.policy && `${r.policy} policy`, r.risks && count(r.risks, "risk")].filter(Boolean).join(" · ")}
                    </td>
                    <td className="num pl-2 text-right">{r.dollars ? fmtCompactUsd(r.dollars) : <span className="text-muted-foreground">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Governance: World Bank Worldwide Governance Indicators{data?.rows.find((x) => x.year)?.year ? ` (${data.rows.find((x) => x.year)!.year})` : ""}, from −2.5 (weak) to +2.5 (strong); Taiwan and some territories are not published. The tier uses the weakest of the three estimates.
          </p>
        </div>
      </>)}
    </Panel>
  );
}

// ---------------------------------------------------------------- dossier

/** One country in depth: governance scores, what the company itself says about it, U.S. trade actions naming it, recent news. */
export function RegionDossierPanel({ ticker, name, country, theme }: { ticker: string; name: string; country: string; theme?: string }) {
  const fetchDossier = useServerFn(getRegionDossier);
  const c = country;
  const { data, isLoading, error } = useQuery({
    queryKey: ["region_dossier", c, theme ?? ""],
    queryFn: () => fetchDossier({ data: { country: c, theme } }),
    staleTime: 6 * 3_600_000,
    retry: 1,
  });
  const { data: sig } = useQuery(signalsQuery(ticker));
  const own = useMemo(() => (sig ?? []).filter((s) => countryOf(s.country, s.title ?? "") === c).sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "")), [sig, c]);
  const openSig = useOpenSignal();
  const s = data?.score;

  return (
    <Panel title={`Region dossier · ${c}`} collapse={false} className="min-w-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Governance tier" value={s ? <TierBadge t={s.tier} /> : isLoading ? <Skeleton className="h-4 w-14" /> : "–"} href={s?.sourceUrl} />
        <Tile label="Political stability" value={s?.stability != null ? s.stability.toFixed(2).replace("-", "−") : "–"} href={s?.sourceUrl} />
        <Tile label="Rule of law" value={s?.ruleOfLaw != null ? s.ruleOfLaw.toFixed(2).replace("-", "−") : "–"} href={s?.sourceUrl} />
        <Tile label="Real GDP growth" value={s?.gdpGrowth != null ? `${s.gdpGrowth.toFixed(1).replace("-", "−")}%` : "–"} href={s?.sourceUrl} />
      </div>

      <Section icon={<FileSignature className="size-3.5" />} title={`What ${name} says about ${c}`} count={own.length}>
        {!own.length ? <Empty>No verified filing, contract or call statement from {ticker} names {c}.</Empty> : (
          <ul className="space-y-1.5">
            {own.slice(0, 8).map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => openSig(x)} className="w-full rounded-md border border-border/60 p-2 text-left hover:bg-muted/60">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={cn("rounded px-1 font-medium", x.impact === "risk" ? "bg-negative-soft text-negative" : x.impact === "positive" ? "bg-positive-soft text-positive" : "bg-muted")}>{x.kind.replace("_", " ")}</span>
                    <span>{x.form ?? x.source_kind}</span>{x.filed && <span>· {fmtDate(x.filed)}</span>}
                  </div>
                  <p className="mt-0.5 text-xs font-medium">{x.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] italic text-muted-foreground">“{x.quote}”</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Gavel className="size-3.5" />} title={`U.S. trade and sanctions actions naming ${c}, last 12 months`} count={data?.policyTotal}>
        {isLoading ? <Skeleton className="h-16 w-full" /> : !data?.policy.length ? <Empty>{error ? "Federal Register lookup failed." : "No BIS, USTR, OFAC, ITA, ITC or CBP notice named this country in the last year."}</Empty> : (
          <ul className="divide-y divide-border/60">
            {data.policy.slice(0, 10).map((p) => (
              <li key={p.url} className="py-1.5">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="group flex gap-2 text-xs">
                  <span className="num w-[72px] shrink-0 text-[11px] text-muted-foreground">{p.date}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 group-hover:underline">{p.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{p.agency} · {p.type}</span>
                  </span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Newspaper className="size-3.5" />} title="Supply-chain news, last 45 days" count={data?.news.length}>
        {isLoading ? <Skeleton className="h-16 w-full" /> : !data?.news.length ? <Empty>{data?.newsError ? "News search is unavailable right now." : `No recent supply-chain coverage naming ${c}.`}</Empty> : (
          <ul className="divide-y divide-border/60">
            {data.news.map((n) => (
              <li key={n.url} className="py-1.5">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block text-xs">
                  <span className="line-clamp-1 font-medium group-hover:underline">{n.title}</span>
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">{n.snippet}</span>
                  <span className="block text-[11px] text-muted-foreground">{n.host}{n.date ? ` · ${fmtDate(n.date.slice(0, 10))}` : ""}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Landmark className="size-3" aria-hidden="true" />Sources: World Bank, Federal Register, linked news sites{data?.cachedAt ? ` · refreshed ${fmtDate(data.cachedAt.slice(0, 10))}` : ""}.</p>
    </Panel>
  );
}

function Tile({ label, value, href }: { label: string; value: React.ReactNode; href?: string | null }) {
  const body = (
    <>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="num mt-0.5 text-[13px] font-semibold">{value}</div>
    </>
  );
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-md border p-2 hover:bg-muted/60">{body}</a> : <div className="rounded-md border p-2">{body}</div>;
}
function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">{icon}{title}{count ? <span className="num font-normal text-muted-foreground">{count}</span> : null}</p>
      {children}
    </div>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

function useOpenSignal() {
  const { open } = useSource();
  return (s: Signal) => {
    if (s.accn && s.doc)
      open({ ticker: s.ticker, label: s.title, unit: "usd", value: 0, doc: { accn: s.accn, doc: s.doc, form: s.form ?? "", filed: s.filed ?? "", title: `${s.ticker} ${s.form}`, search: s.quote } });
    else if (s.url) window.open(quoteLink(s.url, s.quote), "_blank", "noopener,noreferrer");
  };
}

// ---------------------------------------------------------------- agreement terms

const TERM_KINDS = ["contract", "call", "concentration", "mgmt_action"];

/** Dates, term lengths, amounts and clauses read word for word out of the company's contract exhibits, 10-K passages and call statements. */
export function AgreementTerms({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const [clause, setClause] = useState<string | null>(null);
  const rows = useMemo(() => (data ?? [])
    .filter((s) => TERM_KINDS.includes(s.kind))
    .map((s) => ({ s, t: agreementTerms(s.quote) }))
    // agreements only: a contract exhibit, a stated clause, or a named counterparty with stated terms
    .filter((r) => r.t.clauses.length > 0 || r.s.kind === "contract" || (!!r.s.counterparty?.trim() && termCount(r.t) >= 2))
    .sort((a, b) => (b.s.filed ?? "").localeCompare(a.s.filed ?? "")), [data]);
  const clauses = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const c of r.t.clauses) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = clause ? rows.filter((r) => r.t.clauses.includes(clause)) : rows;
  const openSig = useOpenSignal();

  return (
    <div data-section="Agreement terms">
      <p className="mb-2 text-xs text-muted-foreground">
        Dates, term lengths, dollar amounts, percentages and contract clauses read word for word out of {ticker}'s verified contract exhibits, 10-K passages and call statements. Highlighted words are exactly what the source says.
      </p>
      {clauses.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Clause">
          <Chip on={!clause} onClick={() => setClause(null)}>All <span className="num">{rows.length}</span></Chip>
          {clauses.map(([c, n]) => <Chip key={c} on={clause === c} onClick={() => setClause(c)}>{c} <span className="num">{n}</span></Chip>)}
        </div>
      )}
      {isLoading ? <Skeleton className="h-24 w-full" /> : !shown.length ? <Empty>No stated agreement terms for {ticker} yet.</Empty> : (
        <ul className="divide-y divide-border/60 border-y">
          {shown.map(({ s, t }) => {
            const conf = signalConfidence(s);
            return (
              <li key={s.id} className="grid grid-cols-1 gap-2 py-2 md:grid-cols-[170px_minmax(0,1fr)]">
                <div className="min-w-0 text-[11px] leading-4">
                  <p className="truncate text-[13px] font-medium leading-5">{s.counterparty || "Unnamed counterparty"}</p>
                  <p className="text-muted-foreground">{s.form ?? s.source_kind}{s.filed ? ` · ${fmtDate(s.filed)}` : ""}</p>
                  {s.speaker && <p className="truncate text-muted-foreground" title={s.speaker}>{s.speaker}</p>}
                  <span className={cn("mt-1 inline-block rounded px-1 text-[11px]", conf === "high" ? "bg-positive-soft text-positive" : conf === "medium" ? "bg-warning-soft" : "bg-muted text-muted-foreground")}>{conf} confidence</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-5">{s.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.clauses.map((c) => <span key={c} className="rounded border px-1.5 text-[11px]">{c}</span>)}
                    {t.durations.map((d) => <span key={d} className="rounded bg-muted px-1.5 text-[11px]">term {d}</span>)}
                    {s.amount_usd ? <span className="num rounded bg-muted px-1.5 text-[11px]">{fmtCompactUsd(s.amount_usd)}</span> : null}
                  </div>
                  <button type="button" onClick={() => openSig(s)} className="mt-1 block rounded text-left text-xs leading-relaxed text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                    “{markTerms(s.quote, t).map((p, i) => p.hit ? <mark key={i} className="rounded-sm bg-highlight-soft px-0.5 text-foreground">{p.s}</mark> : <span key={i}>{p.s}</span>)}”
                    <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", on ? "border-foreground bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>{children}</button>;
}
