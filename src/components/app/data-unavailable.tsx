import { Link } from "@tanstack/react-router";
import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** One empty/error state for data panels: what is missing, a short reason, a retry and a link to data status. */
export function DataUnavailable({
  title,
  error,
  hint,
  onRetry,
  className,
  compact = false,
}: {
  title: string;
  error?: unknown;
  hint?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-dashed bg-muted/30 text-center",
        compact ? "p-4" : "p-8",
        className,
      )}
    >
      <CloudOff className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {hint ?? (error !== undefined ? friendlyError(error) : "Nothing to show yet.")}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link to="/app/status">Data status</Link>
        </Button>
      </div>
    </div>
  );
}
