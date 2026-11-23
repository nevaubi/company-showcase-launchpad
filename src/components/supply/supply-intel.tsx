// Verified statements outside the 10-K link sentences: contract exhibits, earnings-call remarks, management actions,
// stated concentration, facility locations and policy items (`supply_signals`). Two ways to read the same rows:
// by type, newest first, and by named counterparty as a dated timeline. Each row opens its source at the quoted passage.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Mic, Newspaper, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { concentrationBasis } from "@/lib/supply/core";
import { byCounterparty, quoteLink, signalConfidence, type CpConfidence } from "@/lib/supply/counterparty";

const BASIS: Record<string, string> = { revenue: "of revenue", receivables: "of receivables", vendor: "vendor receivables", channel: "of sales by channel", other: "" };

export interface Signal {
  id: string; ticker: string; kind: string; title: string; detail: string | null; quote: string;
  counterparty: string | null; country: string | null; amount_usd: number | null; pct: number | null;
  period: string | null; impact: string; speaker: string | null; source_kind: string;
  accn: string | null; doc: string | null; form: string | null; filed: string | null; url: string | null;
}

const KINDS: { v: string; label: string }[] = [
  { v: "all", label: "All" },
  { v: "contract", label: "Contracts" },
  { v: "call", label: "Earnings calls" },
  { v: "mgmt_action", label: "Management actions" },
  { v: "concentration", label: "Customer concentration" },
  { v: "facility", label: "Locations" },
  { v: "policy", label: "Tariffs, laws and politics" },
];
const COUNTRY_ALIAS: Record<string, string> = {
  "u.s.": "United States", us: "United States", usa: "United States", "united states of america": "United States",
  "greater china": "China", prc: "China", "mainland china": "China", "people's republic of china": "China",
  uk: "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom", eu: "European Union",
  "republic of korea": "South Korea", korea: "South Korea",
};
export const normCountry = (c: string | null) => (c ? COUNTRY_ALIAS[c.trim().toLowerCase()] ?? c.trim() : null);
const SRC_ICON = { filing: FileText, exhibit: ScrollText, transcript: Mic, web: Newspaper } as Record<string, typeof FileText>;
const SRC_LABEL: Record<string, string> = { filing: "10-K", exhibit: "Contract exhibit", transcript: "Earnings call", web: "News" };
const PAGE = 6;

export const signalsQuery = (ticker: string) => ({
  queryKey: ["supply_signals", ticker],
  queryFn: async () => {
    const { data, error } = await supabase.from("supply_signals").select("*").eq("ticker", ticker).limit(1000);
    if (error) throw error;
    return (data ?? []) as Signal[];
  },
  staleTime: 10 * 60_000,
});

const pill = (on: boolean) => cn("inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", on ? "border-foreground bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground");
function Tag({ children }: { children: ReactNode }) {
  return <span className="num rounded bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">{children}</span>;
}

/** Opens a signal's source: the filing or exhibit at the quoted passage, or the article or transcript at the quote. */
function useOpenSignal(exhibitOnly = false) {
  const { open } = useSource();
  return (s: Signal) => {
    const filed = exhibitOnly ? s.source_kind === "exhibit" : s.source_kind === "filing" || s.source_kind === "exhibit";
    if (filed && s.accn && s.doc)
      open({ ticker: s.ticker, label: s.title, unit: "usd", value: 0, doc: { accn: s.accn, doc: s.doc, form: s.form ?? "", filed: s.filed ?? "", title: `${s.ticker} ${s.form}`, search: s.quote } });
    else if (s.url) open({ ticker: s.ticker, label: s.title, unit: "usd", value: 0, external: { url: quoteLink(s.url, s.quote), quote: s.quote, date: s.filed ?? undefined, confidence: `${signalConfidence(s)} confidence` } });
  };
}

/** Every signal, newest first, filtered by type, impact and country. Six a page, so the list never becomes the page. */
export function SignalsByType({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const [kind, setKind] = useState("all");
  const [impact, setImpact] = useState<"all" | "risk" | "positive">("all");
  const [country, setCountry] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const openSig = useOpenSignal();
  const all = useMemo(() => (data ?? []).map((s) => ({ ...s, country: normCountry(s.country) })), [data]);
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.v, k.v === "all" ? all.length : all.filter((s) => s.kind === k.v).length])), [all]);
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of all) if (s.country) m.set(s.country, (m.get(s.country) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  }, [all]);
  const shown = useMemo(() => all
    .filter((s) => kind === "all" || s.kind === kind)
    .filter((s) => impact === "all" || s.impact === impact)
    .filter((s) => !country || s.country === country)
    .sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || a.id.localeCompare(b.id)), [all, kind, impact, country]);
  useEffect(() => { setPage(0); }, [kind, impact, country, ticker]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const rows = shown.slice(at * PAGE, at * PAGE + PAGE);
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <div data-section="Signals by type">
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Type of statement" data-agent-controls>
        {KINDS.filter((k) => k.v === "all" || counts[k.v] > 0).map((k) => (
          <button key={k.v} type="button" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} className={pill(kind === k.v)}>{k.label} <span className="num font-normal text-muted-foreground">{counts[k.v]}</span></button>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        {(["all", "risk", "positive"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={impact === v} onClick={() => setImpact(v)} className={pill(impact === v)}>{v === "all" ? "Any impact" : v === "risk" ? "Risk" : "Positive"}</button>
        ))}
      </div>
      {countries.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Country named" data-agent-controls>
          <span className="text-[11px] text-muted-foreground">Country</span>
          <button type="button" aria-pressed={!country} onClick={() => setCountry(null)} className={pill(!country)}>Any</button>
          {countries.map(([c, n]) => <button key={c} type="button" aria-pressed={country === c} onClick={() => setCountry(country === c ? null : c)} className={pill(country === c)}>{c} <span className="num font-normal text-muted-foreground">{n}</span></button>)}
        </div>
      )}
      <div className="mb-2 flex h-7 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{shown.length ? <><span className="num">{at * PAGE + 1}</span> to <span className="num">{Math.min(shown.length, at * PAGE + PAGE)}</span> of <span className="num">{shown.length}</span>, newest first</> : "No statements"}</span>
        {pages > 1 && (
          <span className="inline-flex gap-1" role="group" aria-label="Pages" data-agent-controls>
            <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className={cn(pill(false), "disabled:opacity-40")}>Newer</button>
            <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className={cn(pill(false), "disabled:opacity-40")}>Older</button>
          </span>
        )}
      </div>
      {!rows.length ? <p className="text-xs text-muted-foreground">Nothing matches these filters.</p> : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((s) => {
            const Icon = SRC_ICON[s.source_kind] ?? FileText;
            const conc = s.kind === "concentration" ? BASIS[concentrationBasis(s.quote)] : "";
            return (
              <li key={s.id} className="min-w-0">
                <button type="button" onClick={() => openSig(s)} className="block h-full w-full rounded-md border p-3 text-left transition-colors duration-150 hover:border-foreground/35 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-start gap-2 text-[13px] font-medium leading-5">
                      <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.impact === "risk" ? "bg-negative" : s.impact === "positive" ? "bg-positive" : "bg-muted-foreground/50")} />
                      <span className="min-w-0">{s.title}<span className="sr-only"> ({s.impact})</span></span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] leading-5 text-muted-foreground">
                      <Icon className="size-3" aria-hidden="true" />{SRC_LABEL[s.source_kind] ?? s.source_kind}{s.filed ? ` · ${fmtDate(s.filed)}` : ""}
                      {(s.source_kind === "web" || s.source_kind === "transcript") && <ExternalLink className="size-3" aria-hidden="true" />}
                    </span>
                  </span>
                  {s.detail && <span className="mt-1 block text-xs text-muted-foreground">{s.detail}</span>}
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {s.counterparty && <Tag>{s.counterparty}</Tag>}
                    {s.country && !s.counterparty?.includes(s.country) && <Tag>{s.country}</Tag>}
                    {s.amount_usd != null && <Tag>{fmtCompactUsd(s.amount_usd)}</Tag>}
                    {s.pct != null && <Tag>{s.pct}%{conc ? ` ${conc}` : ""}</Tag>}
                    {s.period && <Tag>{s.period}</Tag>}
                    {s.speaker && <Tag>{s.speaker}</Tag>}
                  </span>
                  <span className="mt-2 block border-l-2 border-border pl-2 text-xs italic leading-relaxed text-muted-foreground">“{s.quote}”</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const CONF_STYLE: Record<CpConfidence, string> = {
  high: "bg-positive-soft text-positive",
  medium: "bg-muted text-foreground",
  low: "border border-dashed text-muted-foreground",
};
const CONF_TIP: Record<CpConfidence, string> = {
  high: "Signed contract exhibit that names this party",
  medium: "Named on an earnings call, or a contract with an unnamed party",
  low: "Indirect mention: check the source",
};
function ConfBadge({ c, short }: { c: CpConfidence; short?: boolean }) {
  return <span title={CONF_TIP[c]} className={cn("shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4", CONF_STYLE[c])}>{c}{short ? "" : " confidence"}</span>;
}

/** Every party named in a contract exhibit or on a call, and the dated statements about it. */
export function SignalsByCounterparty({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const openSig = useOpenSignal(true);
  const groups = useMemo(() => byCounterparty(data ?? []), [data]);
  const [sel, setSel] = useState<string | null>(null);
  const g = groups.find((x) => x.key === sel) ?? groups[0];
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!groups.length) return <p className="text-xs text-muted-foreground">No party is named in a contract exhibit or on a call for this company yet.</p>;
  return (
    <div data-section="Signals by counterparty" className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      <ul className="min-w-0 divide-y border-y" aria-label="Named counterparties">
        {groups.map((x) => (
          <li key={x.key}>
            <button type="button" aria-pressed={x.key === g?.key} onClick={() => setSel(x.key)}
              className={cn("block w-full px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none", x.key === g?.key && "bg-secondary")}>
              <span className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-medium">{x.name}</span><ConfBadge c={x.confidence} short /></span>
              <span className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                {x.contracts > 0 && <span className="num inline-flex items-center gap-1"><ScrollText className="size-3" aria-label="contract exhibits" />{x.contracts}</span>}
                {x.calls > 0 && <span className="num inline-flex items-center gap-1"><Mic className="size-3" aria-label="call statements" />{x.calls}</span>}
                <span className="num ml-auto">{x.first && x.last && x.first !== x.last ? `${fmtDate(x.first)} to ${fmtDate(x.last)}` : x.last ? fmtDate(x.last) : "undated"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {g && (
        <div className="min-w-0">
          <p className="mb-2 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{g.name}</span>{g.amount != null && <Tag>largest stated {fmtCompactUsd(g.amount)}</Tag>}</p>
          <ol className="space-y-2">
            {g.signals.map((s) => {
              const Icon = s.kind === "contract" ? ScrollText : Mic;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => openSig(s)} className="block w-full rounded-md border p-3 text-left transition-colors duration-150 hover:border-foreground/35 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="num font-medium text-foreground">{s.filed ? fmtDate(s.filed) : "Undated"}</span>
                      <span className="inline-flex items-center gap-1"><Icon className="size-3" aria-hidden="true" />{s.kind === "contract" ? (s.form ?? "Contract exhibit") : (s.form ?? "Earnings call")}</span>
                      {s.speaker && <span className="min-w-0 truncate">{s.speaker}</span>}
                      <span className="ml-auto"><ConfBadge c={signalConfidence(s)} /></span>
                    </span>
                    <span className="mt-1 block text-[13px] font-medium leading-5">{s.title}</span>
                    {s.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{s.detail}</span>}
                    {(s.amount_usd != null || s.pct != null || s.period) && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {s.amount_usd != null && <Tag>{fmtCompactUsd(s.amount_usd)}</Tag>}
                        {s.pct != null && <Tag>{s.pct}%</Tag>}
                        {s.period && <Tag>{s.period}</Tag>}
                      </span>
                    )}
                    <span className="mt-2 block border-l-2 border-border pl-2 text-xs italic leading-relaxed text-muted-foreground">“{s.quote}”</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
