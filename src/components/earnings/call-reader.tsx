// The Earnings calls tab below the call picker: summary and key numbers, themes against the previous
// call, the analyst questions, then the transcript with section, speaker and search controls that never
// move the page. Analytics are pure in src/lib/transcripts/; this file only lays them out.
import { MachineWritten } from "./figures";
import { Link } from "@tanstack/react-router";
import { Fragment, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { sentenceCase, termCasing } from "./term-case";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { coverageOf } from "@/lib/coverage";
import { fmtDate } from "@/lib/format";
import type { EarningsTranscript } from "@/lib/transcripts.functions";
import { transcriptStatistics } from "@/lib/transcripts/statistics";
import { gist } from "@/lib/transcripts/analyze";
import { callTone, exchanges, firmTicker, topicShift, type ToneScore, type TopicTrend } from "@/lib/transcripts/insights";
import type { TranscriptTurn } from "@/lib/transcripts/parse";
import { cn } from "@/lib/utils";
import { PageNav, Quiet, Section, SECTION_SCROLL_MARGIN, jumpTo } from "./layout";

type SectionKey = "all" | "prepared" | "qa";
type Patch = { call?: string; section?: SectionKey; speaker?: string | undefined };

const KIND_LABEL = { management: "Management", analyst: "Analyst", operator: "Operator", unidentified: "Role not identified" } as const;
const SECTIONS = [
  { id: "call-summary", label: "Summary" },
  { id: "call-themes", label: "Themes" },
  { id: "call-questions", label: "Questions" },
  { id: "call-transcript", label: "Transcript" },
];

const covered = (t: string) => !!coverageOf(t);

function FirmMark({ firm }: { firm: string | null }) {
  if (!firm) return <span className="text-muted-foreground">–</span>;
  const tk = firmTicker(firm, covered);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {tk && <CompanyLogo ticker={tk} size="xs" decorative />}
      <span className="truncate">{firm}</span>
    </span>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const net = (s: ToneScore) => (s.net == null ? "–" : `${s.net > 0 ? "+" : s.net < 0 ? "−" : ""}${Math.abs(s.net).toFixed(2)}`);

const TREND: Record<TopicTrend, { label: string; cls: string }> = {
  new: { label: "New", cls: "text-foreground font-medium" },
  rising: { label: "Rising", cls: "text-positive" },
  steady: { label: "Steady", cls: "text-muted-foreground" },
  fading: { label: "Fading", cls: "text-negative" },
  dropped: { label: "Dropped", cls: "text-negative" },
};

export function CallReader({
  t,
  prev,
  prevLoading,
  ticker,
  section,
  speaker,
  set,
}: {
  t: EarningsTranscript;
  prev: EarningsTranscript | null;
  prevLoading: boolean;
  ticker: string;
  section: SectionKey;
  speaker?: string;
  set: (p: Patch) => void;
}) {
  const co = coverageOf(ticker);
  const exclude = useMemo(() => [ticker, co?.shortName ?? ""], [ticker, co]);
  const {share,figures,tone,summary,takeaways} = useMemo(() => t.statistics?.version === 1 ? t.statistics : transcriptStatistics(t),[t]);
  const topics = useMemo(() => topicShift(t, prev, 12, exclude), [t, prev, exclude]);
  // topic terms are counted in lower case: show them as the call writes them ("iPhone Duo"), else in sentence case
  const cased = useMemo(() => termCasing([...new Set([...topics.map((r) => r.term)])], t.turns.map((x) => x.text)), [t, topics]);
  const term = (x: string) => cased.get(x) ?? sentenceCase(x);
  const prevTone = useMemo(() => (prev ? (prev.statistics?.version === 1 ? prev.statistics.tone : callTone(prev)) : null), [prev]);
  const asked = useMemo(
    () =>
      exchanges(
        t,
        topics.filter((r) => r.trend !== "dropped").map((r) => r.term),
        gist,
      ),
    [t, topics],
  );
  // The page's takeaways carry labels ("iPhone revenue") the bare sentences lack; when enough of them check
  // out against the call they are the key numbers, otherwise the figures management stated stand in.
  const showTakeaways = !!takeaways && takeaways.kept.length >= 4;
  const roleOf = useMemo(() => new Map(t.speakers.map((sp) => [sp.name, sp])), [t]);

  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [hit, setHit] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /* The transcript toolbar sticks right under the call's section nav: its height is measured (41 px at one line,
     more when it wraps) into --call-nav, so no strip of text shows between the two. */
  useLayoutEffect(() => {
    const host = root.current;
    const nav = host?.querySelector<HTMLElement>('nav[data-section="Page sections"]');
    if (!host) return;
    if (!nav) return void host.style.setProperty("--call-nav", "0px");
    if (typeof ResizeObserver === "undefined") return;
    const set = () => host.style.setProperty("--call-nav", `${nav.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const visible = t.turns.filter((x) => (section === "all" || x.section === section) && (!speaker || x.speaker === speaker));
  const re = useMemo(() => (q.length >= 2 ? new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi") : null), [q]);
  const hits = re ? visible.reduce((n, x) => n + (x.text.match(re)?.length ?? 0), 0) : 0;

  /**
   * Filters change how much transcript there is. When the toolbar is stuck at the top, keep the reader's
   * place: the first turn showing under the toolbar stays at the same height if the new filter still shows
   * it (widening to "Full call" from turn 24 stays at turn 24, earnings-L4); otherwise the start of the
   * filtered list comes up under the toolbar. When the toolbar is not stuck the page stays where it is.
   */
  const placeTurn = useRef<{ id: string; top: number } | null>(null);
  const filter = (p: Patch) => {
    const top = toolbar.current?.getBoundingClientRect().top ?? null;
    const stuck = top != null && top <= parseFloat(getComputedStyle(toolbar.current!).top || "0") + 1;
    anchor.current = stuck ? top : null;
    placeTurn.current = null;
    if (stuck && toolbar.current) {
      const below = toolbar.current.getBoundingClientRect().bottom;
      const first = [...(body.current?.querySelectorAll<HTMLElement>("[id^='turn-']") ?? [])].find((el) => el.getBoundingClientRect().bottom > below + 4);
      if (first) placeTurn.current = { id: first.id, top: first.getBoundingClientRect().top };
    }
    setHit(0);
    set(p);
  };
  useLayoutEffect(() => {
    if (anchor.current == null) return;
    const kept = placeTurn.current ? document.getElementById(placeTurn.current.id) : null;
    if (kept && placeTurn.current) {
      window.scrollTo({ top: window.scrollY + kept.getBoundingClientRect().top - placeTurn.current.top, behavior: "auto" });
    } else {
      const sec = document.getElementById("call-transcript");
      if (sec && toolbar.current) {
        const stickTop = parseFloat(getComputedStyle(toolbar.current).top || "0");
        const y = sec.getBoundingClientRect().top + window.scrollY - stickTop + 1;
        if (window.scrollY > y) window.scrollTo({ top: y, behavior: "auto" });
      }
    }
    anchor.current = null;
    placeTurn.current = null;
  }, [section, speaker]);

  /** Move to match k (explicit: Enter, next or previous). Typing never scrolls. */
  const goHit = (k: number) => {
    if (!hits) return;
    const n = ((k % hits) + hits) % hits;
    setHit(n);
    const marks = body.current?.querySelectorAll<HTMLElement>("mark[data-hit]");
    marks?.forEach((m) => m.removeAttribute("data-active"));
    const el = marks?.[n];
    if (el) {
      el.setAttribute("data-active", "true");
      const stick = (toolbar.current?.getBoundingClientRect().bottom ?? 120) + 16;
      const y = el.getBoundingClientRect().top + window.scrollY - stick - 40;
      // Smooth only for short hops: a long smooth scroll through the transcript is slow and disorienting.
      const far = Math.abs(y - window.scrollY) > window.innerHeight * 2;
      window.scrollTo({ top: y, behavior: far || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };

  /** Explicit jump to a turn from the summary, themes or questions. Clears filters that would hide it. */
  const jumpTurn = (i: number) => {
    if (section !== "all" || speaker) set({ section: "all", speaker: undefined });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = jumpTo(`turn-${i}`);
        el?.animate([{ backgroundColor: "var(--highlight-soft)" }, { backgroundColor: "transparent" }], { duration: 1600 });
      }),
    );
  };
  const findTerm = (term: string) => {
    setQuery(term);
    if (section !== "all" || speaker) set({ section: "all", speaker: undefined });
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo("call-transcript")));
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
  const people = t.speakers.filter((sp) => sp.kind !== "operator");
  const prevLabel = prev ? `${prev.quarter ?? "previous"} call (${fmtDate(prev.date)})` : null;

  return (
    <div ref={root} className="grid grid-cols-1 gap-5">
      <PageNav sections={SECTIONS} label="Call sections" />

      {/* ───────── Summary */}
      <Section
        id="call-summary"
        name="Call summary"
        title={t.title}
        caption={<>
          {t.date && (t.eventSourceUrl?.startsWith("https://")
            ? <a href={t.eventSourceUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2" title="Issuer source for the call date">Call {fmtDate(t.date)}</a>
            : <>{t.archiveKind || t.dateBasis === "event" ? "Call " : "Published "}{fmtDate(t.date)}</>)}
          {t.publishedDate && t.dateBasis === "event" && t.publishedDate !== t.date && <> · Published {fmtDate(t.publishedDate)}</>}
          {" · "}{t.words.toLocaleString("en-US")} words · about {minutes} min · {asked.length} analyst questions
        </>}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/research" search={{ q: askQ }}>
              <Bot /> Ask the research agent
            </Link>
          </Button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 lg:border-r">
            {t.archiveSummary && (
              <div className="border-b px-4 py-3">
                <p className="text-[13px] leading-5">{t.archiveSummary.text}</p>
                <MachineWritten by={`FiledUnder call analysis${t.archiveSummary.asOf ? " · "+fmtDate(t.archiveSummary.asOf) : ""}`} href={t.url} sourceLabel="Company source" />
              </div>
            )}
            {summary && (
              <div className="border-b px-4 py-3">
                <p className="text-[13px] leading-5">{summary.text}</p>
                <p className="mt-1">
                  <MachineWritten
                    by={`Summary The Motley Fool publishes with the transcript and says is written partly by language models; not the company's words. ${
                      summary.removed
                        ? `${summary.removed} ${summary.removed === 1 ? "sentence" : "sentences"} with a number not found in management's words removed.`
                        : "Every number in it was found in management's words."
                    }`}
                    href={t.url}
                    sourceLabel="Transcript page"
                  />
                </p>
              </div>
            )}
            {!showTakeaways && (
              <div className="px-4 pt-3 pb-1">
                <h3 className="eyebrow">Figures management stated</h3>
              </div>
            )}
            {showTakeaways ? null : figures.length ? (
              <ol className="divide-y divide-border/60">
                {figures.map((f, k) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => jumpTurn(f.i)}
                      className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-4 py-1.5 text-left transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="pt-px text-[11px] text-muted-foreground">{f.topic}</span>
                      <span className="text-[13px] leading-5">
                        {f.sentence} <span className="text-[11px] whitespace-nowrap text-muted-foreground">{f.speaker}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <Quiet>Management stated no figures about results or outlook on this call.</Quiet>
            )}
            {showTakeaways && takeaways && (
              <div>
                <div className="px-4 pt-3 pb-1">
                  <h3 className="eyebrow">Publisher's takeaways</h3>
                  <p className="mt-1">
                    <MachineWritten by="Written partly by language models at The Motley Fool." href={t.url} sourceLabel="Transcript page" />
                  </p>
                </div>
                <ul className="grid grid-cols-1 gap-x-6 px-4 pb-3 md:grid-cols-2">
                  {takeaways.kept.map((k, n) => (
                    <li key={n} className="border-b border-border/60 py-1.5 text-[13px] leading-5">
                      {k.label && <span className="font-medium">{k.label}: </span>}
                      {k.text}
                      {k.i != null && (
                        <button type="button" onClick={() => jumpTurn(k.i!)} className="relative ml-1 text-[11px] before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                          said here
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="px-4 pb-3 text-[11px] text-muted-foreground">
                  Shown when every number in them (amounts, rates and counts; 76.0% and 76% count as one) appears in a sentence management said that also names the item. The wording is not checked.
                  {takeaways.notFound ? ` ${takeaways.notFound} left out because a number in ${takeaways.notFound === 1 ? "it" : "them"} was not found that way.` : ""}
                  {takeaways.noFigure ? ` ${takeaways.noFigure} left out because ${takeaways.noFigure === 1 ? "it states" : "they state"} no number to check.` : ""}
                </p>
              </div>
            )}
          </div>
          <div className="min-w-0 border-t lg:border-t-0">
            <div className="px-4 py-3">
              <p className="eyebrow mb-1.5">Talk time</p>
              <div className="flex h-2 overflow-hidden rounded-sm bg-secondary" role="img" aria-label={`Management ${pct(share.management)}, analysts ${pct(share.analyst)} of words spoken`}>
                <span className="bg-chart-1" style={{ width: `${share.management * 100}%` }} />
                <span className="ml-0.5 bg-chart-3" style={{ width: `${share.analyst * 100}%` }} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-chart-1" /> Management
                </dt>
                <dd className="num text-right">{pct(share.management)}</dd>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-chart-3" /> Analysts
                </dt>
                <dd className="num text-right">{pct(share.analyst)}</dd>
                {share.unidentified > 0 && (
                  <>
                    <dt className="text-muted-foreground">Role not identified</dt>
                    <dd className="num text-right">{pct(share.unidentified)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Prepared remarks</dt>
                <dd className="num text-right">{share.prepared > 0 ? pct(share.prepared) : "–"}</dd>
              </dl>
            </div>
            <div className="border-t px-4 py-3">
              <p className="eyebrow mb-1.5">Management tone</p>
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-normal" />
                    <th className="pb-1 text-right font-normal">Net tone</th>
                    <th className="pb-1 text-right font-normal">Scored</th>
                    <th className="pb-1 text-right font-normal">Hedging</th>
                    {prevTone && <th className="pb-1 text-right font-normal">Prior call</th>}
                  </tr>
                </thead>
                <tbody>
                  {(["prepared", "qa"] as const).map((k) => (
                    <tr key={k} className="h-6 border-t border-border/60">
                      <th scope="row" className="text-left font-normal">
                        {k === "prepared" ? "Prepared" : "Answers"}
                      </th>
                      <td className={cn("num text-right", tone[k].positive + tone[k].negative < 30 && "text-muted-foreground")}>{net(tone[k])}</td>
                      <td className="num text-right text-muted-foreground">{(tone[k].positive + tone[k].negative).toLocaleString("en-US")}</td>
                      <td className="num text-right">{tone[k].hedgeRate.toFixed(1)}</td>
                      {prevTone && <td className="num text-right text-muted-foreground">{net(prevTone[k])}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                Net tone: positive minus negative words over both, from a fixed finance word list (after Loughran and McDonald), −1 to +1; a positive word just after "not" or "no" counts as negative. Scored: the words counted, greyed under 30 and a dash under 10. Hedging: words like may, could, approximately per 1,000 words.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────── Themes */}
      <Section
        id="call-themes"
        name="Call themes"
        title="Themes"
        caption={
          prevLabel
            ? `Most discussed words and phrases, per 10,000 words spoken, against the ${prevLabel}. Rising or fading: the rate moved by half or more.`
            : prevLoading
              ? "Most discussed words and phrases. Loading the previous call to compare."
              : "Most discussed words and phrases, per 10,000 words spoken. No previous call to compare."
        }
      >
        {topics.length ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="py-1.5 pl-4 pr-2 text-left font-normal">
                    Topic
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">
                    Mentions
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">
                    Per 10k words
                  </th>
                  {prev && (
                    <>
                      <th scope="col" className="px-2 py-1.5 text-right font-normal">
                        Previous call
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-left font-normal">
                        Trend
                      </th>
                    </>
                  )}
                  <th scope="col" className="py-1.5 pl-2 pr-4 text-right font-normal">
                    <span className="sr-only">Find</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {topics.map((r) => (
                  <tr key={r.term} className="h-7 border-b border-border/60 last:border-0">
                    <th scope="row" className="py-1 pl-4 pr-2 text-left font-normal">
                      {term(r.term)}
                    </th>
                    <td className="num px-2 py-1 text-right">{r.count}</td>
                    <td className="num px-2 py-1 text-right">{r.rate.toFixed(1)}</td>
                    {prev && (
                      <>
                        <td className="num px-2 py-1 text-right text-muted-foreground">{r.prevRate == null ? "–" : r.prevRate.toFixed(1)}</td>
                        <td className={cn("px-2 py-1 text-left text-[11px]", r.trend && TREND[r.trend].cls)}>{r.trend ? TREND[r.trend].label : "–"}</td>
                      </>
                    )}
                    <td className="py-1 pl-2 pr-4 text-right">
                      {r.count > 0 && (
                        <button type="button" onClick={() => findTerm(r.term)} className="relative rounded-sm px-1.5 py-0.5 text-[11px] before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground">
                          Find in transcript
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Quiet>Too little text on this call to rank topics.</Quiet>
        )}
      </Section>

      {/* ───────── Questions */}
      <Section id="call-questions" name="Analyst questions" title={`Analyst questions · ${asked.length}`} caption="Each exchange with the call's topics it touched, how long the answer ran and who gave it. Click a row to read it.">
        {asked.length ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="w-8 py-1.5 pl-4 pr-1 text-right font-normal">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-normal">
                    Analyst
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-normal">
                    Question
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-normal">
                    Topics
                  </th>
                  <th scope="col" className="py-1.5 pl-2 pr-4 text-right font-normal whitespace-nowrap">
                    Answer, words
                  </th>
                </tr>
              </thead>
              <tbody>
                {asked.map((e, n) => (
                  <tr key={e.i} onClick={() => jumpTurn(e.i)} className="cursor-pointer border-b border-border/60 align-top transition-colors duration-150 last:border-0 hover:bg-secondary/60">
                    <td className="num py-1.5 pl-4 pr-1 text-right text-muted-foreground">{n + 1}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={(ev) => (ev.stopPropagation(), jumpTurn(e.i))} className="block text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {e.analyst}
                      </button>
                      <span className="block max-w-[14rem] text-[11px] text-muted-foreground">
                        <FirmMark firm={e.firm} />
                      </span>
                    </td>
                    <td className="max-w-[28rem] px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">{e.gist}</td>
                    <td className="px-2 py-1.5 text-[11px]">
                      {e.topics.length ? (
                        <span className="flex flex-wrap gap-1">
                          {e.topics.map((tp) => (
                            <span key={tp} className="rounded-sm border px-1 py-px">
                              {term(tp)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      <span className="num">{e.answerWords.toLocaleString("en-US")}</span>
                      <span className="block text-[11px] text-muted-foreground">{e.answeredBy.slice(0, 2).join(", ")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Quiet>No analyst questions on this call.</Quiet>
        )}
      </Section>

      {/* ───────── Transcript */}
      <section id="call-transcript" data-section="Transcript" className={cn("min-w-0 border-y bg-card", SECTION_SCROLL_MARGIN)}>
        <div ref={toolbar} data-section="Transcript controls" className="z-10 max-sm:static sm:sticky sm:top-[calc(var(--sticky-top,3.5rem)+var(--call-nav,41px))] flex flex-wrap items-center gap-2 border-b bg-card/95 px-4 py-2 backdrop-blur">
          <Segmented
            label="Section"
            value={section}
            onChange={(v) => filter({ section: v })}
            options={[
              { v: "all", l: "Full call" },
              { v: "prepared", l: "Prepared remarks" },
              { v: "qa", l: "Q&A" },
            ]}
          />
          <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Speaker</span>
            <select
              value={speaker ?? ""}
              onChange={(e) => filter({ speaker: e.target.value || undefined })}
              className="h-8 max-w-[13rem] min-w-0 rounded-md border bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Show one speaker"
            >
              <option value="">Everyone</option>
              {(["management", "analyst", "unidentified"] as const).filter((k) => people.some((sp) => sp.kind === k)).map((k) => (
                <optgroup key={k} label={KIND_LABEL[k]}>
                  {people
                    .filter((sp) => sp.kind === k)
                    .map((sp) => (
                      <option key={sp.name} value={sp.name}>
                        {sp.name}
                        {sp.kind === "analyst" ? (sp.firm ? `, ${sp.firm}` : "") : sp.role ? `, ${sp.role}` : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {speaker && (
            <button type="button" onClick={() => filter({ speaker: undefined })} className="flex h-7 items-center gap-1 rounded-md border bg-highlight-soft px-2 text-[11px]" aria-label={`Show everyone, not only ${speaker}`}>
              {speaker} <X className="size-3" />
            </button>
          )}
          <div className="relative ml-auto flex min-w-0 flex-1 items-center gap-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHit(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits) {
                  e.preventDefault();
                  const active = !!body.current?.querySelector("mark[data-active]");
                  goHit(!active ? 0 : e.shiftKey ? hit - 1 : hit + 1);
                }
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search the call"
              aria-label="Search the call"
              className="h-8 pl-7 pr-20 text-[13px]"
            />
            {re && (
              <span className="absolute right-1 flex items-center gap-0.5">
                <span className="num px-1 text-[11px] text-muted-foreground" aria-live="polite">
                  {hits ? `${Math.min(hit + 1, hits)}/${hits}` : "0"}
                </span>
                <button type="button" aria-label="Previous match" disabled={!hits} onClick={() => goHit(hit - 1)} className="rounded p-1 hover:bg-secondary disabled:opacity-40">
                  <ChevronUp className="size-3.5" />
                </button>
                <button type="button" aria-label="Next match" disabled={!hits} onClick={() => goHit(body.current?.querySelector("mark[data-active]") ? hit + 1 : 0)} className="rounded p-1 hover:bg-secondary disabled:opacity-40">
                  <ChevronDown className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div ref={body} className="divide-y">
          {visible.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">Nothing in this section.</p>}
          {visible.map((x, idx) => {
            const prevTurn = visible[idx - 1];
            const showQa = section === "all" && !speaker && x.section === "qa" && prevTurn?.section === "prepared";
            return (
              <Fragment key={x.i}>
                {(idx === 0 || showQa) && !speaker && <p className="eyebrow bg-secondary/50 px-4 py-1.5">{x.section === "qa" ? "Questions and answers" : "Prepared remarks"}</p>}
                <Turn x={x} role={roleOf.get(x.speaker)} mark={mark} />
              </Fragment>
            );
          })}
        </div>
        <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          {t.source} · archived {fmtDate(t.fetchedAt)}. Compare figures with the{" "}
          <Link to="/app/companies/$ticker/financials" params={{ ticker }} className="underline">
            reported financials
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Turn({ x, role, mark }: { x: TranscriptTurn; role?: EarningsTranscript["speakers"][number]; mark: (s: string) => ReactNode }) {
  const sub = x.kind === "analyst" ? (role?.firm ?? "Analyst") : x.kind === "operator" ? null : x.kind === "unidentified" ? "Role not identified" : role?.role;
  return (
    <article id={`turn-${x.i}`} className={cn("scroll-mt-[calc(var(--sticky-top,3.5rem)+6.5rem)] px-4 py-3", x.kind === "analyst" && "bg-secondary/40", x.kind === "operator" && "py-2")}>
      <header className="mb-1 flex min-w-0 items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", x.kind === "management" ? "bg-chart-1" : x.kind === "analyst" ? "bg-chart-3" : "bg-muted-foreground/50")} />
        <h3 className={cn("text-[13px] font-semibold", x.kind === "operator" && "font-medium text-muted-foreground")}>{x.speaker}</h3>
        {sub && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{x.kind === "analyst" && role?.firm ? <FirmMark firm={role.firm} /> : sub}</span>
        )}
        <span className="sr-only">{KIND_LABEL[x.kind]}</span>
      </header>
      <div className={cn("grid max-w-[72ch] gap-2 pl-3.5 text-[14px] leading-relaxed", x.kind === "operator" && "text-[13px] text-muted-foreground")}>
        {x.text.split("\n\n").map((p, k) => (
          <p key={k}>{mark(p)}</p>
        ))}
      </div>
    </article>
  );
}
