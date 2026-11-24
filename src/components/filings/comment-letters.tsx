import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight, MessageSquareQuote } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { commentsQuery, type ReviewThread } from "@/lib/filings/review";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  comments: "SEC comments",
  review_complete: "Review complete",
  response: "Company response",
  other: "Correspondence",
};

function Thread({
  t,
  topics,
  defaultOpen,
}: {
  t: ReviewThread;
  topics: Record<string, string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const title = t.form
    ? `Form ${t.form}${t.period ? ` · period ended ${fmtDate(t.period)}` : ""}`
    : (t.subject ?? "SEC review");
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/60"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
            {title}
            <Badge variant={t.status === "complete" ? "secondary" : "highlight"}>
              {t.status === "complete" ? "Closed" : "Open"}
            </Badge>
          </span>
          <span className="num block text-[11px] text-muted-foreground">
            {fmtDate(t.first)}
            {t.last !== t.first ? ` to ${fmtDate(t.last)}` : ""} · {t.rounds} round
            {t.rounds === 1 ? "" : "s"} · {t.n_comments} comment
            {t.n_comments === 1 ? "" : "s"}
          </span>
          {t.topics.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {t.topics.slice(0, 6).map((k) => (
                <span
                  key={k}
                  className="rounded bg-secondary px-1.5 py-0.5 text-[10.5px] text-secondary-foreground"
                >
                  {topics[k] ?? k}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {open && (
        <ol className="space-y-2 border-t bg-secondary/20 px-3.5 py-2.5 pl-9">
          {t.letters.map((l) => (
            <li key={l.accession} className="text-[12.5px]">
              <div className="flex items-center gap-2">
                <span className="font-medium">{KIND_LABEL[l.kind] ?? l.kind}</span>
                <span className="num text-[11px] text-muted-foreground">{fmtDate(l.filed)}</span>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Open letter on SEC.gov"
                >
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
              {(l.comments ?? []).length > 0 && (
                <ul className="mt-1 space-y-1">
                  {(l.comments ?? []).slice(0, 8).map((c) => (
                    <li key={c.n} className="text-[12px] leading-snug text-muted-foreground">
                      <span className="num mr-1 text-foreground">{c.n}.</span>
                      {c.heading && <span className="text-foreground">{c.heading}: </span>}
                      {c.text}
                    </li>
                  ))}
                  {(l.comments ?? []).length > 8 && (
                    <li className="text-[11px] text-muted-foreground">
                      {(l.comments ?? []).length - 8} more in the letter
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** SEC Division of Corporation Finance review letters and the company's replies, grouped by the filing reviewed. */
export function CommentLetters({ ticker }: { ticker: string }) {
  const q = useQuery(commentsQuery(ticker));
  const [all, setAll] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40" />;
  const threads = (q.data?.threads ?? []).filter((t) => all || t.periodic || t.rounds > 0);
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <MessageSquareQuote className="size-3.5" /> SEC comment letters
        </span>
      }
      subtitle="Staff review letters and company replies · released 20+ business days after a review closes"
      actions={
        q.data && q.data.threads.length > threads.length ? (
          <button
            onClick={() => setAll(true)}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            Show registration reviews
          </button>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {threads.length ? (
        <ul className="divide-y">
          {threads.slice(0, 12).map((t, i) => (
            <Thread
              key={t.key}
              t={t}
              topics={q.data?.topics ?? {}}
              defaultOpen={i === 0 && t.n_comments > 0}
            />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
          No released SEC review correspondence on file for this company.
        </p>
      )}
    </Panel>
  );
}
