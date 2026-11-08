import { EarningsWorkflowPanel } from "@/components/earnings/earnings-views";
import { createFileRoute } from "@tanstack/react-router";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CalendarClock, ExternalLink, Handshake, RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { coverageOf } from "@/lib/coverage";
import { useCompany } from "@/lib/data";
import { marketsQuery } from "@/lib/markets/query";
import { estimateNextEarnings } from "@/lib/company/catalysts";
import { credibility, type PromiseStatus, type TrackedPromise } from "@/lib/earnings/promises";
import { getEarningsNotes, getPromises } from "@/lib/earnings.functions";
import { quoteLink } from "@/lib/supply/counterparty";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/earnings")({
  head: ({ params }) => {
    const t = params.ticker.toUpperCase();
    const name = coverageOf(t)?.shortName ?? t;
    return {
      meta: [
        { title: `${name} (${t}) earnings preview, recap & promise tracker — Filed Under` },
        {
          name: "description",
          content: `What changed in ${name}'s latest quarter, what to watch next, and whether management kept its promises — every line sourced.`,
        },
        {
          property: "og:title",
          content: `${name} earnings preview & promise tracker — Filed Under`,
        },
        {
          property: "og:description",
          content: `Sourced earnings recap, preview and management credibility score for ${name}.`,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: Earnings,
});

interface Fact {
  id: string;
  area: string;
  text: string;
  target?: SourceTarget;
  url?: string;
}

const STATUS: Record<PromiseStatus, { label: string; cls: string }> = {
  kept: { label: "Kept", cls: "border-primary/40 bg-primary/10 text-primary" },
  partial: { label: "Partly kept", cls: "border-border bg-muted text-foreground" },
  missed: { label: "Missed", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  pending: { label: "Pending", cls: "border-dashed border-border text-muted-foreground" },
};
const today = () => new Date().toISOString().slice(0, 10);

function Earnings() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const company = useCompany(ticker);
  const promFn = useServerFn(getPromises);
  const promises = useQuery({
    queryKey: ["promises", ticker],
    queryFn: () => promFn({ data: { ticker } }),
    staleTime: 6 * 3600_000,
    retry: 1,
  });
  const m = useQuery(marketsQuery);
  const mc = m.data?.companies.find((c) => c.ticker === ticker);

  const facts = useMemo(
    () =>
      company.data
        ? buildFacts(ticker, company.data, mc?.reactions ?? [], promises.data?.promises ?? [])
        : [],
    [company.data, mc, promises.data, ticker],
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <EarningsWorkflowPanel ticker={ticker} />
      <Notes
        ticker={ticker}
        facts={facts}
        ready={!!company.data && !!m.data && !promises.isLoading}
        next={
          company.data
            ? estimateNextEarnings(
                company.data.earningsReleases.map((r) => r.filed),
                today(),
              )
            : null
        }
      />
      <PromisePanel
        loading={promises.isLoading}
        data={promises.data}
        error={promises.error as Error | null}
      />
    </div>
  );
}

function buildFacts(
  ticker: string,
  d: CompanyDataset,
  reactions: { date: string; move: number; excess: number | null; drift20?: number | null }[],
  promises: TrackedPromise[],
): Fact[] {
  const out: Fact[] = [];
  const inc = d.statements.quarterly.income;
  const n = inc.periods.length;
  const idx = [n - 1, n - 2, n - 5].filter((i) => i >= 0);
  const fmt = (v: number, unit: string) =>
    unit === "usd"
      ? fmtCompactUsd(v)
      : unit === "usdPerShare"
        ? `$${v.toFixed(2)}`
        : unit === "pct"
          ? fmtPct(v)
          : String(v);
  for (const row of inc.rows
    .filter((r) => r.unit === "usd" || r.unit === "usdPerShare")
    .slice(0, 14)) {
    const parts = idx
      .map((i) =>
        row.cells[i] ? `${inc.periods[i].label} ${fmt(row.cells[i]!.v, row.unit)}` : null,
      )
      .filter(Boolean);
    const c = row.cells[n - 1];
    if (!c || parts.length < 2) continue;
    out.push({
      id: `F${out.length + 1}`,
      area: "reported",
      text: `${row.label}: ${parts.join(" | ")} (latest vs prior quarter vs year-ago)`,
      target: {
        ticker,
        label: row.label,
        periodLabel: inc.periods[n - 1].label,
        unit: row.unit,
        value: c.v,
        src: c.src,
        derived: c.derived,
      },
    });
  }
  for (const r of d.earningsReleases.slice(0, 4))
    out.push({
      id: `R${out.length + 1}`,
      area: "release",
      text: `${r.filed} earnings release: ${r.title}`,
      target: {
        ticker,
        label: r.title,
        unit: "",
        value: 0,
        doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.filed, title: r.title },
      },
    });
  for (const r of reactions.slice(0, 8))
    out.push({
      id: `P${out.length + 1}`,
      area: "price reaction",
      text: `Earnings ${r.date}: 2-day move ${fmtPct(r.move, 1, true)}${r.excess != null ? `, vs SPY ${fmtPct(r.excess, 1, true)}` : ""}`,
    });
  for (const p of promises.slice(0, 20))
    out.push({
      id: `M${out.length + 1}`,
      area: "promise",
      text: `${p.callDate} promise (${p.category}): "${p.quote.slice(0, 260)}" → ${p.status}${p.outcomeQuote ? ` per ${p.outcomeCallDate}: "${p.outcomeQuote.slice(0, 200)}"` : ""}`,
      url: quoteLink(p.callUrl, p.quote),
    });
  const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  for (const x of d.insiders
    .filter((x) => (x.code === "P" || x.code === "S") && x.date >= since)
    .slice(0, 8))
    out.push({
      id: `I${out.length + 1}`,
      area: "insider",
      text: `${x.date} ${x.owner} (${x.role}) ${x.code === "P" ? "bought" : "sold"} ${x.shares.toLocaleString()} sh${x.price ? ` @ $${x.price}` : ""}`,
      target: {
        ticker,
        label: `Form 4 — ${x.owner}`,
        unit: "",
        value: 0,
        doc: { accn: x.accn, doc: "", form: "4", filed: x.filed },
      },
    });
  return out;
}

function Notes({
  ticker,
  facts,
  ready,
  next,
}: {
  ticker: string;
  facts: Fact[];
  ready: boolean;
  next: { date: string } | null;
}) {
  const fn = useServerFn(getEarningsNotes);
  const [bump, setBump] = useState(0);
  const key = `${facts.find((f) => f.area === "release")?.text.slice(0, 10) ?? "x"}:${facts.length}:${bump}`;
  const q = useQuery({
    queryKey: ["earnings-notes", ticker, key],
    queryFn: () =>
      fn({
        data: {
          ticker,
          key,
          facts: facts.map(({ id, area, text }) => ({ id, area, text: text.slice(0, 700) })),
        },
      }),
    enabled: ready && facts.length > 3,
    staleTime: Infinity,
    retry: 1,
  });
  const { open } = useSource();
  const byId = new Map(facts.map((f) => [f.id, f]));
  const Cite = ({ ids }: { ids: string[] }) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids
        .filter((id) => byId.has(id))
        .map((id) => {
          const f = byId.get(id)!;
          return (
            <button
              key={id}
              title={f.text}
              onClick={() =>
                f.target
                  ? open(f.target)
                  : f.url
                    ? window.open(f.url, "_blank", "noopener,noreferrer")
                    : undefined
              }
              className={cn(
                "rounded border px-1 text-[10px] tabular-nums text-muted-foreground",
                (f.target || f.url) && "hover:border-foreground hover:text-foreground",
              )}
            >
              {id}
            </button>
          );
        })}
    </span>
  );
  const days = next ? Math.round((Date.parse(next.date) - Date.parse(today())) / 86_400_000) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> Latest quarter recap
          </span>
        }
        subtitle="What changed vs last quarter and a year ago. Click a tag to open its source."
      >
        {!q.data ? (
          q.error ? (
            <p className="text-sm text-muted-foreground">{friendlyError(q.error)}</p>
          ) : (
            <Skeleton className="h-48" />
          )
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-display text-lg leading-snug">{q.data.recap.headline}</p>
            <ul className="space-y-2">
              {q.data.recap.changed.map((b, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  {b.text}
                  <Cite ids={b.factIds} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" /> Next earnings preview
          </span>
        }
        subtitle={
          next
            ? `Estimated ${fmtDate(next.date)}${days != null ? ` · ${days >= 0 ? `in ${days} days` : `${-days} days ago`}` : ""} (from past release timing)`
            : "Next date not yet estimable"
        }
        actions={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Regenerate"
            onClick={() => setBump((b) => b + 1)}
          >
            <RefreshCw className={cn(q.isFetching && "animate-spin")} />
          </Button>
        }
      >
        {!q.data ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-display text-lg leading-snug">{q.data.preview.headline}</p>
            <h4 className="eyebrow">What to watch</h4>
            <ul className="space-y-2">
              {q.data.preview.watch.map((b, i) => (
                <li key={i} className="border-l-2 border-primary/50 pl-3">
                  {b.text}
                  <Cite ids={b.factIds} />
                </li>
              ))}
            </ul>
            <h4 className="eyebrow">Risks</h4>
            <ul className="space-y-2">
              {q.data.preview.risks.map((b, i) => (
                <li key={i} className="border-l-2 border-destructive/50 pl-3">
                  {b.text}
                  <Cite ids={b.factIds} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

function PromisePanel({
  loading,
  data,
  error,
}: {
  loading: boolean;
  data?: { promises: TrackedPromise[]; calls: { date: string }[]; error?: string };
  error: Error | null;
}) {
  const [f, setF] = useState<PromiseStatus | "all">("all");
  const ps = data?.promises ?? [];
  const cred = credibility(ps);
  const shown = ps.filter((p) => f === "all" || p.status === f);
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Handshake className="size-3.5" /> Management promise tracker
        </span>
      }
      subtitle={
        data?.calls.length
          ? `Commitments from ${data.calls.length} earnings calls (${fmtDate(data.calls[0].date)} – ${fmtDate(data.calls[data.calls.length - 1].date)}), graded against later calls. Each quote is checked word-for-word against the transcript.`
          : "Reads the last five earnings calls — first load takes about a minute."
      }
    >
      {loading ? (
        <Skeleton className="h-64" />
      ) : error || data?.error ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? data?.error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <div className="rounded-md border bg-secondary/40 p-4 text-center">
              <p className="text-[11px] text-muted-foreground">Credibility score</p>
              <p className="num font-display text-4xl">
                {cred.score != null ? Math.round(cred.score * 100) : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {cred.score != null ? `${cred.graded} graded promises` : "Needs 3+ graded promises"}
              </p>
              <div className="mt-3 flex h-2 overflow-hidden rounded bg-muted">
                {(["kept", "partial", "missed"] as const).map((s) => (
                  <div
                    key={s}
                    className={cn(
                      s === "kept"
                        ? "bg-primary"
                        : s === "partial"
                          ? "bg-foreground/30"
                          : "bg-destructive",
                    )}
                    style={{ width: `${cred.graded ? (cred[s] / cred.graded) * 100 : 0}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 md:flex-col">
              {(["all", "kept", "partial", "missed", "pending"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setF(s)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-1 text-xs",
                    f === s ? "border-foreground bg-muted" : "border-border text-muted-foreground",
                  )}
                >
                  <span>{s === "all" ? "All" : STATUS[s].label}</span>
                  <span className="tabular-nums">{s === "all" ? ps.length : cred[s]}</span>
                </button>
              ))}
            </div>
          </div>
          <ol className="min-w-0 space-y-2">
            {shown.map((p, i) => (
              <li key={i} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn("rounded border px-1.5 py-0.5 font-medium", STATUS[p.status].cls)}
                  >
                    {STATUS[p.status].label}
                  </span>
                  <span className="capitalize">{p.category}</span>
                  {p.deadline && <span>· due {p.deadline}</span>}
                </div>
                <p className="mt-1.5 text-sm font-medium">{p.summary}</p>
                <a
                  href={quoteLink(p.callUrl, p.quote)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block border-l-2 border-border pl-2 text-xs italic text-muted-foreground hover:text-foreground"
                >
                  “{p.quote}”{" "}
                  <span className="not-italic whitespace-nowrap text-primary">
                    {p.callQuarter ?? fmtDate(p.callDate)} call{" "}
                    <ExternalLink className="inline size-3" />
                  </span>
                </a>
                {p.outcomeQuote && p.outcomeUrl && (
                  <a
                    href={quoteLink(p.outcomeUrl, p.outcomeQuote)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 block border-l-2 border-primary/50 pl-2 text-xs italic text-muted-foreground hover:text-foreground"
                  >
                    “{p.outcomeQuote}”{" "}
                    <span className="not-italic whitespace-nowrap text-primary">
                      {fmtDate(p.outcomeCallDate!)} call <ExternalLink className="inline size-3" />
                    </span>
                  </a>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">{p.note}</p>
              </li>
            ))}
            {!shown.length && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No promises in this group.
              </p>
            )}
          </ol>
        </div>
      )}
    </Panel>
  );
}
