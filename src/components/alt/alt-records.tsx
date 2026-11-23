import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidenceButton } from "@/components/source/evidence-button";
import { TickerMark } from "@/components/app/ticker";
import { detail, tag } from "@/components/alt/alt-views";
import { fmtAlt } from "@/lib/alt/catalog";
import type { AltRow } from "@/lib/alt/query";
import { periodLabel } from "@/lib/alt/periods";
import { cn } from "@/lib/utils";

/** What a series row adds beyond its value. */
function seriesDetail(r: AltRow): string {
  const m = r.meta ?? {};
  if (r.dataset === "settlement") return m.days != null ? `${m.days} trading days with fails` : "";
  if (r.dataset === "complaints") return m.products?.[0] ? `Most: ${m.products[0].product} (${Number(m.products[0].n).toLocaleString("en-US")})${m.ytd ? " · year to date" : ""}` : "";
  if (r.dataset === "attention") return "";
  return r.title;
}

const seriesPeriod = (r: AltRow, today: string) => (r.dataset === "attention" ? (r.date ?? "").slice(0, 7) : r.dataset === "complaints" ? periodLabel(r, today) : r.date ?? "");

const unitWord = (u: string | null) => (u === "units" ? " units" : u === "patients" ? " pts" : "");

/**
 * A dense, paged table of alt records: one 28 px line per record (date, kind, title linking to the
 * record, amount, source). The page size stays fixed and the pager sits in the table's own footer,
 * so seeing the rest never grows or scrolls an inner box.
 */
export function AltRecords({ rows, ticker, pageSize = 8, showTicker, series, empty = null }: { rows: AltRow[]; ticker?: string; pageSize?: number; showTicker?: boolean; series?: boolean; empty?: string | null }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, pages - 1);
  const list = rows.slice(p * pageSize, p * pageSize + pageSize);
  const today = new Date().toISOString().slice(0, 10);
  if (!rows.length) return empty ? <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{empty}</p> : null;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[82px] sm:w-[96px]" />
            {showTicker && <col className="w-[88px]" />}
            <col />
            <col className="w-[64px] sm:w-[84px]" />
            <col className="w-[36px] sm:w-[72px]" />
          </colgroup>
          <tbody>
            {list.map((r) => {
              const t0 = series ? null : tag(r);
              // an agency tag adds nothing when the title already starts with it
              const t = t0 && r.title.toLowerCase().startsWith(String(t0.text).toLowerCase()) ? null : t0;
              const d = series ? null : detail(r);
              return (
                <tr key={r.uid} className="h-7 border-t first:border-t-0 hover:bg-secondary/40">
                  <td className="num truncate pl-3 pr-1 text-[11px] text-muted-foreground sm:pl-3.5 sm:pr-2">{series ? seriesPeriod(r, today) : r.date}</td>
                  {showTicker && <td className="truncate pr-2"><TickerMark ticker={r.ticker} /></td>}
                  <td className="min-w-0 pr-2">
                    <div className="flex min-w-0 items-center gap-1.5" title={[r.title, d].filter(Boolean).join(" · ")}>
                      {t?.text && <span className={cn("hidden shrink-0 rounded-[3px] sm:inline border px-1 text-[10px] leading-4 first-letter:uppercase", t.tone === "neg" ? "text-negative" : t.tone === "pos" ? "text-positive" : "text-muted-foreground")}>{t.text}</span>}
                      {r.source_url && !series ? (
                        <a href={r.source_url} target="_blank" rel="noreferrer" className="group inline-flex min-w-0 shrink items-center gap-1 hover:underline">
                          <span className="truncate">{r.title}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        </a>
                      ) : (
                        <span className="truncate">{series ? seriesDetail(r) : r.title}</span>
                      )}
                      {d && <span className="hidden min-w-0 max-w-[40%] shrink-[3] truncate text-[11px] text-muted-foreground 2xl:inline">{d}</span>}
                    </div>
                  </td>
                  <td className="num truncate pr-2 text-right">{r.value != null ? `${fmtAlt(r.value, r.unit === "units" || r.unit === "patients" ? null : r.unit)}${unitWord(r.unit)}` : ""}</td>
                  <td className="pr-1 text-right max-sm:[&_button]:px-1 max-sm:[&_button]:text-[0px] sm:pr-2">{r.source_url && <EvidenceButton ticker={ticker ?? r.ticker} title={r.title} url={r.source_url} date={r.date ?? undefined} />}</td>
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
