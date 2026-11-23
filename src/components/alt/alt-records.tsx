import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidenceButton } from "@/components/source/evidence-button";
import { TickerMark } from "@/components/app/ticker";
import { detail, tag } from "@/components/alt/alt-views";
import { fmtAlt, fmtDay } from "@/lib/alt/catalog";
import type { AltRow } from "@/lib/alt/query";
import { periodLabel } from "@/lib/alt/periods";
import { cn } from "@/lib/utils";

const unitWord = (u: string | null) => (u === "units" ? " units" : u === "patients" ? " pts" : "");

/**
 * A dense, paged table of alt records: one 28 px line per record (date, kind, title linking to the
 * record, amount, source). The page size stays fixed and the pager sits in the table's own footer,
 * so seeing the rest never grows or scrolls an inner box.
 */
export function AltRecords({ rows, ticker, pageSize = 8, showTicker, series, empty = "Nothing on record." }: { rows: AltRow[]; ticker?: string; pageSize?: number; showTicker?: boolean; series?: boolean; empty?: string }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, pages - 1);
  const list = rows.slice(p * pageSize, p * pageSize + pageSize);
  const today = new Date().toISOString().slice(0, 10);
  if (!rows.length) return <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[92px]" />
            {showTicker && <col className="w-[88px]" />}
            <col />
            <col className="w-[84px]" />
            <col className="w-[72px]" />
          </colgroup>
          <tbody>
            {list.map((r) => {
              const t = series ? null : tag(r);
              const d = series ? null : detail(r);
              return (
                <tr key={r.uid} className="h-7 border-t first:border-t-0 hover:bg-secondary/40">
                  <td className="num truncate pl-3.5 pr-2 text-[11px] text-muted-foreground">{series ? periodLabel(r, today, /^\d{4}-12-31$/.test(r.date ?? "") || !!r.meta?.fiscal_year) : fmtDay(r.date)}</td>
                  {showTicker && <td className="truncate pr-2"><TickerMark ticker={r.ticker} /></td>}
                  <td className="min-w-0 pr-2">
                    <div className="flex min-w-0 items-center gap-1.5" title={[r.title, d].filter(Boolean).join(" · ")}>
                      {t?.text && <span className={cn("shrink-0 rounded-[3px] border px-1 text-[10px] leading-4 first-letter:uppercase", t.tone === "neg" ? "text-negative" : t.tone === "pos" ? "text-positive" : "text-muted-foreground")}>{t.text}</span>}
                      {r.source_url && !series ? (
                        <a href={r.source_url} target="_blank" rel="noreferrer" className="group inline-flex min-w-0 items-center gap-1 hover:underline">
                          <span className="truncate">{r.title}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        </a>
                      ) : (
                        <span className="truncate">{series ? r.title : r.title}</span>
                      )}
                      {d && <span className="hidden truncate text-[11px] text-muted-foreground lg:inline">{d}</span>}
                    </div>
                  </td>
                  <td className="num truncate pr-2 text-right">{r.value != null ? `${fmtAlt(r.value, r.unit === "units" || r.unit === "patients" ? null : r.unit)}${unitWord(r.unit)}` : ""}</td>
                  <td className="pr-2 text-right">{r.source_url && <EvidenceButton ticker={ticker ?? r.ticker} title={r.title} url={r.source_url} date={r.date ?? undefined} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex h-8 items-center justify-end gap-1 border-t px-2 text-[11px] text-muted-foreground">
          <span className="num mr-1">{p * pageSize + 1}–{Math.min(rows.length, (p + 1) * pageSize)} of {rows.length.toLocaleString("en-US")}</span>
          <Button variant="ghost" size="xs" className="size-7 p-0" aria-label="Previous records" disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="ghost" size="xs" className="size-7 p-0" aria-label="Next records" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight className="size-3.5" /></Button>
        </div>
      )}
    </div>
  );
}
