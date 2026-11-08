import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { partnerFile } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tables parsed server-side from stored IR documents (pipeline: etl/docling_ingest.py, Docling layout + TableFormer). */
interface DocTablesIndex {
  ticker: string;
  generated: string;
  documents: {
    id: string;
    title: string | null;
    doc_type: string | null;
    url: string | null;
    pages: number | null;
    n_tables: number;
    generated: string | null;
  }[];
}

interface DocTablesFile {
  id: string;
  title: string | null;
  doc_type: string | null;
  url: string | null;
  pages: number | null;
  tables: {
    page: number | null;
    caption: string | null;
    n_rows: number;
    n_cols: number;
    header: string[][];
    rows: string[][];
  }[];
}

const TYPE_LABEL: Record<string, string> = {
  supplement: "Supplement",
  release: "Release",
  presentation: "Presentation",
  annual_report: "Annual report",
  transcript: "Transcript",
  remarks: "Remarks",
  other: "Document",
};

const NUMERIC = /^[($\-–—]*[\d,.]+%?\)?$|^[-–—]$/;

function cleanTitle(t: string | null) {
  if (!t) return "Document";
  return t
    .split("||")[0]
    .replace(/, opens in new window/gi, "")
    .trim()
    .slice(0, 120);
}

function TableView({ t }: { t: DocTablesFile["tables"][number] }) {
  const nHeader = Math.max(1, t.header.length);
  const head = t.rows.slice(0, nHeader);
  const body = t.rows.slice(nHeader);
  return (
    <div className="overflow-x-auto rounded-md border scrollbar-thin">
      <table className="w-full text-[12px]">
        <thead>
          {head.map((r, i) => (
            <tr key={i} className="border-b bg-secondary/40">
              {r.map((c, j) => (
                <th
                  key={j}
                  className={cn(
                    "whitespace-nowrap px-2 py-1.5 font-medium",
                    j ? "text-right" : "text-left",
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-2 py-1",
                    j && NUMERIC.test(c.trim())
                      ? "num whitespace-nowrap text-right"
                      : j
                        ? "text-right"
                        : "text-left",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocTables({ ticker }: { ticker: string }) {
  const idx = useQuery({
    queryKey: ["doctables", ticker],
    queryFn: () => partnerFile<DocTablesIndex>(`doctables/${ticker}/index.json`),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const docs = useMemo(() => (idx.data?.documents ?? []).filter((d) => d.n_tables > 0), [idx.data]);
  const [sel, setSel] = useState<string | null>(null);
  const current = sel ?? docs[0]?.id ?? null;
  const file = useQuery({
    queryKey: ["doctables", ticker, current],
    enabled: !!current,
    queryFn: () => partnerFile<DocTablesFile>(`doctables/${ticker}/${current}.json`),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const [shown, setShown] = useState(6);

  if (idx.isLoading) return <Skeleton className="h-40" />;
  if (!docs.length) return null;
  const f = file.data;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Table2 className="size-3.5" /> Document tables
        </span>
      }
      subtitle={`Tables read from ${docs.length.toLocaleString()} stored documents with layout and table-structure parsing on our servers`}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ul className="max-h-[560px] divide-y overflow-y-auto border-b scrollbar-thin lg:border-b-0 lg:border-r">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => (setSel(d.id), setShown(6))}
                className={cn(
                  "block w-full px-3.5 py-2 text-left hover:bg-secondary/60",
                  d.id === current && "bg-secondary",
                )}
              >
                <span className="block truncate text-[12.5px]">{cleanTitle(d.title)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {TYPE_LABEL[d.doc_type ?? "other"] ?? "Document"} · {d.n_tables} tables
                  {d.pages ? ` · ${d.pages} pages` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 space-y-3 p-3.5">
          {file.isLoading && <Skeleton className="h-64" />}
          {f && (
            <>
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-medium">{cleanTitle(f.title)}</span>
                {f.url && (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Original <ArrowUpRight className="size-3" />
                  </a>
                )}
              </div>
              {f.tables.slice(0, shown).map((t, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-[11px] text-muted-foreground">
                    {t.caption ?? `Table ${i + 1}`}
                    {t.page != null ? ` · page ${t.page}` : ""} · {t.n_rows} rows
                  </div>
                  <TableView t={t} />
                </div>
              ))}
              {f.tables.length > shown && (
                <div className="text-center">
                  <button
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
                    onClick={() => setShown((n) => n + 10)}
                  >
                    Show more tables ({f.tables.length - shown} remaining)
                  </button>
                </div>
              )}
              {idx.data?.generated && (
                <p className="text-[10.5px] text-muted-foreground">
                  Parsed {fmtDate(idx.data.generated)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
