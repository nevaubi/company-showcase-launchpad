import { SinceVisitBadges } from "@/components/changes/company-changes";
import { RestrictedBanner } from "@/components/firm/coverage-chip";

/**
 * What only some readers get, and only after their firm's coverage list and their visit history have answered:
 * the firm's restricted-list warning and what is new since the last visit. It sits at the top of the page body,
 * under the tab bar, so its late arrival moves nothing above it (header, actions, tabs), and a reader outside
 * any firm or on a first visit gets nothing at all: no slot is held for an answer that may be "none".
 */
export function CompanyNotices({ ticker }: { ticker: string }) {
  return (
    <div data-section="Company notices" className="empty:hidden">
      <RestrictedBanner ticker={ticker} />
      <SinceVisitBadges ticker={ticker} className="mb-3" />
    </div>
  );
}
