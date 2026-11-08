import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { form144Query, NOTICE_STATUS, type Form144Notice } from "@/lib/filings/review";
import { fmtCompactUsd, fmtDate, fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All notices" },
  { id: "open", label: "Open" },
  { id: "discretionary", label: "No 10b5-1 plan" },
] as const;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-3.5 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num text-[15px] font-semibold tracking-tight">{value}</div>
      {note && <div className="truncate text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function StatusBadge({ n }: { n: Form144Notice }) {
  const s = NOTICE_STATUS[n.status];
  if (n.status === "executed" && n.executed) {
    return (
      <Badge variant="secondary" title={`Form 4 sales ${n.executed.first} to ${n.executed.last}`}>
        Sold
        {n.executed.filled_pct != null
          ? ` ${Math.min(n.executed.filled_pct, 999).toFixed(0)}%`
          : ""}
      </Badge>
    );
  }
  return <Badge variant={s.tone === "warn" ? "highlight" : "outline"}>{s.label}</Badge>;
}

/** Form 144 notices of proposed sales, matched to the Form 4 sales that executed them. */
export function Form144Panel({ ticker }: { ticker: string }) {
  const q = useQuery(form144Query(ticker));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [limit, setLimit] = useState(40);
  const rows = useMemo(() => {
    const all = q.data?.notices ?? [];
    if (filter === "open") return all.filter((n) => n.status === "open");
    if (filter === "discretionary") return all.filter((n) => !n.plan);
    return all;
  }, [q.data, filter]);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data)
    return (
      <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No Form 144 notices on file for this company in the last year.
      </p>
    );
  const s = q.data.summary;

  return (
    <div className="grid gap-4">
      <Panel
        title="Proposed insider sales"
        subtitle="Form 144 notices filed before an affiliate sells restricted or control stock"
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
          <Stat
            label="Open notices"
            value={fmtCompactUsd(s.open.value)}
            note={
              s.open.n
                ? `${s.open.n} notice${s.open.n === 1 ? "" : "s"} · ${s.open.people.slice(0, 2).join(", ")}`
                : "none awaiting a Form 4"
            }
          />
          <Stat
            label="Last 30 days"
            value={fmtCompactUsd(s.d30.value)}
            note={`${s.d30.n} notices · ${s.d30.people} people`}
          />
          <Stat
            label="Last 90 days"
            value={fmtCompactUsd(s.d90.value)}
            note={`${s.d90.n} notices · ${s.d90.people} people`}
          />
          <Stat
            label="Under 10b5-1 plans"
            value={s.d365.plan_share != null ? `${Math.round(s.d365.plan_share * 100)}%` : "—"}
            note={`of ${s.d365.n} notices in 12 months`}
          />
        </div>
      </Panel>

      <Panel
        title="Notices"
        subtitle="Status compares each notice with Form 4 open-market sales by the same person within 14 days"
        actions={
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => (setFilter(f.id), setLimit(40))}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  filter === f.id
                    ? "bg-ink text-ink-foreground"
                    : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">Filed</th>
                <th className="px-2 py-2 font-medium">Seller</th>
                <th className="px-2 py-2 text-right font-medium">Value</th>
                <th className="px-2 py-2 text-right font-medium">Shares</th>
                <th className="px-2 py-2 font-medium">Expected sale</th>
                <th className="px-2 py-2 font-medium">Plan</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-3.5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((n) => (
                <tr
                  key={n.accession}
                  className="group border-b last:border-0 hover:bg-secondary/60"
                >
                  <td className="num whitespace-nowrap px-3.5 py-2">{fmtDate(n.filed)}</td>
                  <td className="max-w-[16rem] px-2 py-2">
                    <span className="block truncate">{n.person ?? "—"}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[n.relationship, n.how].filter(Boolean).join(" · ") || "Affiliate"}
                    </span>
                  </td>
                  <td className="num px-2 py-2 text-right">{fmtCompactUsd(n.value)}</td>
                  <td className="num px-2 py-2 text-right text-muted-foreground">
                    {fmtInt(n.shares)}
                    {n.pct_outstanding != null && n.pct_outstanding >= 0.01 && (
                      <span className="block text-[11px]">
                        {n.pct_outstanding.toFixed(2)}% of shares
                      </span>
                    )}
                  </td>
                  <td className="num whitespace-nowrap px-2 py-2 text-muted-foreground">
                    {fmtDate(n.sale_date)}
                  </td>
                  <td className="px-2 py-2">
                    {n.plan ? (
                      <span
                        className="text-[11px] text-muted-foreground"
                        title="Rule 10b5-1 plan adoption date stated on the notice"
                      >
                        10b5-1 · {fmtDate(n.plan_adopted[0], { month: "short", year: "numeric" })}
                      </span>
                    ) : (
                      <Badge variant="outline">Discretionary</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge n={n} />
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    {n.url && (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        aria-label="Open Form 144 on SEC.gov"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                    No notices match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div className="border-t p-2 text-center">
            <button
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
              onClick={() => setLimit((l) => l + 60)}
            >
              Show more ({rows.length - limit} remaining)
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
