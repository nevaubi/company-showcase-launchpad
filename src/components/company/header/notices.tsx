import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SinceVisitBadges } from "@/components/changes/company-changes";
import { RestrictedBanner } from "@/components/firm/coverage-chip";
import { useCoverage, useFirm } from "@/components/firm/firm-context";
import { companyChangesQuery, useCompanyVisit } from "@/lib/changes/data";

/** Longest the page body waits for the notices' answers before it is shown without them. */
export const NOTICE_WAIT_MS = 1200;

/**
 * What only some readers get, and only after their firm's coverage list and their visit history have answered:
 * the firm's restricted-list warning and what is new since the last visit. It sits at the top of the page body,
 * under the tab bar, and a reader outside any firm or on a first visit gets nothing at all: no slot is held for an
 * answer that may be "none".
 *
 * So that their arrival moves nothing a reader has in view, the page body under them is laid out (its queries run)
 * but not shown until both answers are in, at most `NOTICE_WAIT_MS`; the notices and the body then appear in one
 * step. Should a notice still arrive later, the reader who has scrolled is kept where they were.
 */
export function CompanyNotices({ ticker, children }: { ticker: string; children?: ReactNode }) {
  const settled = useNoticesSettled(ticker);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), NOTICE_WAIT_MS);
    return () => clearTimeout(id);
  }, [ticker]);
  const shown = settled || timedOut;
  const box = useRef<HTMLDivElement>(null);
  useKeepReaderAbove(box, shown);
  return (
    <>
      <div ref={box} data-section="Company notices" className="empty:hidden">
        {shown && (
          <>
            <RestrictedBanner ticker={ticker} />
            <SinceVisitBadges ticker={ticker} className="mb-3" />
          </>
        )}
      </div>
      <div className={shown ? undefined : "invisible"} aria-busy={!shown || undefined} data-slot="company-body">
        {children}
      </div>
    </>
  );
}

/** True once the firm's coverage list, the visit history and the company's change file have each answered (or failed). */
function useNoticesSettled(ticker: string): boolean {
  const { firm, loading } = useFirm();
  const coverage = useCoverage(firm?.id);
  const visit = useCompanyVisit(ticker);
  const changes = useQuery(companyChangesQuery(ticker));
  const firmDone = !loading && (!firm || coverage.isFetched || coverage.isError);
  const changesDone = changes.isFetched || changes.isError;
  // without a change file there is no since-visit row, so the visit history does not matter
  const visitDone = visit.ready || (changesDone && !changes.data);
  return firmDone && changesDone && visitDone;
}

/**
 * When the notices change height after they are shown, a reader who has scrolled past their top keeps the same text
 * under their eyes (browser scroll anchoring does not hold it here).
 */
function useKeepReaderAbove(box: React.RefObject<HTMLDivElement | null>, active: boolean) {
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !active || typeof ResizeObserver === "undefined") return;
    last.current = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      const prev = last.current ?? h;
      last.current = h;
      const d = h - prev;
      if (d && window.scrollY > 0) window.scrollBy({ top: d, behavior: "instant" as ScrollBehavior });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, active]);
}
