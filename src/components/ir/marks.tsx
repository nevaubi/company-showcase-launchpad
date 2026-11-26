// Quiet marks at a figure: a failed check, a figure held back, a figure another document prints differently.
import { cn } from "@/lib/utils";

/** A total whose parts don't add up, or a figure that fails a check: a small amber dot. */
export function CheckDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full bg-warning align-middle", className)} />;
}

/** A figure held back as suspect: a hollow amber ring. */
export function HeldMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full border border-warning align-middle", className)} />;
}

/** A figure another document prints differently: a hollow ring in the caption colour. */
export function AltMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full border border-muted-foreground align-middle", className)} />;
}
