import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, FileText, Loader2, Megaphone, Search } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { useSource } from "@/components/source/source-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { searchFilings } from "@/lib/sec.functions";
import { fmtDate, SEC_FORM_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/filings")({
  component: Filings,
});

const FILTERS = [
  { id: "all", label: "All", forms: null },
  { id: "periodic", label: "10-K / 10-Q", forms: ["10-K", "10-Q", "10-K/A", "10-Q/A"] },
  { id: "8k", label: "8-K", forms: ["8-K", "8-K/A"] },
  { id: "proxy", label: "Proxy", forms: ["DEF 14A", "DEFA14A"] },
  { id: "other", label: "Other", forms: ["ARS", "SD", "11-K", "S-8", "SC 13G", "SC 13G/A", "10-KT"] },
] as const;

function Filings() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  const { open } = useSource();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("periodic");
  const [limit, setLimit] = useState(40);
  const [q, setQ] = useState("");

  const fts = useMutation({
    mutationFn: (query: string) => searchFilings({ data: { q: query, ciks: [String(Number(company.data!.profile.cik))] } }),
  });

  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    return (company.data?.filings ?? []).filter((x) => !f.forms || (f.forms as readonly string[]).includes(x.form));
  }, [company.data, filter]);

  if (!company.data) return <Skeleton className="h-[600px]" />;
  const d = company.data;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel
        title="SEC filings"
        subtitle={`${d.filings.length.toLocaleString()} filings indexed from EDGAR · click to read in the panel`}
        actions={
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => (setFilter(f.id), setLimit(40))}
                className={cn("rounded px-2 py-1 text-xs", filter === f.id ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary")}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Form</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 font-medium">Period</th>
              <th className="px-2 py-2 font-medium">Filed</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((f) => (
              <tr key={f.accn} className="group border-b last:border-0 hover:bg-secondary/60">
                <td className="px-4 py-2">
                  <Badge variant="outline">{f.form}</Badge>
                </td>
                <td className="max-w-[22rem] px-2 py-2">
                  <button
                    className="block w-full truncate text-left hover:underline"
                    onClick={() => open({ ticker, label: SEC_FORM_LABEL[f.form] ?? f.form, periodLabel: f.report ?? f.filed, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, title: f.desc } })}
                  >
                    {f.items?.includes("2.02") ? "Results of operations and financial condition" : SEC_FORM_LABEL[f.form] ?? f.desc ?? f.form}
                    {f.items && <span className="ml-1.5 text-[11px] text-muted-foreground">Items {f.items}</span>}
                  </button>
                </td>
                <td className="num px-2 py-2 text-xs text-muted-foreground">{f.report ? fmtDate(f.report) : "—"}</td>
                <td className="num px-2 py-2 text-xs">{fmtDate(f.filed)}</td>
                <td className="px-4 py-2 text-right">
                  <a
                    href={`https://www.sec.gov/Archives/edgar/data/${Number(d.profile.cik)}/${f.accn.replace(/-/g, "")}/${f.accn}-index.htm`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    aria-label="Open filing index on SEC.gov"
                  >
                    <ArrowUpRight className="size-3.5" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > limit && (
          <div className="border-t p-3 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 60)}>
              Show more ({list.length - limit} remaining)
            </Button>
          </div>
        )}
      </Panel>

      <div className="grid content-start gap-5">
        <Panel
          title={
            <span className="flex items-center gap-1.5">
              <Megaphone className="size-3.5" /> Earnings releases
            </span>
          }
          subtitle="8-K Item 2.02 · Exhibit 99.1 press releases"
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {d.earningsReleases.map((r) => (
              <li key={r.accn}>
                <button
                  onClick={() => open({ ticker, label: "Earnings press release", periodLabel: fmtDate(r.filed), unit: "usd", value: 0, doc: { accn: r.accn, doc: r.doc, title: `Exhibit 99.1 · ${r.doc}` } })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px]">Results for period ended {fmtDate(r.report ?? r.filed)}</span>
                    <span className="num block truncate text-[11px] text-muted-foreground">
                      filed {fmtDate(r.filed)} · {r.doc}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Full-text search" subtitle="EDGAR full-text search across this company's filings since 2001">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length > 1) fts.mutate(q.trim());
            }}
            className="flex gap-2"
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. "supply constraints" or tariffs' />
            <Button type="submit" disabled={fts.isPending}>
              {fts.isPending ? <Loader2 className="animate-spin" /> : <Search />}
            </Button>
          </form>
          {fts.isError && <p className="mt-3 text-sm text-negative">{(fts.error as Error).message}</p>}
          {fts.data && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{fts.data.total.toLocaleString()} matching documents</p>
              <ul className="mt-2 divide-y rounded-md border">
                {fts.data.hits.map((h) => (
                  <li key={`${h.accn}-${h.doc}`}>
                    <button
                      onClick={() =>
                        open({
                          ticker,
                          label: `Search: ${q}`,
                          periodLabel: fmtDate(h.filed),
                          unit: "usd",
                          value: 0,
                          doc: { accn: h.accn, doc: h.doc, title: `${h.form} · ${h.description ?? h.doc}`, search: q.replace(/^"|"$/g, "") },
                        })
                      }
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-secondary"
                    >
                      <Badge variant="outline">{h.form}</Badge>
                      <span className="min-w-0 flex-1 truncate">{h.description ?? h.doc}</span>
                      <span className="num text-[11px] text-muted-foreground">{fmtDate(h.filed)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
