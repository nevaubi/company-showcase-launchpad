import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useLibrary } from "./library-data";
import { visibleRows } from "./overview";

/** The quiet line under Company signals' Datasets that leads to the Data library, with its live count. */
export function LibraryLinkRow() {
  const { lib } = useLibrary();
  const count = lib ? visibleRows(lib).length : null;
  return (
    <div className="border-t px-3.5 py-1.5">
      <Link
        to="/app/alt-data/library"
        className="inline-flex min-h-7 items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {count != null
          ? `${count.toLocaleString("en-US")} official tables from public agencies are in the Data library`
          : "Official tables from public agencies are in the Data library"}
        <ArrowRight aria-hidden className="size-3" />
      </Link>
    </div>
  );
}
