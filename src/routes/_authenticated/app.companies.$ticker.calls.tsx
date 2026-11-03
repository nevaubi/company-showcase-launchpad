import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { Bot, ChevronDown, ChevronUp, ExternalLink, Mic, RefreshCw, Search, X } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import { getEarningsTranscript, listEarningsCalls, type EarningsTranscript } from "@/lib/transcripts.functions";
import { keyTerms, questionIndex, talkShare } from "@/lib/transcripts/analyze";
import type { TranscriptTurn } from "@/lib/transcripts/parse";
import { cn } from "@/lib/utils";

const search = z.object({
  call: z.string().url().max(300).optional(),
  section: z.enum(["all", "prepared", "qa"]).default("all"),
  speaker: z.string().max(80).optional(),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/calls")({
  validateSearch: search,
  head: ({ params }) => {
    const t = params.ticker.toUpperCase();
    const name = coverageOf(t)?.shortName ?? t;
    return {
      meta: [
        { title: `${name} (${t}) earnings call transcripts — Filed Under` },
        { name: "description", content: `Read ${name}'s recent earnings calls by speaker: prepared remarks, every analyst question, talk time and key terms.` },
        { property: "og:title", content: `${name} earnings call transcripts — Filed Under` },
        { property: "og:description", content: `Searchable ${name} earnings call transcripts with speaker turns and an analyst question index.` },
      ],
    };
  },
  component: Calls,
});

const KIND_LABEL = { management: "Management", analyst: "Analyst", operator: "Operator" } as const;

function Calls() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (patch: Partial<z.infer<typeof search>>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const co = coverageOf(ticker);

  const listFn = useServerFn(listEarningsCalls);
  const getFn = useServerFn(getEarningsTranscript);
  const calls = useQuery({ queryKey: ["earnings-calls", ticker], queryFn: () => listFn({ data: { ticker } }), staleTime: 6 * 3600_000 });
  const list = calls.data?.calls ?? [];
  const url = s.call ?? list[0]?.url;
  const tr = useQuery({
    queryKey: ["transcript", url],
    queryFn: () => getFn({ data: { ticker, url: url! } }),
    enabled: !!url,
    staleTime: Infinity,
    retry: 1,
  });
  const t = tr.data?.transcript ?? null;

  if (calls.isLoading)
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-[480px]" />
      </div>
    );

  if (!list.length)
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Mic className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No earnings call transcripts found for {co?.shortName ?? ticker}</p>
          <p className="max-w-md text-xs text-muted-foreground">{calls.data?.error ?? calls.error?.message ?? "Try again in a moment."}</p>
          <Button size="sm" variant="outline" onClick={() => calls.refetch()}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </Panel>
    );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible sm:pb-0" role="tablist" aria-label="Earnings calls">
          {list.map((c) => (
            <button
              key={c.url}
              role="tab"
              aria-selected={c.url === url}
              onClick={() => set({ call: c.url, speaker: undefined })}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-left transition-colors",
                c.url === url ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <span className="num block text-[12px] font-semibold leading-tight">{c.quarter ?? "Call"}</span>
              <span className="block text-[10px] leading-tight opacity-75">{c.date ? fmtDate(c.date, { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
            </button>
          ))}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground hover:underline">
            Transcript via The Motley Fool <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {tr.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Skeleton className="h-[520px]" />
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">Reading the transcript…</p>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      ) : !t ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium">Couldn't load this transcript</p>
            <p className="max-w-md text-xs text-muted-foreground">{tr.data?.error ?? tr.error?.message}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => tr.refetch()}>
                <RefreshCw /> Try again
              </Button>
              {url && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    Open the page <ExternalLink />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </Panel>
      ) : (
        <Reader key={t.url} t={t} ticker={ticker} section={s.section} speaker={s.speaker} set={set} />
      )}
    </div>
  );
}

function Reader({
  t,
  ticker,
  section,
  speaker,
  set,
}: {
  t: EarningsTranscript;
  ticker: string;
  section: "all" | "prepared" | "qa";
  speaker?: string;
  set: (p: Partial<z.infer<typeof search>>) => void;
}) {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [hit, setHit] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  const share = useMemo(() => talkShare(t), [t]);
  const questions = useMemo(() => questionIndex(t), [t]);
  const terms = useMemo(() => {
    const co = coverageOf(ticker);
    return keyTerms(t, 14, [ticker, co?.shortName ?? ""]);
  }, [t, ticker]);
  const roleOf = useMemo(() => new Map(t.speakers.map((sp) => [sp.name, sp])), [t]);

  const visible = t.turns.filter((x) => (section === "all" || x.section === section) && (!speaker || x.speaker === speaker));
  const re = useMemo(() => (q.length >= 2 ? new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi") : null), [q]);
  const hits = re ? visible.reduce((n, x) => n + (x.text.match(re)?.length ?? 0), 0) : 0;

  useEffect(() => setHit(0), [q, section, speaker]);
  useEffect(() => {
    if (!hits) return;
    const marks = body.current?.querySelectorAll<HTMLElement>("mark[data-hit]");
    const el = marks?.[Math.min(hit, marks.length - 1)];
    marks?.forEach((m) => m.removeAttribute("data-active"));
    if (el) {
      el.setAttribute("data-active", "true");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [hit, hits, q]);

  const jump = (i: number) => {
    if (section !== "all" || speaker) set({ section: "all", speaker: undefined });
    requestAnimationFrame(() => {
      const el = document.getElementById(`turn-${i}`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.animate([{ backgroundColor: "var(--highlight-soft)" }, { backgroundColor: "transparent" }], { duration: 1600 });
    });
  };

  let counter = 0;
  const mark = (text: string): ReactNode => {
    if (!re) return text;
    return text.split(re).map((part, k) =>
      k % 2 ? (
        <mark key={k} data-hit={counter++} className="rounded-sm bg-highlight px-0.5 text-highlight-foreground data-[active=true]:ring-2 data-[active=true]:ring-foreground/60">
          {part}
        </mark>
      ) : (
        <Fragment key={k}>{part}</Fragment>
      ),
    );
  };

  const minutes = Math.round(t.words / 150);
  const askQ = `Using the ${t.title} transcript (${t.url}), what changed versus the prior quarter, what did management guide to, and which analyst questions got evasive answers?`;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="grid min-w-0 content-start gap-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1 scrollbar-thin">
        <Panel title={t.title} subtitle={`${t.date ? fmtDate(t.date) : ""} · ${t.words.toLocaleString()} words · ~${minutes} min`}>
          <p className="eyebrow mb-1.5">Talk time</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-secondary" aria-label="Share of words spoken">
            <span className="bg-chart-1" style={{ width: `${share.management * 100}%` }} />
            <span className="bg-chart-3" style={{ width: `${share.analyst * 100}%` }} />
            <span className="bg-muted-foreground/40" style={{ width: `${share.operator * 100}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-chart-1" /> Management {Math.round(share.management * 100)}%</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-chart-3" /> Analysts {Math.round(share.analyst * 100)}%</span>
            <span className="num">{share.prepared > 0 ? `${Math.round(share.prepared * 100)}% prepared remarks` : ""}</span>
          </div>
          <Button size="sm" variant="outline" className="mt-3 w-full" asChild>
            <Link to="/app/research" search={{ q: askQ }}>
              <Bot /> Ask the research agent
            </Link>
          </Button>
        </Panel>

        <Panel title="Speakers" subtitle="Click to show only their remarks" bodyClassName="p-0">
          <ul className="divide-y">
            {t.speakers
              .filter((sp) => sp.kind !== "operator")
              .map((sp) => (
                <li key={sp.name}>
                  <button
                    onClick={() => set({ speaker: speaker === sp.name ? undefined : sp.name })}
                    className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors hover:bg-secondary", speaker === sp.name && "bg-highlight-soft")}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", sp.kind === "management" ? "bg-chart-1" : "bg-chart-3")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{sp.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{sp.kind === "analyst" ? (sp.firm ?? "Analyst") : (sp.role ?? "Management")}</span>
                    </span>
                    <span className="num text-[10px] text-muted-foreground">{sp.words.toLocaleString()}w</span>
                  </button>
                </li>
              ))}
          </ul>
        </Panel>

        {terms.length > 0 && (
          <Panel title="Most-discussed terms" subtitle="Click to search the call">
            <div className="flex flex-wrap gap-1">
              {terms.map((k) => (
                <button
                  key={k.term}
                  onClick={() => setQuery(k.term)}
                  className={cn("rounded border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-secondary", q.toLowerCase() === k.term && "border-foreground bg-secondary")}
                >
                  {k.term} <span className="num text-muted-foreground">{k.count}</span>
                </button>
              ))}
            </div>
          </Panel>
        )}

        {questions.length > 0 && (
          <Panel title={`Analyst questions (${questions.length})`} bodyClassName="p-0">
            <ol className="max-h-80 divide-y overflow-y-auto scrollbar-thin lg:max-h-none">
              {questions.map((x, n) => (
                <li key={x.i}>
                  <button onClick={() => jump(x.i)} className="block w-full px-4 py-2 text-left transition-colors hover:bg-secondary">
                    <span className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="num text-muted-foreground">{n + 1}.</span>
                      <span className="font-medium">{x.speaker}</span>
                      {x.firm && <span className="truncate text-muted-foreground">{x.firm}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">{x.gist}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </aside>

      <section className="min-w-0 rounded-lg border bg-card shadow-paper">
        <div className="sticky top-12 z-10 flex flex-wrap items-center gap-2 rounded-t-lg border-b bg-card/95 px-4 py-2 backdrop-blur">
          <Segmented
            label="Section"
            value={section}
            onChange={(v) => set({ section: v })}
            options={[
              { v: "all", l: "Full call" },
              { v: "prepared", l: "Prepared remarks" },
              { v: "qa", l: "Q&A" },
            ]}
          />
          {speaker && (
            <button onClick={() => set({ speaker: undefined })} className="flex items-center gap-1 rounded-md border bg-highlight-soft px-2 py-1 text-[11px]">
              {speaker} <X className="size-3" />
            </button>
          )}
          <div className="relative ml-auto flex min-w-0 flex-1 items-center gap-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits) setHit((h) => (e.shiftKey ? (h - 1 + hits) % hits : (h + 1) % hits));
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search the call"
              aria-label="Search the call"
              className="h-8 pl-7 pr-16 text-[13px]"
            />
            {re && (
              <span className="absolute right-1 flex items-center gap-0.5">
                <span className="num px-1 text-[10px] text-muted-foreground">{hits ? `${Math.min(hit + 1, hits)}/${hits}` : "0"}</span>
                <button aria-label="Previous match" disabled={!hits} onClick={() => setHit((h) => (h - 1 + hits) % hits)} className="rounded p-0.5 hover:bg-secondary disabled:opacity-40">
                  <ChevronUp className="size-3.5" />
                </button>
                <button aria-label="Next match" disabled={!hits} onClick={() => setHit((h) => (h + 1) % hits)} className="rounded p-0.5 hover:bg-secondary disabled:opacity-40">
                  <ChevronDown className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div ref={body} className="divide-y">
          {visible.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing in this section.</p>}
          {visible.map((x, idx) => {
            const prev = visible[idx - 1];
            const showQa = section === "all" && !speaker && x.section === "qa" && prev?.section === "prepared";
            return (
              <Fragment key={x.i}>
                {(idx === 0 || showQa) && !speaker && (
                  <p className="eyebrow bg-secondary/50 px-4 py-1.5">{x.section === "qa" ? "Questions & answers" : "Prepared remarks"}</p>
                )}
                <Turn x={x} role={roleOf.get(x.speaker)} mark={mark} />
              </Fragment>
            );
          })}
        </div>
        <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          Third-party transcript from The Motley Fool, retrieved {fmtDate(t.fetchedAt)}. Figures said on calls aren't SEC filings — check them against the{" "}
          <Link to="/app/companies/$ticker/financials" params={{ ticker }} className="underline">
            reported financials
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Turn({
  x,
  role,
  mark,
}: {
  x: TranscriptTurn;
  role?: EarningsTranscript["speakers"][number];
  mark: (s: string) => ReactNode;
}) {
  const sub = x.kind === "analyst" ? (role?.firm ? `${role.firm} · Analyst` : "Analyst") : x.kind === "operator" ? null : role?.role;
  return (
    <article id={`turn-${x.i}`} className={cn("scroll-mt-28 px-4 py-3", x.kind === "analyst" && "bg-secondary/40", x.kind === "operator" && "py-2")}>
      <header className="mb-1 flex items-baseline gap-2">
        <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", x.kind === "management" ? "bg-chart-1" : x.kind === "analyst" ? "bg-chart-3" : "bg-muted-foreground/50")} />
        <h3 className={cn("text-[13px] font-semibold", x.kind === "operator" && "font-medium text-muted-foreground")}>{x.speaker}</h3>
        {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
        <span className="sr-only">{KIND_LABEL[x.kind]}</span>
      </header>
      <div className={cn("grid gap-2 pl-3.5 text-[14px] leading-relaxed", x.kind === "operator" && "text-[13px] text-muted-foreground")}>
        {x.text.split("\n\n").map((p, k) => (
          <p key={k}>{mark(p)}</p>
        ))}
      </div>
    </article>
  );
}
