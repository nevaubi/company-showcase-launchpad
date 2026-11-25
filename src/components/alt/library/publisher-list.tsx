import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact } from "@/lib/format";
import type { PublisherRowModel } from "./overview";

/** Every publisher with its tables and records; a row opens the library filtered to that publisher. */
export function PublisherList({ rows, loading }: { rows: PublisherRowModel[]; loading?: boolean }) {
  return (
    <section data-section="Publishers" className="min-w-0 rounded-md border bg-card shadow-paper">
      <header className="flex items-baseline gap-2 border-b px-3.5 py-2">
        <h2 className="text-[14px] font-semibold tracking-tight">Publishers</h2>
        <p className="text-[11px] text-muted-foreground">{loading ? "" : `${rows.length} publishers`}</p>
      </header>
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col />
          <col style={{ width: 64 }} />
          <col style={{ width: 76 }} />
        </colgroup>
        <thead>
          <tr className="h-7 text-[11px] text-muted-foreground">
            <th scope="col" className="border-b pl-3.5 text-left font-normal">Publisher</th>
            <th scope="col" className="border-b text-right font-normal">Tables</th>
            <th scope="col" className="border-b pr-3.5 text-right font-normal" title="Records in original tables; views of another table are not added">Records</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} aria-hidden className="h-[29px]">
                  <td colSpan={3} className="border-b px-3.5">
                    <Skeleton className="h-3" />
                  </td>
                </tr>
              ))
            : rows.map((p) => (
                <tr key={p.id} className="group h-[29px]">
                  <td className="truncate border-b pl-3.5 group-last:border-b-0">
                    <Link
                      to="/app/alt-data/library"
                      search={{ pub: p.id }}
                      title={p.name}
                      className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {p.short}
                    </Link>
                  </td>
                  <td className="num border-b text-right group-last:border-b-0">{p.tables.toLocaleString("en-US")}</td>
                  <td className="num border-b pr-3.5 text-right text-muted-foreground group-last:border-b-0" title={p.records.toLocaleString("en-US")}>
                    {fmtCompact(p.records)}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </section>
  );
}
