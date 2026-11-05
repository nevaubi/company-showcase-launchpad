import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DATASETS, fmtAlt, type AltRow } from "@/lib/alt/query";

const fmtD = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function tag(r: AltRow): { text: string; tone?: "neg" | "pos" } | null {
  const m = r.meta ?? {};
  if (r.dataset === "ownership") return { text: m.activist ? "13D · activist" : "13G · passive", tone: m.activist ? "neg" : undefined };
  if (r.dataset === "events") return { text: m.category, tone: ["restatement", "impairment", "cyber", "audit", "listing"].includes(m.category) ? "neg" : undefined };
  if (r.dataset === "fda") return { text: m.kind === "approval" ? "approval" : `${m.kind}${m.class ? ` · ${m.class}` : ""}`, tone: m.kind === "approval" ? "pos" : "neg" };
  if (r.dataset === "regulatory") return { text: m.type ?? "document" };
  if (r.dataset === "contracts") return { text: m.sub_agency ?? m.agency ?? "award" };
  if (r.dataset === "recalls") return { text: m.component ?? "recall", tone: "neg" };
  if (r.dataset === "capital") return { text: m.form ?? m.category };
  if (r.dataset === "trials") return { text: [m.phase?.replace(/PHASE/g, "Ph "), m.status?.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(" · "), tone: /TERMINATED|WITHDRAWN|SUSPENDED/.test(m.status ?? "") ? "neg" : /COMPLETED/.test(m.status ?? "") ? "pos" : undefined };
  if (r.dataset === "consumer") return { text: m.role === "retailer" ? "sold at its stores" : m.product ?? "own product", tone: m.role === "retailer" ? undefined : "neg" };
  return null;
}

function detail(r: AltRow): string | null {
  const m = r.meta ?? {};
  if (r.dataset === "ownership") return (m.filers ?? []).slice(1).join(", ") || null;
  if (r.dataset === "regulatory") return [(m.agencies ?? []).join(", "), m.abstract].filter(Boolean).join(" — ") || null;
  if (r.dataset === "fda") return m.reason || null;
  if (r.dataset === "recalls") return m.summary || null;
  if (r.dataset === "trials") return [m.nct, (m.conditions ?? []).join(", "), m.primary_completion ? `primary completion ${m.primary_completion}` : null].filter(Boolean).join(" · ") || null;
  if (r.dataset === "consumer") return m.hazard || null;
  if (r.dataset === "contracts" && m.action) return `${m.action === "new award" ? "New award" : `Modification ${m.mod}`} · ${m.award_id}`;
  if (r.dataset === "contracts") return m.award_id ? `Award ${m.award_id}${m.end ? ` · ends ${fmtD(m.end)}` : ""}` : null;
  return null;
}

export function AltEventList({ rows, showTicker, max = 200 }: { rows: AltRow[]; showTicker?: boolean; max?: number }) {
  const [n, setN] = useState(60);
  const list = rows.slice(0, Math.min(n, max));
  if (!rows.length) return <p className="px-4 py-6 text-sm text-muted-foreground">Nothing on record yet.</p>;
  return (
    <div>
      <ul className="divide-y">
        {list.map((r) => {
          const t = tag(r); const d = detail(r);
          return (
            <li key={r.uid} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 px-4 py-2.5 text-[13px]">
              <span className="num pt-0.5 text-[11px] text-muted-foreground">{fmtD(r.date)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {showTicker && (
                    <Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="font-medium hover:underline">{r.ticker}</Link>
                  )}
                  {t?.text && <Badge variant="outline" className={cn("text-[10px] capitalize", t.tone === "neg" && "text-negative", t.tone === "pos" && "text-positive")}>{t.text}</Badge>}
                  {r.value != null && <span className="num text-[12px] font-medium">{fmtAlt(r.value, r.unit)}{r.unit === "units" ? " units" : r.unit === "patients" ? " patients" : ""}</span>}
                </div>
                <a href={r.source_url ?? undefined} target="_blank" rel="noreferrer" className="group mt-0.5 flex items-start gap-1 leading-snug hover:underline">
                  <span className="line-clamp-2">{r.title}</span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-40 group-hover:opacity-100" />
                </a>
                {d && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{d}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > list.length && list.length < max && (
        <button className="w-full border-t px-4 py-2 text-[12px] underline" onClick={() => setN((x) => x + 100)}>Show more ({rows.length - list.length} left)</button>
      )}
    </div>
  );
}

export function AltSeriesChart({ rows, bar }: { rows: AltRow[]; bar?: boolean }) {
  const data = useMemo(() => rows.map((r) => ({ d: r.date!.slice(0, bar ? 4 : 7), v: r.value })), [rows, bar]);
  const unit = rows[0]?.unit ?? null;
  const Chart = bar ? BarChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="d" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={24} />
        <YAxis width={56} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => fmtAlt(v, unit)} />
        <Tooltip formatter={(v: number) => fmtAlt(v, unit)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
        {bar ? <Bar dataKey="v" fill="var(--chart-1)" /> : <Line dataKey="v" stroke="var(--chart-1)" dot={false} strokeWidth={1.5} />}
      </Chart>
    </ResponsiveContainer>
  );
}

export function datasetLabel(d: string) {
  return DATASETS[d]?.label ?? d;
}
