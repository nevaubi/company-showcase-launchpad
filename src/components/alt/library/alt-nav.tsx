import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HrefLink } from "./href-link";
import { ALT_SECTIONS, CREDIT_PATH, altSectionFor, type AltSection } from "./sections";

const tab = (active: boolean) =>
  cn(
    "-mb-px inline-flex min-h-9 items-center whitespace-nowrap rounded-t-sm border-b-2 px-3 text-[13px] transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );

/** The Charts page of the Data library: every board's charts in one place. */
export const CHARTS_PATH = "/app/alt-data/library/charts";

/**
 * The Alt data section's tabs, as links: Company signals, Data library, Charts (every board's charts) and, once its
 * page is mounted, Securitized credit. A collection or a table page keeps "Data library" active; the Charts page
 * makes its own tab active.
 */
export function AltNav({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const charts = pathname === CHARTS_PATH || pathname.startsWith(`${CHARTS_PATH}/`);
  const active = charts ? null : altSectionFor(pathname);
  const hasCharts = Object.prototype.hasOwnProperty.call(router.routesByPath, CHARTS_PATH);
  // The credit page is its own unit's route; until it is in the route tree the tab would lead nowhere.
  const hasCredit = Object.prototype.hasOwnProperty.call(router.routesByPath, CREDIT_PATH);
  const label = (id: AltSection) => ALT_SECTIONS.find((s) => s.id === id)!.label;
  return (
    <nav
      aria-label="Alt data sections"
      data-section="Alt data sections"
      className={cn("-mx-1 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden border-b scrollbar-thin", className)}
    >
      <Link
        to="/app/alt-data"
        activeOptions={{ exact: true, includeSearch: false }}
        className={tab(active === "signals")}
      >
        {label("signals")}
      </Link>
      <Link
        to="/app/alt-data/library"
        // on the Charts page (under the library's path) the library tab is not the current one
        activeOptions={{ exact: charts, includeSearch: false }}
        className={tab(active === "library")}
      >
        {label("library")}
      </Link>
      {hasCharts && (
        <HrefLink href={CHARTS_PATH} aria-current={charts ? "page" : undefined} className={tab(charts)}>
          Charts
        </HrefLink>
      )}
      {hasCredit && (
        <HrefLink
          href={CREDIT_PATH}
          aria-current={active === "credit" ? "page" : undefined}
          className={tab(active === "credit")}
        >
          {label("credit")}
        </HrefLink>
      )}
    </nav>
  );
}
