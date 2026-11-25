import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { datasetHref, recordHref } from "@/lib/sources/links";
import type { RecordPointer } from "@/lib/sources/company/types";
import { cn } from "@/lib/utils";

/** A real link (new tab and copy work) that moves in place without reloading the app. */
export function AppLink({ href, className, title, children, ariaLabel }: { href: string; className?: string; title?: string; children: ReactNode; ariaLabel?: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.history.push(href);
  };
  return (
    <a href={href} onClick={onClick} title={title} aria-label={ariaLabel} className={cn("rounded-[3px] transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {children}
    </a>
  );
}

/** Opens the stored record behind a figure in the Data library, snapshot pinned. */
export function RecordLink({ at, className, title, children }: { at: RecordPointer; className?: string; title?: string; children: ReactNode }) {
  return (
    <AppLink href={recordHref(at.dataset, at.snapshot, at.row)} className={className} title={title ?? "Open the stored record"}>
      {children}
    </AppLink>
  );
}

/** Opens a dataset (snapshot pinned) in the Data library. */
export function DatasetLink({ dataset, snapshot, className, children }: { dataset: string; snapshot?: string; className?: string; children: ReactNode }) {
  return (
    <AppLink href={datasetHref(dataset, snapshot ? { snapshot } : {})} className={className} title="Open the table in the Data library">
      {children}
    </AppLink>
  );
}

/** A public page outside the app (the FDIC's own record of an institution). */
export function OutLink({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} className={cn("rounded-[3px] transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {children}
    </a>
  );
}
