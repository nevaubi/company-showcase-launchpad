import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DATASETS, fmtAlt, type AltRow } from "@/lib/alt/query";
import { EvidenceButton } from "@/components/source/evidence-button";
import { Button } from "@/components/ui/button";
import { TickerMark } from "@/components/app/ticker";

const fmtD = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export function tag(r: AltRow): { text: string; tone?: "neg" | "pos" } | null {
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

export function detail(r: AltRow): string | null {
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
  const [n, setN] = useState(15);
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
                    <Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><TickerMark ticker={r.ticker} link={false} /></Link>
                  )}
                  {t?.text && <Badge variant="outline" className={cn("text-[10px] capitalize", t.tone === "neg" && "text-negative", t.tone === "pos" && "text-positive")}>{t.text}</Badge>}
                  {r.value != null && <span className="num text-[12px] font-medium">{fmtAlt(r.value, r.unit)}{r.unit === "units" ? " units" : r.unit === "patients" ? " patients" : ""}</span>}
                </div>
                <a href={r.source_url ?? undefined} target="_blank" rel="noreferrer" className="group mt-0.5 flex items-start gap-1 leading-snug hover:underline">
                  <span className="line-clamp-2">{r.title}</span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-40 group-hover:opacity-100" />
                </a>
                {d && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{d}</p>}
                {r.source_url && <EvidenceButton ticker={r.ticker} title={r.title} url={r.source_url} date={r.date ?? undefined} />}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > list.length && list.length < max && (
        <Button variant="ghost" className="w-full rounded-none border-t text-xs" onClick={() => setN((x) => x + 25)}>Show 25 more ({Math.min(rows.length, max) - list.length} left)</Button>
      )}
    </div>
  );
}


/** Per-drug Medicare spending: one row per drug, the last full years plus the latest partial year. */
export function MedicareDrugTable({ ticker, rows }: { ticker: string; rows: AltRow[] }) {
  const { cols, drugs } = useMemo(() => {
    const by = new Map<string, { title: string; part: string; drug: string; generic: string; cells: Map<string, AltRow> }>();
    const colSet = new Map<string, { key: string; label: string; ytd: boolean; date: string }>();
    for (const r of rows) {
      if (!r.date || r.value == null) continue;
      const key = r.meta?.ytd ? `${r.date.slice(0, 4)}q${r.meta.quarters}` : r.date.slice(0, 4);
      colSet.set(key, { key, label: r.meta?.ytd ? `${r.date.slice(0, 4)} Q1${r.meta.quarters > 1 ? `–Q${r.meta.quarters}` : ""}` : r.date.slice(0, 4), ytd: !!r.meta?.ytd, date: r.date });
      const d = by.get(r.title) ?? { title: r.title, part: r.meta?.part === "partB" ? "B" : "D", drug: r.meta?.drug ?? r.title, generic: r.meta?.generic ?? "", cells: new Map() };
      d.cells.set(key, r);
      by.set(r.title, d);
    }
    const all = [...colSet.values()].sort((a, b) => a.date.localeCompare(b.date));
    const full = all.filter((c) => !c.ytd).slice(-3);
    const ytd = all.filter((c) => c.ytd).slice(-1);
    const cols = [...full, ...ytd];
    const lastFull = full[full.length - 1]?.key;
    const drugs = [...by.values()].sort((a, b) => (b.cells.get(lastFull ?? "")?.value ?? 0) - (a.cells.get(lastFull ?? "")?.value ?? 0));
    return { cols, drugs };
  }, [rows]);
  if (!drugs.length) return null;
  const prevFull = cols.filter((c) => !c.ytd).slice(-2);
  return (
    <div className="overflow-x-auto">
      <table className="research-table">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Drug</th>
            <th className="px-2 py-2 font-medium">Part</th>
            {cols.map((c) => <th key={c.key} className={cn("px-2 py-2 text-right font-medium", c.ytd && "text-muted-foreground")}>{c.label}</th>)}
            <th className="px-2 py-2 text-right font-medium">{prevFull.length === 2 ? `${prevFull[1].label} vs ${prevFull[0].label}` : "Change"}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {drugs.map((d) => {
            const a = prevFull[0] && d.cells.get(prevFull[0].key)?.value;
            const b = prevFull[1] && d.cells.get(prevFull[1].key)?.value;
            const chg = a && b ? b / a - 1 : null;
            const latest = [...d.cells.values()].sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""))[0];
            return (
              <tr key={d.title} className="border-b last:border-0">
                <td className="px-4 py-1.5"><span className="font-medium">{d.drug}</span>{d.generic && <span className="ml-1.5 text-[11px] text-muted-foreground">{d.generic.toLowerCase()}</span>}</td>
                <td className="px-2 text-[11px] text-muted-foreground">{d.part}</td>
                {cols.map((c) => <td key={c.key} className={cn("num px-2 text-right", c.ytd && "text-muted-foreground")}>{fmtAlt(d.cells.get(c.key)?.value ?? null, "USD")}</td>)}
                <td className={cn("num px-2 text-right", chg == null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative")}>{chg == null ? "—" : `${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(0)}%`}</td>
                <td className="px-4 text-right">{latest?.source_url && <EvidenceButton ticker={ticker} title={`Medicare ${d.part === "B" ? "Part B" : "Part D"} spending on ${d.drug}`} url={latest.source_url} date={latest.date ?? undefined} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function datasetLabel(d: string) {
  return DATASETS[d]?.label ?? d;
}
