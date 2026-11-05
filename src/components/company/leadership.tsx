import { useState } from "react";
import { Users } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { useSource } from "@/components/source/source-context";
import { useCompanyContext } from "@/lib/company/context-query";
import { commonsThumb, rankPeople, tenureYears, type Person } from "@/lib/company/context";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CreditNote } from "./about";

const TODAY = new Date().toISOString().slice(0, 10);
const initials = (n: string) => n.split(/\s+/).filter((x) => /^[A-Z]/.test(x)).map((x) => x[0]).slice(0, 2).join("");

function Avatar({ p, size = "md" }: { p: Person; size?: "md" | "lg" }) {
  const [bad, setBad] = useState(false);
  const cls = size === "lg" ? "size-20" : "size-12";
  return (
    <div className={cn("relative shrink-0", cls)}>
      {p.photo && !bad ? (
        <img src={commonsThumb(p.photo.url, 250)} alt={p.name} referrerPolicy="no-referrer" onError={() => setBad(true)} className={cn("rounded-full border object-cover object-top", cls)} loading="lazy" />
      ) : (
        <div className={cn("grid place-items-center rounded-full border bg-secondary font-display text-muted-foreground", cls, size === "lg" ? "text-2xl" : "text-sm")}>{initials(p.name)}</div>
      )}
      {p.photo && !bad && <CreditNote credit={p.photo.credit} className="absolute -bottom-1 -right-1 size-4 border" />}
    </div>
  );
}

function useOpenPerson(ticker: string) {
  const { open } = useSource();
  return (p: Person) =>
    open({ ticker, label: `${p.name} · ${p.title}`, periodLabel: `${p.source.form} filed ${fmtDate(p.source.filed)}`, unit: "usd", value: 0, doc: { accn: p.source.accn, doc: p.source.doc, form: p.source.form, title: p.source.form, search: p.quote } });
}

function Meta({ p }: { p: Person }) {
  const t = tenureYears(p.since, TODAY);
  return (
    <p className="num mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
      {p.age && <span>Age {p.age}</span>}
      {p.since && <span>{p.group === "board" ? "Director" : "In role"} since {p.since}{t ? ` · ${t}y` : ""}</span>}
      {p.pay && <span>{p.pay.year} pay {fmtCompactUsd(p.pay.total)}</span>}
    </p>
  );
}

/** Executives (CEO on top) and board, every person verified against the 10-K / proxy and clickable to it. */
export function LeadershipPanel({ ticker }: { ticker: string }) {
  const ctx = useCompanyContext(ticker);
  const openP = useOpenPerson(ticker);
  const people = ctx.data?.people ?? [];
  if (!people.length) return null;
  const { ceo, executives, board } = rankPeople(people);
  const src = [...new Set(people.map((p) => p.source.form))].join(" & ");

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5" /> Leadership & board
        </span>
      }
      subtitle={`From the latest ${src} · click anyone for the passage`}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="eyebrow mb-3">Management</p>
          {ceo && (
            <button onClick={() => openP(ceo)} className="flex w-full items-center gap-4 rounded-lg border bg-secondary/30 p-4 text-left transition-colors hover:bg-secondary">
              <Avatar p={ceo} size="lg" />
              <div className="min-w-0">
                <p className="font-display text-xl leading-tight">{ceo.name}</p>
                <p className="text-[13px]">{ceo.title}</p>
                <Meta p={ceo} />
                {ceo.bio && <p className="mt-1.5 line-clamp-2 text-[12px] text-muted-foreground">{ceo.bio}</p>}
              </div>
            </button>
          )}
          {executives.length > 0 && (
            <div className="relative mt-4 pl-5">
              <span className="absolute bottom-6 left-1.5 top-0 w-px bg-border" aria-hidden />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {executives.map((p) => (
                  <li key={p.name} className="relative">
                    <span className="absolute -left-3.5 top-7 h-px w-3 bg-border" aria-hidden />
                    <button onClick={() => openP(p)} className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-secondary">
                      <Avatar p={p} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{p.name}</p>
                        <p className="line-clamp-2 text-[11.5px] leading-snug">{p.title}</p>
                        <Meta p={p} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {board.length > 0 && (
          <div className="min-w-0">
            <p className="eyebrow mb-3">
              Board of directors · {board.length} · {board.filter((b) => b.independent).length} independent
            </p>
            <ul className="divide-y rounded-lg border">
              {board.map((p) => (
                <li key={p.name}>
                  <button onClick={() => openP(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary">
                    <Avatar p={p} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                        {p.name}
                        {p.chair && <Badge className="h-4 px-1.5 text-[10px]">Chair</Badge>}
                        {p.independent && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Independent</Badge>}
                      </p>
                      <p className="truncate text-[11.5px] text-muted-foreground">{p.title}</p>
                      <Meta p={p} />
                      {p.committees?.length ? <p className="truncate text-[10.5px] text-muted-foreground">{p.committees.join(" · ")}</p> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
