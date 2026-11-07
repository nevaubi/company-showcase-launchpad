import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { useOpenExcerpt } from "@/components/themes/themes";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { companyThemesQuery, SECTION_LABEL, type CompanyThemeEntry } from "@/lib/themes/data";

/** The themes a company's latest 10-K or 10-Q speaks to, each opening the exact sentences and the theme page. */
export function CompanyThemes({ ticker }: { ticker: string }) {
  const q = useQuery(companyThemesQuery(ticker));
  const [sel, setSel] = useState<string | null>(null);
  const openEx = useOpenExcerpt();
  const themes = Object.entries(q.data?.themes ?? {}).sort((a, b) => b[1].n - a[1].n);
  if (!themes.length) return null;
  const cur: [string, CompanyThemeEntry] | undefined = themes.find(([id]) => id === sel);
  const latest = themes[0][1];
  return (
    <Panel
      title="Themes in its filing language"
      subtitle={`From the ${latest.form} filed ${fmtDate(latest.filed)} · counting sentences in risk factors, MD&A and business, against the prior comparable filing`}
      collapse={false}
    >
      <div className="flex flex-wrap gap-1.5">
        {themes.map(([id, t]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSel(sel === id ? null : id)}
            aria-pressed={sel === id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:bg-secondary",
              sel === id && "border-foreground/40 bg-secondary",
            )}
          >
            <span>{t.name}</span>
            <span className="num text-[11px] text-muted-foreground">{t.n}</span>
            {t.added && <span className="rounded bg-chart-1/10 px-1 text-[10px] text-chart-1">new</span>}
            {t.dropped && <span className="rounded bg-chart-4/10 px-1 text-[10px] text-chart-4">dropped</span>}
            {!t.added && !t.dropped && (t.new ?? 0) > 0 && (
              <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground">+{t.new} new</span>
            )}
          </button>
        ))}
      </div>
      {cur && (
        <div className="mt-3 grid gap-2 border-t pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
            <span>
              <span className="font-medium">{cur[1].name}</span>{" "}
              <span className="text-muted-foreground">
                {cur[1].dropped
                  ? `dropped from the ${cur[1].form} filed ${fmtDate(cur[1].filed)}; the prior comparable filing carried it`
                  : `${cur[1].n} counting sentence${cur[1].n === 1 ? "" : "s"} in the ${cur[1].form} filed ${fmtDate(cur[1].filed)}${cur[1].new != null ? `, ${cur[1].new} new vs the prior comparable filing` : ""}`}
              </span>
            </span>
            <Link to="/app/themes" search={{ t: cur[0] }} className="inline-flex items-center gap-0.5 text-[11px] text-chart-1 hover:underline">
              Theme across companies <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {cur[1].excerpts.map((e, i) => (
            <blockquote key={i} className="border-l-2 pl-2 text-[12px] leading-snug">
              <span className={cn(e.negated && "text-muted-foreground")}>“{e.text}”</span>{" "}
              <span className="text-[10px] text-muted-foreground">
                {SECTION_LABEL[e.section] ?? e.section}
                {e.negated ? " · negated or hedged" : ""}
              </span>
              <button
                type="button"
                onClick={() => openEx(ticker, cur[1], cur[1].name, e)}
                className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-chart-1 hover:underline"
              >
                open in filing <ArrowUpRight className="size-3" />
              </button>
            </blockquote>
          ))}
        </div>
      )}
    </Panel>
  );
}
