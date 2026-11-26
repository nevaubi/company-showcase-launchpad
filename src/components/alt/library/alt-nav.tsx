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

/**
 * The Alt data section's tabs, as links: Company signals, Data library and, once its page is mounted,
 * Securitized credit. A collection or a table page keeps "Data library" active.
 */
export function AltNav({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const active = altSectionFor(pathname);
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
        activeOptions={{ exact: false, includeSearch: false }}
        className={tab(active === "library")}
      >
        {label("library")}
      </Link>
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
