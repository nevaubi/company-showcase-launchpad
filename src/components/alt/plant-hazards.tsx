import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { hazardLink, type CompanyHazards, type HazardKind } from "@/lib/alt/hazards";
import { plantHazardsQuery } from "@/lib/alt/hazards-query";
import { cn } from "@/lib/utils";

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Lp|Co)\b/g, (w) => w.toUpperCase());
const SEVERE = new Set<HazardKind>(["Hurricane", "Tsunami", "Earthquake", "Storm surge", "Tornado"]);
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const until = (iso: string | null) => (iso ? `until ${new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric" })}` : "");

function Chip({ kind, level, children }: { kind: HazardKind; level?: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]", SEVERE.has(kind) ? "bg-negative-soft text-negative" : "bg-warning-soft text-foreground", level === "watch" && "border border-dashed bg-transparent")}>
      {children ?? kind}
    </span>
  );
}

function PlantLines({ c }: { c: CompanyHazards }) {
  return (
    <ul className="divide-y text-[12px]">
      {c.plants.map((p) => (
        <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5">
          <span className="min-w-0">
            <span className="font-medium">{title(p.n)}</span> <span className="text-muted-foreground">{title(p.c)}, {p.s}</span>
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            {p.hazards.map((h) => (
              <a key={h.id + h.event} href={hazardLink(h, p)} target="_blank" rel="noreferrer" className="inline-flex" title={h.by === "polygon" ? "Inside the warning's storm outline" : h.by === "zone" ? "The warning covers this plant's NWS forecast zone" : h.by === "county" ? "The warning names this plant's county" : `${h.distanceKm} km from the epicentre`}>
                <Chip kind={h.kind} level={h.level}>
                  {h.event}
                  {h.distanceKm != null ? ` · ${h.distanceKm} km` : ""} <span className="text-muted-foreground">{until(h.ends)}</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </Chip>
              </a>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cross-company view: covered companies whose EPA-listed US plants sit under a live NWS warning or near a recent quake. */
export function PlantHazardsPanel({ className }: { className?: string }) {
  const q = useQuery(plantHazardsQuery());
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<HazardKind | null>(null);
  const d = q.data;
  const rows = (d?.companies ?? []).filter((c) => !kind || c.kinds.includes(kind));
  const plants = rows.reduce((n, c) => n + c.plants.length, 0);
  return (
    <Panel
      className={className}
      collapse={480}
      bodyClassName="p-0"
      title="Plants under live warnings"
      subtitle={d ? `National Weather Service warnings and this week's M4.5+ USGS quakes at ${d.plants.toLocaleString()} EPA-listed US plants of covered companies · checked ${time(d.asOf)}` : "National Weather Service warnings and USGS quakes at covered companies' US plants"}
    >
      {q.isLoading ? (
        <div className="space-y-2 p-3.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : q.isError || !d ? (
        <p className="p-3.5 text-[12px] text-muted-foreground">The live hazard feeds couldn't be read just now; this retries every few minutes.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3.5 py-2.5 text-[12px]">
            {d.kinds.length === 0 ? (
              <span className="text-muted-foreground">No covered plant is under an active warning or near a recent quake.</span>
            ) : (
              <>
                <button type="button" onClick={() => setKind(null)} className={cn("rounded-full border px-2.5 py-0.5", !kind ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>All · {d.companies.length} cos</button>
                {d.kinds.map((k) => (
                  <button key={k.kind} type="button" onClick={() => setKind(kind === k.kind ? null : k.kind)} className={cn("rounded-full border px-2.5 py-0.5", kind === k.kind ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>
                    {k.kind} · {k.plants} plants · {k.companies} cos
                  </button>
                ))}
              </>
            )}
            {d.errors.length > 0 && <span className="ml-auto text-[11px] text-warning">Not reachable now: {d.errors.join(", ")}</span>}
          </div>
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="border-b text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3.5 py-2 font-medium">Company</th>
                    <th className="px-2 py-2 text-right font-medium">Plants</th>
                    <th className="px-2 py-2 font-medium">Hazards</th>
                    <th className="hidden px-2 py-2 font-medium md:table-cell">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const isOpen = open === c.ticker;
                    const states = [...new Set(c.plants.map((p) => p.s))];
                    return (
                      <Fragment key={c.ticker}>
                        <tr className={cn("cursor-pointer border-b last:border-0 hover:bg-secondary/60", isOpen && "bg-secondary/60")} onClick={() => setOpen(isOpen ? null : c.ticker)}>
                          <td className="px-3.5 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              <Link to="/app/companies/$ticker/alt-data" params={{ ticker: c.ticker }} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">{c.ticker}</Link>
                            </span>
                          </td>
                          <td className="num px-2 text-right">{c.plants.length}</td>
                          <td className="px-2 py-1.5"><span className="flex flex-wrap gap-1">{c.kinds.map((k) => <Chip key={k} kind={k} />)}</span></td>
                          <td className="hidden max-w-[14rem] truncate px-2 text-muted-foreground md:table-cell">{states.slice(0, 6).join(", ")}{states.length > 6 ? ` +${states.length - 6}` : ""}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b bg-secondary/30">
                            <td colSpan={4} className="px-3.5 py-1"><PlantLines c={c} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">{plants} plants listed. Storm-drawn warnings count a plant only inside the storm's outline, area warnings only if they list the plant's own forecast zone. A warning is not a reported outage.</p>}
        </>
      )}
    </Panel>
  );
}

/** One company's plants under live hazards, shown inside its Plants panel. */
export function CompanyPlantHazards({ ticker }: { ticker: string }) {
  const q = useQuery(plantHazardsQuery(ticker));
  const c = q.data?.companies[0];
  if (q.isLoading) return <Skeleton className="mx-3.5 mt-3 h-8" />;
  if (q.isError || !q.data) return null;
  if (!c)
    return <p className="mx-3.5 mt-3 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground">No live National Weather Service warning or recent quake at these plants · checked {time(q.data.asOf)}</p>;
  return (
    <div className="mx-3.5 mt-3 rounded-md border border-warning/40 bg-warning-soft/40 px-2.5 py-1.5" data-section="Live plant warnings">
      <p className="flex items-center gap-1.5 text-[12px] font-medium">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        {c.plants.length} plant{c.plants.length === 1 ? "" : "s"} under live warnings now
        <span className="font-normal text-muted-foreground">· NWS / USGS · checked {time(q.data.asOf)}</span>
      </p>
      <PlantLines c={c} />
    </div>
  );
}
