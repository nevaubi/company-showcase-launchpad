import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./arc-scope.css";

/** Wrap Arc (uiarc.dev) components so their tokens resolve to the app theme. */
export function ArcScope({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("arc-scope", className)}>{children}</div>;
}
