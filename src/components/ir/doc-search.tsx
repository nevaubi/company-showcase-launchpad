import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { searchDocuments, snippetParts, type DocHit } from "@/lib/ir/search";

const TYPE_LABEL: Record<string, string> = {
  release: "Release",
  supplement: "Supplement",
  presentation: "Presentation",
  transcript: "Transcript",
  remarks: "Remarks",
  annual_report: "Annual report",
  other: "Document",
};

function Hit({ h, showTicker }: { h: DocHit; showTicker: boolean }) {
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {showTicker && <Badge variant="mono">{h.ticker}</Badge>}
        <span className="min-w-0 flex-1 truncate font-medium">
          {(h.title ?? "Document").split("||")[0]}
        </span>
        <span className="num text-[11px] text-muted-foreground">
          {TYPE_LABEL[h.doc_type ?? "other"] ?? "Document"}
          {h.fiscal_label ? ` · ${h.fiscal_label}` : ""}
          {h.published ? ` · ${fmtDate(h.published)}` : ""}
          {h.page ? ` · p. ${h.page}` : ""}
          {h.kind === "table" ? " · table" : ""}
        </span>
        {h.url && (
          <a
            href={h.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open source document"
          >
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
        {snippetParts(h.snippet).map((p, i) =>
          p.hit ? (
            <mark key={i} className="rounded-sm bg-highlight-soft px-0.5 text-foreground">
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
    </li>
  );
}

/** Search inside stored IR documents (server-side Postgres full-text search; the browser only shows results). */
export function DocSearch({ ticker }: { ticker: string }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"company" | "all">("company");
  const run = useMutation({
    mutationFn: (query: string) =>
      searchDocuments({ q: query, tickers: scope === "company" ? [ticker] : undefined, limit: 40 }),
  });
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Search className="size-3.5" /> Search inside documents
        </span>
      }
      subtitle="Releases, supplements, decks and transcripts since 2021 · quotes for phrases, OR for either, - to exclude"
      actions={
        <Segmented
          label="Scope"
          value={scope}
          onChange={(v) => setScope(v as "company" | "all")}
          options={[
            { v: "company", l: ticker },
            { v: "all", l: "All companies" },
          ]}
          size="xs"
        />
      }
      bodyClassName="p-0"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length > 1) run.mutate(q.trim());
        }}
        className="flex gap-2 border-b px-3.5 py-2.5"
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "net revenue retention" or backlog'
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" disabled={run.isPending}>
          {run.isPending ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </form>
      {run.isError && (
        <p className="px-3.5 py-3 text-sm text-negative">{(run.error as Error).message}</p>
      )}
      {run.data &&
        (run.data.length ? (
          <ul className="divide-y">
            {run.data.map((h) => (
              <Hit
                key={`${h.doc_id}-${h.kind}-${h.page}-${h.rank}`}
                h={h}
                showTicker={scope === "all"}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3.5 py-3 text-sm text-muted-foreground">No matches.</p>
        ))}
    </Panel>
  );
}
