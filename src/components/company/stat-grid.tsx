import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A grid of stat blocks with hairlines between the cells and none at the panel's edge, however the cells wrap:
 * every cell draws its right and bottom rule, and the grid is shifted a pixel so the outer ones are clipped.
 * Give the column template in `className` ("grid-cols-2 md:grid-cols-3").
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-hidden">
      <div className={cn("-mb-px -mr-px grid [&>*]:min-w-0 [&>*]:border-b [&>*]:border-r [&>*]:border-border/60", className)}>{children}</div>
    </div>
  );
}
