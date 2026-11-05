import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Mic, Newspaper, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

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
const SRC_ICON = { filing: FileText, exhibit: ScrollText, transcript: Mic, web: Newspaper } as Record<string, typeof FileText>;
const SRC_LABEL: Record<string, string> = { filing: "10-K", exhibit: "Contract exhibit", transcript: "Earnings call", web: "News" };

export function SupplyIntel({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["supply_signals", ticker],
    queryFn: async () => {
      const { data, error } = await supabase.from("supply_signals").select("*").eq("ticker", ticker).limit(1000);
      if (error) throw error;
      return (data ?? []) as Signal[];
    },
    staleTime: 10 * 60_000,
  });
  const [kind, setKind] = useState("all");
  const [impact, setImpact] = useState<"all" | "risk" | "positive">("all");
  const [country, setCountry] = useState<string | null>(null);
  const { open } = useSource();
  const all = data ?? [];

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
              {KINDS.map((k) => (
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
                      {s.country && <Chip>{s.country}</Chip>}
                      {s.amount_usd != null && <Chip>{fmtCompactUsd(s.amount_usd)}</Chip>}
                      {s.pct != null && <Chip>{s.pct}%</Chip>}
                      {s.period && <Chip>{s.period}</Chip>}
                      {s.speaker && <Chip>{s.speaker}</Chip>}
                    </div>
                    <p className="mt-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">“{s.quote}”</p>
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
                    <div className="flex justify-between"><span>{c}</span><span className="text-muted-foreground">{v.facility ? `${v.facility} sites · ` : ""}{v.policy ? `${v.policy} policy · ` : ""}{v.risk} risk</span></div>
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
                      <div className="flex justify-between gap-2"><span className="truncate">{s.counterparty ?? s.title}</span><span className="tabular-nums">{s.pct}%{s.period ? ` · ${s.period}` : ""}</span></div>
                      <div className="mt-0.5 h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, s.pct ?? 0)}%` }} /></div>
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
