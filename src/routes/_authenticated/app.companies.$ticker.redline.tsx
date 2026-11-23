import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRight, ChevronLeft, ChevronRight, GitCompareArrows, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Panel, Empty } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeCard, TYPE_LABEL } from "@/components/redline/change-card";
import { Pager, QuietLine } from "@/components/filings/parts";
import { paginate } from "@/lib/filings/list";
import { LEVEL_LABEL, redlineVerdict, verdictSentence, type Verdict } from "@/lib/filings/redline-verdict";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/data";
import { coverageOf, historyCik } from "@/lib/coverage";
import { defaultBase, REDLINE_VERSION, textsOf, type FilingRef, type Redline } from "@/lib/redline/core";
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
        { title: `${params.ticker.toUpperCase()} filing changes · 10-K and 10-Q redlines · FiledUnder` },
        { name: "description", content: `What ${name} changed in its latest 10-K and 10-Q: new and removed risk factors, rewritten MD&A, legal and controls language, ranked by materiality with links to both filings.` },
        { property: "og:title", content: `${name} filing changes · FiledUnder` },
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
      // Not precomputed: the server reads both filings, compares them and stores the result for everyone.
      const { computeRedline } = await import("@/lib/redline.functions");
      return computeRedline({ data: { ticker, cik: cik!, form, from: ref(from!), to: ref(to!) } });
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
  // The dataset's filings are listed under the CIK the dataset was built from (the history CIK when
  // the company changed registrant): their archive URLs resolve only under that CIK.
  const cik = company.data?.profile.cik ? String(Number(company.data.profile.cik)) : cov ? String(Number(historyCik(cov))) : undefined;
  const q = useRedline(ticker, cik, form, from, to);

  const [level, setLevel] = useSessionState<LevelFilter>("redline:level", "medium", (v): v is LevelFilter => v === "high" || v === "medium" || v === "all");
  const [type, setType] = useState<TypeFilter>("all");
  const [figures, setFigures] = useState(false);
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const section = search.section ?? "all";
  const jumpTo = useRef<string | null>(null);
  const listTop = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!jumpTo.current) setPage(1); }, [section, level, type, figures, text, from?.accn, to?.accn]);

  const r = q.data?.redline;
  const titles = new Map((r?.sections ?? []).map((s) => [s.key, s.title]));
  const verdict = useMemo(() => (r ? redlineVerdict(r) : null), [r]);
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
  const pg = paginate(visible, page, PAGE);
  // After a jump from the brief, open the page that holds the change and bring it into view (an explicit "go to" action).
  useEffect(() => {
    const id = jumpTo.current;
    if (!id) return;
    const i = visible.findIndex((c) => c.id === id);
    if (i < 0) return;
    jumpTo.current = null;
    setPage(Math.floor(i / PAGE) + 1);
    setTimeout(() => document.getElementById(`change-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [visible]);

  const setSearch = (s: Partial<{ form: "10-K" | "10-Q"; to: string | undefined; from: string | undefined; section: string | undefined }>) =>
    navigate({ search: (prev) => ({ ...prev, ...s }), replace: true, resetScroll: false });
  const jump = (id: string) => {
    const c = r?.changes.find((x) => x.id === id);
    if (!c) return;
    jumpTo.current = id;
    setFocus(id);
    const i = visible.findIndex((x) => x.id === id);
    if (i >= 0) { jumpTo.current = null; setPage(Math.floor(i / PAGE) + 1); setTimeout(() => document.getElementById(`change-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); return; }
    setSearch({ section: undefined });
    setLevel("all"); setType("all"); setText(""); if (c.figuresOnly) setFigures(true);
  };
  // Paging from the bottom of the list brings the top of the new page into view; paging from the top does not move the page.
  const turn = (n: number, fromBottom: boolean) => {
    setPage(n);
    if (fromBottom) requestAnimationFrame(() => listTop.current?.scrollIntoView({ block: "start" }));
  };

  if (company.isLoading) return <Skeleton className="h-96" />;
  if (!filings.length) return <Empty title={`No ${form} filings to compare`} icon={<GitCompareArrows />}>Pick another form type.</Empty>;

  const compared = (verdict?.sections ?? []).filter((s) => s.found === "both");
  const order = compared.map((s) => s.key);
  const at = order.indexOf(section);
  const prevKey = section === "all" ? null : at > 0 ? order[at - 1] : "all";
  const nextKey = section === "all" ? order[0] ?? null : at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const sectionLabel = (k: string | null) => (k === "all" ? "All sections" : k ? titles.get(k) ?? k : "");

  return (
    <div className="grid grid-cols-1 gap-4">
      <div data-section="Comparison" className="flex flex-wrap items-center gap-2">
        <Segmented label="Form" value={form} onChange={(v) => setSearch({ form: v, to: undefined, from: undefined, section: undefined })} options={[{ v: "10-K", l: "Annual (10-K)" }, { v: "10-Q", l: "Quarterly (10-Q)" }]} />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
          <FilingSelect label="Compare" value={to?.accn} options={filings} onChange={(v) => setSearch({ to: v, from: undefined })} />
          <ArrowRight className="size-3.5 rotate-180 text-muted-foreground" />
          <FilingSelect label="against" value={from?.accn} options={filings.filter((f) => to && f.filed < to.filed)} onChange={(v) => setSearch({ from: v })} />
        </div>
        {from && base && from.accn === base.accn && <span className="text-[11px] text-muted-foreground">{form === "10-Q" ? "Same quarter a year earlier" : "Prior annual report"}</span>}
      </div>

      {q.isLoading ? (
        <Panel collapse={false} bodyClassName="p-0"><div className="space-y-3 p-4" aria-live="polite"><p className="text-shimmer text-sm font-medium">Reading both filings and lining up every paragraph…</p><Skeleton className="h-16" /><Skeleton className="h-40" /></div></Panel>
      ) : q.isError || !r || !verdict ? (
        <Panel collapse={false} bodyClassName="p-0"><div className="p-6 text-center"><p className="font-medium">Couldn't compare these filings</p><p className="mt-1 text-sm text-muted-foreground">{(q.error as Error)?.message ?? "Try another pair."}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => q.refetch()}>Try again</Button></div></Panel>
      ) : (
        <>
          <VerdictPanel v={verdict} from={from!} to={to!} stored={q.data!.stored} section={section} onSection={(k) => setSearch({ section: k === "all" ? undefined : k })} />

          <SummaryPanel stored={q.data!.stored} initial={q.data!.summary} from={from!} to={to!} onJump={jump} titles={titles} r={r} />

          <div data-section="Changes" className="min-w-0" ref={listTop} style={{ scrollMarginTop: "calc(var(--sticky-top, 3.5rem) + 8px)" }}>
            <Panel
              bodyClassName="p-0"
              collapse={false}
              title={section === "all" ? "All sections · changes ranked by materiality" : `${titles.get(section) ?? section} · changes ranked by materiality`}
              subtitle={`${visible.length.toLocaleString()} shown · ${from!.form} filed ${fmtDate(to!.filed)} against ${fmtDate(from!.filed)}${q.data!.stored ? "" : " · compared just now"}`}
            >
              <div className="sticky top-[var(--sticky-top,3.5rem)] z-10 grid grid-cols-1 gap-2 border-b bg-card/95 px-3.5 py-2 backdrop-blur">
                <div className="flex flex-wrap items-center gap-2">
                  {section !== "all" && (
                    <button type="button" onClick={() => setSearch({ section: undefined })} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
                      <ChevronLeft className="size-3.5" /> All sections
                    </button>
                  )}
                  <Select value={section} onValueChange={(v) => setSearch({ section: v === "all" ? undefined : v })}>
                    <SelectTrigger aria-label="Section" className="h-7 w-56 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All sections · {verdict.changed.toLocaleString()}</SelectItem>
                      {compared.map((s) => (
                        <SelectItem key={s.key} value={s.key} className="text-xs">{s.title} · {(s.added + s.removed + s.changed).toLocaleString()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {prevKey && <button type="button" onClick={() => setSearch({ section: prevKey === "all" ? undefined : prevKey })} className="inline-flex h-7 max-w-48 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground" title="Previous section by amount of change"><ChevronLeft className="size-3.5 shrink-0" /><span className="truncate">{sectionLabel(prevKey)}</span></button>}
                  {nextKey && <button type="button" onClick={() => setSearch({ section: nextKey })} className="inline-flex h-7 max-w-48 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground" title="Next section by amount of change"><span className="truncate">{sectionLabel(nextKey)}</span><ChevronRight className="size-3.5 shrink-0" /></button>}
                  <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find words, e.g. tariff" className="h-7 w-48 pl-7 text-xs" aria-label="Search changes" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented label="Materiality" size="xs" value={level} onChange={setLevel} options={[{ v: "high", l: "High" }, { v: "medium", l: "High + medium" }, { v: "all", l: "All" }]} />
                  <Segmented label="Change type" size="xs" value={type} onChange={setType} options={[{ v: "all", l: "Any change" }, { v: "added", l: "Added" }, { v: "removed", l: "Removed" }, { v: "changed", l: "Rewritten" }]} />
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><Switch checked={figures} onCheckedChange={setFigures} aria-label="Show figure-only updates" /> Figure-only updates</label>
                  <Pager p={pg} onPage={(n) => turn(n, false)} label="Change pages, top" className="ml-auto" />
                </div>
              </div>
              {!visible.length ? (
                <QuietLine className="py-6 text-center">{level !== "all" ? "Nothing at this materiality here. Try showing all levels." : "Nothing matches. Try another section or search."}</QuietLine>
              ) : (
                <div>
                  {pg.rows.map((c) => <ChangeCard key={c.id} c={c} ticker={ticker} sectionTitle={titles.get(c.section) ?? c.section} from={r.from} to={r.to} highlighted={focus === c.id} />)}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2">
                    {nextKey ? (
                      <button type="button" onClick={() => setSearch({ section: nextKey })} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">Next section: {sectionLabel(nextKey)} <ChevronRight className="size-3.5" /></button>
                    ) : <span />}
                    <Pager p={pg} onPage={(n) => turn(n, true)} label="Change pages, bottom" />
                  </div>
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

/** The verdict: which filing against which, how much changed and why, and the sections ranked by change (each one opens its changes). */
function VerdictPanel({ v, from, to, stored, section, onSection }: { v: Verdict; from: Filing; to: Filing; stored: boolean; section: string; onSection: (k: string) => void }) {
  const max = Math.max(1, ...v.sections.map((s) => s.added + s.removed + s.changed));
  const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)}%`;
  const facts: [string, string, boolean?][] = [
    ["Added", v.added.toLocaleString()],
    ["Removed", v.removed.toLocaleString()],
    ["Rewritten", v.rewritten.toLocaleString()],
    ["High materiality", v.high.toLocaleString(), v.high > 0],
    ["New risk factors", v.newRisks.toLocaleString()],
    ["Risk factors removed", v.removedRisks.toLocaleString()],
  ];
  return (
    <section data-section="Verdict" className="panel-in min-w-0 border-y bg-card/40">
      <div className="grid grid-cols-1 gap-4 px-3.5 py-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          <p className="eyebrow">{from.form} · {stored ? "stored comparison" : "compared just now"}</p>
          <p className="mt-1 text-[13px]">
            <span className="font-semibold">{from.form} filed {fmtDate(to.filed)}</span>
            {to.report && <span className="text-muted-foreground"> (period {fmtDate(to.report)})</span>} against <span className="font-semibold">{fmtDate(from.filed)}</span>
            {from.report && <span className="text-muted-foreground"> (period {fmtDate(from.report)})</span>}
          </p>
          <div className="mt-3 flex items-baseline gap-3">
            <span className={cn("num text-[18px] font-semibold", v.level === "major" && "text-negative")}>{pct(v.share)}</span>
            <span className="text-[13px] font-medium">{LEVEL_LABEL[v.level]}</span>
          </div>
          <p className="num text-[11px] text-muted-foreground">{v.changed.toLocaleString()} of {v.paragraphs.toLocaleString()} compared paragraphs added, removed or rewritten</p>
          <p className="mt-2 text-[13px]">{verdictSentence(v)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {facts.map(([l, x, warn]) => (
              <div key={l} className="flex items-baseline justify-between gap-2 border-b border-dashed py-0.5">
                <dt className="text-muted-foreground">{l}</dt>
                <dd className={cn("num", warn && "text-negative")}>{x}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold">Sections ranked by change</p>
            <p className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-positive" /> added</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-negative" /> removed</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-chart-5" /> rewritten</span>
            </p>
          </div>
          <div aria-hidden className="mt-1.5 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem_2.5rem] gap-2 border-b px-1.5 pb-1 text-[11px] text-muted-foreground">
            <span>Section</span><span className="invisible sm:visible">Paragraphs added, removed, rewritten</span><span className="text-right">Changes</span><span className="text-right">High</span>
          </div>
          <ul aria-label="Sections ranked by change">
            {v.sections.map((s) => {
              const n = s.added + s.removed + s.changed;
              const ok = s.found === "both";
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={!ok}
                    aria-pressed={section === s.key}
                    onClick={() => onSection(section === s.key ? "all" : s.key)}
                    className={cn(
                      "grid min-h-7 w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2 rounded px-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
                      section === s.key && "bg-secondary font-medium",
                    )}
                    title={ok ? `${s.added} added, ${s.removed} removed, ${s.changed} rewritten of ${s.paragraphs} paragraphs; ${s.high} high materiality` : undefined}
                  >
                    <span className={cn("truncate", !ok && "text-muted-foreground")}>{s.title}</span>
                    {ok ? (
                      <span className="flex h-2 min-w-0 overflow-hidden rounded-[2px] bg-secondary">
                        <span className="h-full bg-positive" style={{ width: `${(s.added / max) * 100}%` }} />
                        <span className="h-full bg-negative" style={{ width: `${(s.removed / max) * 100}%` }} />
                        <span className="h-full bg-chart-5" style={{ width: `${(s.changed / max) * 100}%` }} />
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{s.found === "new" ? "Only in the newer filing" : "Not found in the newer filing"}</span>
                    )}
                    <span className="num text-right text-muted-foreground">{ok ? n.toLocaleString() : ""}</span>
                    <span className={cn("num text-right", s.high ? "text-negative" : "text-muted-foreground")}>{ok ? (s.high ? s.high : "–") : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Ranked by the materiality score of each section's changes. Pick a section to read its changes below.</p>
        </div>
      </div>
    </section>
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
    <div data-section="What changed" className="min-w-0"><Panel collapse={false} bodyClassName="p-0" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" /> What changed</span>}
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
    </Panel></div>
  );
}
