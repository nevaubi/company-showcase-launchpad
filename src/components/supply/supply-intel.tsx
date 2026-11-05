import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Mic, Newspaper, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { concentrationBasis } from "@/lib/supply/core";
import { byCounterparty, signalConfidence, type CpConfidence } from "@/lib/supply/counterparty";
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
  { v: "policy", label: "Tariffs, laws & politics" },
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

export const signalsQuery = (ticker: string) => ({
  queryKey: ["supply_signals", ticker],
  queryFn: async () => {
    const { data, error } = await supabase.from("supply_signals").select("*").eq("ticker", ticker).limit(1000);
    if (error) throw error;
    return (data ?? []) as Signal[];
  },
  staleTime: 10 * 60_000,
});

export function SupplyIntel({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const [kind, setKind] = useState("all");
  const [impact, setImpact] = useState<"all" | "risk" | "positive">("all");
  const [country, setCountry] = useState<string | null>(null);
  const { open } = useSource();
  const all = useMemo(() => (data ?? []).map((s) => ({ ...s, country: normCountry(s.country) })), [data]);

  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.v, k.v === "all" ? all.length : all.filter((s) => s.kind === k.v).length])), [all]);
  const countries = useMemo(() => {
    const m = new Map<string, { n: number; risk: number; facility: number; policy: number }>();
    for (const s of all) {
      if (!s.country) continue;
      const c = m.get(s.country) ?? { n: 0, risk: 0, facility: 0, policy: 0 };
      c.n++; if (s.impact === "risk") c.risk++; if (s.kind === "facility") c.facility++; if (s.kind === "policy") c.policy++;
      m.set(s.country, c);
    }
    return [...m].sort((a, b) => b[1].n - a[1].n).slice(0, 14);
  }, [all]);
  const conc = useMemo(() => all.filter((s) => s.kind === "concentration" && s.pct != null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)), [all]);
  const shown = all
    .filter((s) => kind === "all" || s.kind === kind)
    .filter((s) => impact === "all" || s.impact === impact)
    .filter((s) => !country || s.country === country)
    .sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""));
  const maxN = countries[0]?.[1].n ?? 1;

  const openSig = (s: Signal) => {
    if ((s.source_kind === "filing" || s.source_kind === "exhibit") && s.accn && s.doc)
      open({ ticker: s.ticker, label: s.title, unit: "usd", value: 0, doc: { accn: s.accn, doc: s.doc, form: s.form ?? "", filed: s.filed ?? "", title: `${s.ticker} ${s.form}`, search: s.quote } });
    else if (s.url) window.open(s.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Panel title="Alt-data intelligence" subtitle="Contract terms, earnings-call statements, management actions, customer concentration, facility locations and country-level tariff, law and political factors — each quoted verbatim from its filing, exhibit, transcript or article.">
      {isLoading ? <Skeleton className="h-64" /> : !all.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Still being read for this company — check back shortly.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {KINDS.filter((k) => k.v === "all" || counts[k.v] > 0).map((k) => (
                <button key={k.v} onClick={() => setKind(k.v)} className={cn("rounded-full border px-2.5 py-1 text-xs", kind === k.v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                  {k.label} <span className="opacity-70">{counts[k.v]}</span>
                </button>
              ))}
              <span className="mx-1 w-px bg-border" />
              {(["all", "risk", "positive"] as const).map((v) => (
                <button key={v} onClick={() => setImpact(v)} className={cn("rounded-full border px-2.5 py-1 text-xs capitalize", impact === v ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>{v === "all" ? "Any impact" : v}</button>
              ))}
              {country && <button onClick={() => setCountry(null)} className="rounded-full border border-foreground px-2.5 py-1 text-xs">{country} ✕</button>}
            </div>
            <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
              {shown.map((s) => {
                const Icon = SRC_ICON[s.source_kind] ?? FileText;
                return (
                  <button key={s.id} onClick={() => openSig(s)} className="block w-full rounded-md border border-border p-3 text-left hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", s.impact === "risk" ? "bg-destructive" : s.impact === "positive" ? "bg-primary" : "bg-muted-foreground/50")} />
                        {s.title}
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <Icon className="h-3 w-3" />{SRC_LABEL[s.source_kind]}{s.filed ? ` · ${fmtDate(s.filed)}` : ""}
                        {s.source_kind === "web" || s.source_kind === "transcript" ? <ExternalLink className="h-3 w-3" /> : null}
                      </span>
                    </div>
                    {s.detail && <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                      {s.counterparty && <Chip>{s.counterparty}</Chip>}
                      {s.country && !s.counterparty?.includes(s.country) && <Chip>{s.country}</Chip>}
                      {s.amount_usd != null && <Chip>{fmtCompactUsd(s.amount_usd)}</Chip>}
                      {s.pct != null && <Chip>{s.pct}%</Chip>}
                      {s.period && <Chip>{s.period}</Chip>}
                      {s.speaker && <Chip>{s.speaker}</Chip>}
                    </div>
                    <p className="mt-2 line-clamp-3 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">“{s.quote}”</p>
                  </button>
                );
              })}
              {!shown.length && <p className="py-6 text-center text-xs text-muted-foreground">Nothing matches these filters.</p>}
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Country footprint</h4>
              <div className="space-y-1">
                {countries.map(([c, v]) => (
                  <button key={c} onClick={() => setCountry(country === c ? null : c)} className={cn("block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50", country === c && "bg-muted")}>
                    <div className="flex justify-between"><span>{c}</span><span className="text-muted-foreground">{[v.facility && `${v.facility} site${v.facility > 1 ? "s" : ""}`, v.policy && `${v.policy} policy`, v.risk && `${v.risk} risk`].filter(Boolean).join(" · ") || `${v.n} mention${v.n > 1 ? "s" : ""}`}</span></div>
                    <div className="relative mt-0.5 h-1.5 rounded bg-muted">
                      <div className="absolute inset-y-0 left-0 rounded bg-foreground/25" style={{ width: `${(v.n / maxN) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded bg-destructive/80" style={{ width: `${(v.risk / maxN) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {conc.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stated concentration</h4>
                <div className="space-y-1.5">
                  {conc.slice(0, 8).map((s) => (
                    <button key={s.id} onClick={() => openSig(s)} className="block w-full text-left text-xs hover:opacity-80">
                      <div className="flex items-start justify-between gap-2"><span className="line-clamp-2">{s.counterparty ?? s.title}</span><span className="shrink-0 tabular-nums font-medium">{s.pct}%</span></div>
                      <div className="text-[10.5px] text-muted-foreground">{[BASIS[concentrationBasis(s.quote)], s.period].filter(Boolean).join(" · ")}</div>
                      <div className="mt-0.5 h-1.5 rounded bg-muted"><div className={cn("h-full rounded", concentrationBasis(s.quote) === "revenue" ? "bg-primary" : "bg-foreground/30")} style={{ width: `${Math.min(100, s.pct ?? 0)}%` }} /></div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{children}</span>;
}

const CONF_STYLE: Record<CpConfidence, string> = {
  high: "border-primary/40 bg-primary/10 text-primary",
  medium: "border-border bg-muted text-foreground",
  low: "border-dashed border-border text-muted-foreground",
};
const CONF_TIP: Record<CpConfidence, string> = {
  high: "Signed contract exhibit that names this party",
  medium: "Named on an earnings call, or a contract with an unnamed party",
  low: "Indirect mention — verify in the source",
};
function ConfBadge({ c, short }: { c: CpConfidence; short?: boolean }) {
  return <span title={CONF_TIP[c]} className={cn("shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-medium capitalize", CONF_STYLE[c])}>{c}{short ? "" : " confidence"}</span>;
}

export function CounterpartyEvidence({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery(signalsQuery(ticker));
  const { open } = useSource();
  const groups = useMemo(() => byCounterparty(data ?? []), [data]);
  const [sel, setSel] = useState<string | null>(null);
  const g = groups.find((x) => x.key === sel) ?? groups[0];
  const openSig = (s: Signal) => {
    if (s.source_kind === "exhibit" && s.accn && s.doc)
      open({ ticker: s.ticker, label: s.title, unit: "usd", value: 0, doc: { accn: s.accn, doc: s.doc, form: s.form ?? "", filed: s.filed ?? "", title: `${s.ticker} ${s.form}`, search: s.quote } });
    else if (s.url) window.open(s.url, "_blank", "noopener,noreferrer");
  };
  return (
    <Panel title="Contracts & earnings calls by counterparty" subtitle="Every named party in filed contract exhibits and management's call remarks, with dates and a confidence label. Click a statement to open its source at the quoted passage.">
      {isLoading ? <Skeleton className="h-64" /> : !groups.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No named counterparties in contracts or calls yet for this company.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="max-h-[560px] min-w-0 space-y-1 overflow-y-auto pr-1">
            {groups.map((x) => (
              <button key={x.key} onClick={() => setSel(x.key)} className={cn("block w-full rounded-md border p-2 text-left text-xs hover:bg-muted/50", x.key === g?.key ? "border-foreground/40 bg-muted/60" : "border-border")}>
                <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{x.name}</span><ConfBadge c={x.confidence} short /></div>
                <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground">
                  {x.contracts > 0 && <span className="flex items-center gap-1"><ScrollText className="h-3 w-3" />{x.contracts}</span>}
                  {x.calls > 0 && <span className="flex items-center gap-1"><Mic className="h-3 w-3" />{x.calls}</span>}
                  <span className="ml-auto">{x.first && x.last && x.first !== x.last ? `${fmtDate(x.first)} – ${fmtDate(x.last)}` : x.last ? fmtDate(x.last) : "undated"}</span>
                </div>
              </button>
            ))}
          </div>
          {g && (
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h4 className="text-base font-semibold">{g.name}</h4>
                {g.amount != null && <Chip>largest stated {fmtCompactUsd(g.amount)}</Chip>}
              </div>
              <ol className="max-h-[520px] space-y-2 overflow-y-auto border-l border-border pl-4">
                {g.signals.map((s) => {
                  const c = signalConfidence(s);
                  const Icon = s.kind === "contract" ? ScrollText : Mic;
                  return (
                    <li key={s.id} className="relative">
                      <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground/40" />
                      <button onClick={() => openSig(s)} className="block w-full rounded-md border border-border p-3 text-left hover:bg-muted/50">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-medium tabular-nums text-foreground">{s.filed ? fmtDate(s.filed) : "Undated"}</span>
                          <span className="flex items-center gap-1"><Icon className="h-3 w-3" />{s.kind === "contract" ? (s.form ?? "Contract exhibit") : (s.form ?? "Earnings call")}</span>
                          {s.speaker && <span>· {s.speaker}</span>}
                          <span className="ml-auto"><ConfBadge c={c} /></span>
                        </div>
                        <div className="mt-1 text-sm font-medium">{s.title}</div>
                        {s.detail && <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>}
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                          {s.amount_usd != null && <Chip>{fmtCompactUsd(s.amount_usd)}</Chip>}
                          {s.pct != null && <Chip>{s.pct}%</Chip>}
                          {s.period && <Chip>{s.period}</Chip>}
                        </div>
                        <p className="mt-2 line-clamp-4 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">“{s.quote}”</p>
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">Open source <ExternalLink className="h-3 w-3" /></span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
