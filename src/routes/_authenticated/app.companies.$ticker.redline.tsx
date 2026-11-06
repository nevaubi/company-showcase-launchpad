import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRight, GitCompareArrows, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Panel, Empty } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeCard, TYPE_LABEL } from "@/components/redline/change-card";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/data";
import { coverageOf } from "@/lib/coverage";
import { defaultBase, REDLINE_VERSION, textsOf, type FilingRef, type Redline } from "@/lib/redline/core";
import { getFilingDocument } from "@/lib/sec.functions";
import { summarizeRedline } from "@/lib/redline.functions";
import type { RedlineSummary } from "@/lib/redline/summary";
import type { Filing } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/redline")({
  validateSearch: z.object({
    form: z.enum(["10-K", "10-Q"]).optional(),
    to: z.string().regex(/^\d{10}-\d{2}-\d{6}$/).optional(),
    from: z.string().regex(/^\d{10}-\d{2}-\d{6}$/).optional(),
    section: z.string().max(8).optional(),
  }),
  head: ({ params }) => {
    const name = coverageOf(params.ticker)?.shortName ?? params.ticker.toUpperCase();
    return {
      meta: [
        { title: `${params.ticker.toUpperCase()} filing changes — 10-K and 10-Q redlines — Filed Under` },
        { name: "description", content: `What ${name} changed in its latest 10-K and 10-Q: new and removed risk factors, rewritten MD&A, legal and controls language, ranked by materiality with links to both filings.` },
        { property: "og:title", content: `${name} filing changes — Filed Under` },
        { property: "og:description", content: "Paragraph-level SEC filing redlines ranked by materiality." },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: RedlinePage,
});

type LevelFilter = "high" | "medium" | "all";
type TypeFilter = "all" | "added" | "removed" | "changed";
const PAGE = 30;
const ref = (f: Filing): FilingRef => ({ accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, report: f.report });

function useRedline(ticker: string, cik: string | undefined, form: "10-K" | "10-Q", from: Filing | null, to: Filing | null) {
  return useQuery({
    queryKey: ["redline", from?.accn, to?.accn, REDLINE_VERSION],
    enabled: !!from && !!to && !!cik,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<{ redline: Redline; stored: boolean; summary: RedlineSummary | null }> => {
      const { data: row } = await supabase.from("filing_redlines").select("payload, summary")
        .eq("from_accn", from!.accn).eq("to_accn", to!.accn).eq("version", REDLINE_VERSION).maybeSingle();
      if (row) return { redline: row.payload as unknown as Redline, stored: true, summary: (row.summary as unknown as RedlineSummary) ?? null };
      // Not precomputed: read both filings and compare them here.
      const [a, b] = await Promise.all([
        getFilingDocument({ data: { cik: cik!, accn: from!.accn, doc: from!.doc } }),
        getFilingDocument({ data: { cik: cik!, accn: to!.accn, doc: to!.doc } }),
      ]);
      const { computeRedlineInBrowser } = await import("@/lib/redline/compute-browser");
      const redline = await computeRedlineInBrowser({ ticker, form, from: ref(from!), to: ref(to!), oldHtml: a.html, newHtml: b.html });
      return { redline, stored: false, summary: null };
    },
  });
}

function RedlinePage() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const cov = coverageOf(ticker);
  const form = search.form ?? "10-K";
  const filings = useMemo(() => (company.data?.filings ?? []).filter((f) => f.form === form && f.doc).sort((a, b) => b.filed.localeCompare(a.filed)), [company.data, form]);
  const to = filings.find((f) => f.accn === search.to) ?? filings[0] ?? null;
  const base = to ? defaultBase(company.data?.filings.filter((f) => f.doc) ?? [], to) : null;
  const from = filings.find((f) => f.accn === search.from && to && f.filed < to.filed) ?? base;
  const q = useRedline(ticker, cov ? String(Number(cov.cik)) : undefined, form, from, to);

  const [level, setLevel] = useSessionState<LevelFilter>("redline:level", "medium", (v): v is LevelFilter => v === "high" || v === "medium" || v === "all");
  const [type, setType] = useState<TypeFilter>("all");
  const [figures, setFigures] = useState(false);
  const [text, setText] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [focus, setFocus] = useState<string | null>(null);
  const section = search.section ?? "all";
  const jumpTo = useRef<string | null>(null);
  useEffect(() => { if (!jumpTo.current) setShown(PAGE); }, [section, level, type, figures, text, from?.accn, to?.accn]);

  const r = q.data?.redline;
  const titles = new Map((r?.sections ?? []).map((s) => [s.key, s.title]));
  const visible = useMemo(() => {
    if (!r) return [];
    const needle = text.trim().toLowerCase();
    return r.changes.filter((c) =>
      (section === "all" || c.section === section) &&
      (figures || !c.figuresOnly) &&
      (level === "all" || (level === "high" ? c.level === "high" : c.level !== "low")) &&
      (type === "all" || c.type === type) &&
      (!needle || [textsOf(c).before, textsOf(c).after, c.context].some((t) => t?.toLowerCase().includes(needle))),
    ).sort((a, b) => b.score - a.score);
  }, [r, section, level, type, figures, text]);
  // After a jump from the brief, render far enough down the list and scroll to the change.
  useEffect(() => {
    const id = jumpTo.current;
    if (!id) return;
    const i = visible.findIndex((c) => c.id === id);
    if (i < 0) return;
    jumpTo.current = null;
    setShown((n) => Math.max(n, i + 5));
    setTimeout(() => document.getElementById(`change-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [visible]);
  const totals = useMemo(() => {
    const cs = r?.changes.filter((c) => !c.figuresOnly) ?? [];
    const risk = cs.filter((c) => c.section === "1A" || c.section === "II-1A");
    return {
      newRisks: risk.filter((c) => c.type === "added" && c.isHeading).length,
      removedRisks: risk.filter((c) => c.type === "removed" && c.isHeading).length,
      added: cs.filter((c) => c.type === "added").length,
      removed: cs.filter((c) => c.type === "removed").length,
      changed: cs.filter((c) => c.type === "changed").length,
      high: cs.filter((c) => c.level === "high").length,
      medium: cs.filter((c) => c.level === "medium").length,
    };
  }, [r]);

  const setSearch = (s: Partial<{ form: "10-K" | "10-Q"; to: string | undefined; from: string | undefined; section: string | undefined }>) =>
    navigate({ search: (prev) => ({ ...prev, ...s }), replace: true });
  const jump = (id: string) => {
    const c = r?.changes.find((x) => x.id === id);
    if (!c) return;
    jumpTo.current = id;
    setFocus(id);
    const already = visible.some((x) => x.id === id);
    if (already) { jumpTo.current = null; setShown((n) => Math.max(n, visible.findIndex((x) => x.id === id) + 5)); setTimeout(() => document.getElementById(`change-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); return; }
    setSearch({ section: undefined });
    setLevel("all"); setType("all"); setText(""); if (c.figuresOnly) setFigures(true);
  };

  if (company.isLoading) return <Skeleton className="h-96" />;
  if (!filings.length) return <Empty title={`No ${form} filings to compare`} icon={<GitCompareArrows />}>Pick another form type.</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Form" value={form} onChange={(v) => setSearch({ form: v, to: undefined, from: undefined, section: undefined })} options={[{ v: "10-K", l: "Annual (10-K)" }, { v: "10-Q", l: "Quarterly (10-Q)" }]} />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
          <FilingSelect label="Compare" value={from?.accn} options={filings.filter((f) => to && f.filed < to.filed)} onChange={(v) => setSearch({ from: v })} />
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <FilingSelect label="with" value={to?.accn} options={filings} onChange={(v) => setSearch({ to: v, from: undefined })} />
        </div>
        {from && base && from.accn === base.accn && <span className="text-[11px] text-muted-foreground">{form === "10-Q" ? "Same quarter a year earlier" : "Prior annual report"}</span>}
      </div>

      {q.isLoading ? (
        <Panel collapse={false} bodyClassName="p-0"><div className="space-y-3 p-4" aria-live="polite"><p className="text-shimmer text-sm font-medium">Reading both filings and lining up every paragraph…</p><Skeleton className="h-16" /><Skeleton className="h-40" /></div></Panel>
      ) : q.isError || !r ? (
        <Panel collapse={false} bodyClassName="p-0"><div className="p-6 text-center"><p className="font-medium">Couldn't compare these filings</p><p className="mt-1 text-sm text-muted-foreground">{(q.error as Error)?.message ?? "Try another pair."}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => q.refetch()}>Try again</Button></div></Panel>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px overflow-hidden border bg-border sm:grid-cols-4 xl:grid-cols-8">
            {[
              ["New risk factors", totals.newRisks], ["Risk factors removed", totals.removedRisks], ["Paragraphs added", totals.added],
              ["Paragraphs removed", totals.removed], ["Rewritten", totals.changed], ["High materiality", totals.high], ["Medium", totals.medium], ["Sections compared", r.sections.filter((x) => x.found === "both").length],
            ].map(([l, v]) => (
              <div key={l as string} className="bg-card px-3 py-2">
                <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{l}</p>
                <p className={cn("num text-lg font-semibold", l === "High materiality" && (v as number) > 0 && "text-negative")}>{v as number}</p>
              </div>
            ))}
          </section>

          <SummaryPanel stored={q.data!.stored} initial={q.data!.summary} from={from!} to={to!} onJump={jump} titles={titles} r={r} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <nav aria-label="Sections" className="flex min-w-0 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {[{ key: "all", title: "All sections", n: r.changes.filter((c) => !c.figuresOnly).length, high: totals.high, found: "both" as const }, ...r.sections.map((s) => ({ key: s.key, title: s.title, n: s.added + s.removed + s.changed, high: s.high, found: s.found }))].map((s) => (
                <button key={s.key} type="button" onClick={() => setSearch({ section: s.key === "all" ? undefined : s.key })} disabled={s.found !== "both"}
                  className={cn("flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary disabled:opacity-50",
                    section === s.key && "bg-secondary font-medium")}>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.found !== "both" ? <span className="text-[10px] text-muted-foreground">{s.found === "new" ? "new only" : "not found"}</span> : (
                    <>
                      {s.high > 0 && <span className="num rounded bg-negative/10 px-1 text-[10.5px] text-negative">{s.high}</span>}
                      <span className="num text-[11px] text-muted-foreground">{s.n}</span>
                    </>
                  )}
                </button>
              ))}
            </nav>

            <Panel
              className="min-w-0"
              bodyClassName="p-0"
              collapse={false}
              title={section === "all" ? "Changes ranked by materiality" : titles.get(section)}
              subtitle={`${visible.length} shown · ${fmtDate(from!.filed)} → ${fmtDate(to!.filed)}${q.data!.stored ? "" : " · compared just now"}`}
              actions={
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find words, e.g. tariff" className="h-7 w-48 pl-7 text-xs" aria-label="Search changes" />
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
                <Segmented label="Materiality" value={level} onChange={setLevel} options={[{ v: "high", l: "High" }, { v: "medium", l: "High + medium" }, { v: "all", l: "All" }]} />
                <Segmented label="Change type" value={type} onChange={setType} options={[{ v: "all", l: "Any change" }, { v: "added", l: "Added" }, { v: "removed", l: "Removed" }, { v: "changed", l: "Rewritten" }]} />
                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={figures} onCheckedChange={setFigures} aria-label="Show figure-only updates" /> Figure-only updates</label>
              </div>
              {!visible.length ? (
                <Empty title="Nothing matches" icon={<GitCompareArrows />}>{level !== "all" ? "Try showing all materiality levels." : "Try another section or search."}</Empty>
              ) : (
                <div>
                  {visible.slice(0, shown).map((c) => <ChangeCard key={c.id} c={c} ticker={ticker} sectionTitle={titles.get(c.section) ?? c.section} from={r.from} to={r.to} highlighted={focus === c.id} />)}
                  {visible.length > shown && (
                    <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}</Button></div>
                  )}
                </div>
              )}
            </Panel>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Compared paragraph by paragraph from the filings' text; tables are left out because their figures are covered by the reported statements. Materiality is a rule-based score (topic, size and wording of each change), not an opinion.
          </p>
        </>
      )}
    </div>
  );
}

function FilingSelect({ label, value, options, onChange }: { label: string; value: string | undefined; options: Filing[]; onChange: (v: string) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[11.5rem] text-xs" aria-label={`${label} filing`}><SelectValue placeholder="Choose a filing" /></SelectTrigger>
        <SelectContent>
          {options.map((f) => (
            <SelectItem key={f.accn} value={f.accn} className="text-xs">{f.form} · filed {fmtDate(f.filed)}{f.report ? ` · period ${fmtDate(f.report, { month: "short", year: "numeric" })}` : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

function SummaryPanel({ stored, initial, from, to, onJump, titles, r }: { stored: boolean; initial: RedlineSummary | null; from: Filing; to: Filing; onJump: (id: string) => void; titles: Map<string, string>; r: Redline }) {
  const qc = useQueryClient();
  const [state, setState] = useState<{ loading: boolean; error: string | null; summary: RedlineSummary | null }>({ loading: false, error: null, summary: initial });
  useEffect(() => setState({ loading: false, error: null, summary: initial }), [initial, from.accn, to.accn]);
  const run = async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const summary = await summarizeRedline({ data: { fromAccn: from.accn, toAccn: to.accn } });
      setState({ loading: false, error: null, summary });
      qc.setQueryData(["redline", from.accn, to.accn, REDLINE_VERSION], (old: { redline: Redline; stored: boolean; summary: RedlineSummary | null } | undefined) => (old ? { ...old, summary } : old));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  };
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const key = `${from.accn}:${to.accn}`;
    if (stored && !initial && asked.current !== key) { asked.current = key; void run(); }
  }, [stored, initial, from.accn, to.accn]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(r.changes.map((c) => [c.id, c]));
  const s = state.summary;

  return (
    <Panel collapse={false} bodyClassName="p-0" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" /> What changed</span>}
      subtitle={s && s.bullets.length ? <span className="inline-flex items-center gap-1 text-positive"><ShieldCheck className="size-3" /> Every point quotes the filing verbatim</span> : undefined}>
      <div className="px-3.5 py-3 text-[13px]">
        {!stored ? (
          <p className="text-muted-foreground">Briefs are written for the standard comparisons (latest annual vs prior, latest quarter vs a year earlier). The ranked changes below cover this pair in full.</p>
        ) : state.loading ? (
          <p className="text-shimmer">Reading the biggest changes…</p>
        ) : state.error ? (
          <p className="text-negative">{state.error} <button className="ml-1 underline" onClick={run}>Try again</button></p>
        ) : s ? (
          <>
            <p className="font-medium">{s.headline}</p>
            {s.bullets.length > 0 && (
              <ul className="mt-2 space-y-2">
                {s.bullets.map((b, i) => (
                  <li key={i} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-1.5">
                    <span className="mt-2 size-1.5 rounded-full bg-foreground/60" />
                    <span>
                      {b.text}{" "}
                      <span className="text-muted-foreground">“{b.quote}”</span>{" "}
                      {b.changeIds.map((id) => {
                        const c = byId.get(id);
                        return c ? <button key={id} type="button" onClick={() => onJump(id)} className="mr-1 rounded border px-1 text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">{titles.get(c.section) ?? c.section} · {TYPE_LABEL(c).toLowerCase()}</button> : null;
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </Panel>
  );
}
