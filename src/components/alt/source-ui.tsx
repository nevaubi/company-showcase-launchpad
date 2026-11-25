import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeSourceHref, sourceAvailability } from "@/lib/sources/presentation";
import type { SourceSnapshotSummary } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";

export const SOURCE_PANEL = "min-w-0 rounded-md border bg-card shadow-paper";
export const SOURCE_SELECT =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SourceLink({
  url,
  children = "Official source",
  className,
}: {
  url: string | null | undefined;
  children?: ReactNode;
  className?: string;
}) {
  const href = safeSourceHref(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  ) : null;
}

export function SourceStatus({ snapshot }: { snapshot: SourceSnapshotSummary | null | undefined }) {
  const status = sourceAvailability(snapshot);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status.tone === "ready"
            ? "bg-positive"
            : status.tone === "warning"
              ? "bg-warning"
              : status.tone === "pending"
                ? "bg-chart-1"
                : "bg-muted-foreground/40",
        )}
      />
      {status.label}
    </span>
  );
}

export function SourceError({ children, retry }: { children: ReactNode; retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 px-3.5 py-5 text-[13px] text-muted-foreground"
    >
      {children}
      <Button variant="outline" size="xs" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
