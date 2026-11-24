// Management promise tracker: what management committed to on its calls (verbatim, checked against
// the transcript by vetPromises), grouped by state, each with the later call's words that graded it.
import { ExternalLink } from "lucide-react";
import { credibility, groupPromises, type PromiseStatus, type TrackedPromise } from "@/lib/earnings/promises";
import { quoteLink } from "@/lib/supply/counterparty";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Quiet, Section } from "./layout";

const STATUS: Record<PromiseStatus, { label: string; group: string; dot: string }> = {
  pending: { label: "Pending", group: "Still open", dot: "border border-dashed border-muted-foreground bg-transparent" },
  missed: { label: "Missed", group: "Missed", dot: "bg-negative" },
  partial: { label: "Partly kept", group: "Partly kept", dot: "bg-muted-foreground" },
  kept: { label: "Kept", group: "Kept", dot: "bg-positive" },
};

export function PromiseTracker({
  loading,
  data,
  error,
  shownElsewhere,
}: {
  loading: boolean;
  data?: { promises: TrackedPromise[]; calls: { date: string }[]; error?: string };
  error: Error | null;
  /** Quotes already shown under Next report (latest guidance); listed there, counted here. */
  shownElsewhere: Set<string>;
}) {
  const ps = data?.promises ?? [];
  const cred = credibility(ps);
  const groups = groupPromises(ps);
  const calls = data?.calls ?? [];
  const caption = calls.length
    ? `${ps.length} commitments from ${calls.length} earnings calls, ${fmtDate(calls[0].date)} to ${fmtDate(calls[calls.length - 1].date)}, graded against later calls. Every quote is checked word for word against its transcript.`
    : "Commitments from the last five earnings calls, graded against later calls.";
  return (
    <Section id="promises" name="Promise tracker" title="Promises" caption={caption}>
      {loading ? (
        <Quiet>Reading the last five earnings calls. The first load for a company takes about a minute.</Quiet>
      ) : error || data?.error ? (
        <Quiet>{error?.message ?? data?.error}</Quiet>
      ) : !ps.length ? (
        <Quiet>No verifiable commitments in the recent calls.</Quiet>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-muted-foreground">Credibility</span>
              <span className="num text-[18px] font-semibold leading-6">{cred.score != null ? Math.round(cred.score * 100) : "–"}</span>
            </div>
            <div className="flex h-2 w-40 overflow-hidden rounded-sm bg-muted" aria-hidden>
              {(["kept", "partial", "missed"] as const).map((s) => (
                <span key={s} className={cn("h-full", s === "kept" ? "bg-positive" : s === "partial" ? "bg-muted-foreground/60" : "bg-negative")} style={{ width: `${cred.graded ? (cred[s] / cred.graded) * 100 : 0}%` }} />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {cred.score != null ? `Share of ${cred.graded} graded promises kept, a partly kept one counting half.` : "Needs three graded promises."} {cred.kept} kept, {cred.partial} partly kept, {cred.missed} missed, {cred.pending} still open.
            </p>
          </div>
          {groups.map((g) => {
            const items = g.items.filter((p) => !shownElsewhere.has(p.quote));
            const moved = g.items.length - items.length;
            return (
              <div key={g.status} data-section={`Promises ${STATUS[g.status].group.toLowerCase()}`} className="border-b last:border-b-0">
                <h3 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-secondary/40 px-4 py-1.5 text-[13px] font-semibold">
                  <span className={cn("size-2 shrink-0 rounded-full", STATUS[g.status].dot)} aria-hidden />
                  {STATUS[g.status].group}
                  <span className="num font-normal text-muted-foreground">{g.items.length}</span>
                  {moved > 0 && <span className="text-[11px] font-normal text-muted-foreground">· {moved === 1 ? "one is" : `${moved} are`} the latest guidance, under Next report</span>}
                </h3>
                <ol className="divide-y divide-border/60">
                  {items.map((p, i) => (
                    <PromiseRow key={`${p.callDate}-${i}`} p={p} />
                  ))}
                </ol>
              </div>
            );
          })}
        </>
      )}
    </Section>
  );
}

function PromiseRow({ p }: { p: TrackedPromise }) {
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-2.5 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{p.summary}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          <span className="capitalize">{p.category}</span>
          {p.deadline && <> · due {p.deadline}</>} · said on the {p.callQuarter ?? fmtDate(p.callDate)} call
        </p>
        <a
          href={quoteLink(p.callUrl, p.quote)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block border-l-2 border-border pl-2 text-[12px] leading-5 text-muted-foreground italic transition-colors duration-150 hover:text-foreground"
        >
          “{p.quote}” <ExternalLink className="inline size-3 not-italic" aria-label="Open the transcript at this quote" />
        </a>
      </div>
      <div className="min-w-0">
        {p.outcomeQuote && p.outcomeUrl && p.status === "kept" ? (
          <a
            href={quoteLink(p.outcomeUrl, p.outcomeQuote)}
            target="_blank"
            rel="noopener noreferrer"
            title={`“${p.outcomeQuote}”`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Graded on the {fmtDate(p.outcomeCallDate!)} call <ExternalLink className="size-3" />
          </a>
        ) : p.outcomeQuote && p.outcomeUrl ? (
          <>
            <p className="text-[11px] text-muted-foreground">Graded on the {fmtDate(p.outcomeCallDate!)} call</p>
            <a
              href={quoteLink(p.outcomeUrl, p.outcomeQuote)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block border-l-2 border-foreground/20 pl-2 text-[12px] leading-5 text-muted-foreground italic transition-colors duration-150 hover:text-foreground"
            >
              “{p.outcomeQuote}” <ExternalLink className="inline size-3 not-italic" aria-label="Open the transcript at this quote" />
            </a>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">No later call settles it yet.</p>
        )}
        {p.note && <p className="mt-1 text-[12px]">{p.note}</p>}
      </div>
    </li>
  );
}
