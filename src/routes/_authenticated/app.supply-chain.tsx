import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRight, FileText, Network } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, RELATION_COLOR, RELATION_LABEL } from "@/components/supply/supply-map-meta";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { supabase } from "@/integrations/supabase/client";
import { useUniverse } from "@/lib/data";
import { COVERAGE } from "@/lib/coverage";
import { focusGraph, RELATIONS, type GraphNode, type Relation, type SupplyLink } from "@/lib/supply/core";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SupplyMap = lazy(() => import("@/components/supply/supply-map"));

export const Route = createFileRoute("/_authenticated/app/supply-chain")({
  validateSearch: z.object({ t: z.string().max(10).optional() }),
  head: () => ({
    meta: [
      { title: "Supply chain map — Filed Under" },
      { name: "description", content: "Interactive map of each company's named customers, suppliers, partners and competitors, every link quoted from its 10-K." },
      { property: "og:title", content: "Supply chain map — Filed Under" },
      { property: "og:description", content: "Customers, suppliers, partners and competitors, every link quoted from the 10-K." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplyChainPage,
});

const linksQuery = {
  queryKey: ["supply_links"],
  queryFn: async () => {
    const out: SupplyLink[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("supply_links").select("*").range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as SupplyLink[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
  staleTime: 10 * 60_000,
};

function SupplyChainPage() {
  const { t } = Route.useSearch();
  const ticker = (t ?? "NVDA").toUpperCase();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: universe } = useUniverse();
  const { data: links, isLoading } = useQuery(linksQuery);
  const [visible, setVisible] = useState<Set<Relation>>(new Set(RELATIONS));
  const [selected, setSelected] = useState<string | null>(null);
  const { open } = useSource();

  const names = useMemo(() => Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])), []);
  const covered = useMemo(() => new Set(Object.keys(names)), [names]);
  const graph = useMemo(() => focusGraph(ticker, links ?? [], names), [ticker, links, names]);
  const focus: GraphNode = { key: "focus", name: names[ticker] ?? ticker, ticker, domain: null, relation: "focus", links: [] };
  const sel = graph.find((n) => n.key === selected) ?? null;
  const counts = Object.fromEntries(RELATIONS.map((r) => [r, graph.filter((n) => n.relation === r).length])) as Record<Relation, number>;

  const go = (tk: string) => {
    setSelected(null);
    navigate({ search: { t: tk } });
  };
  const toggle = (r: Relation) =>
    setVisible((v) => {
      const n = new Set(v);
      n.has(r) ? n.delete(r) : n.add(r);
      return n;
    });

  return (
    <div>
      <PageHeader
        eyebrow="Markets"
        title="Supply chain map"
        description="Who each company sells to, buys from, works with and competes against, as named in its latest 10-K. Click a company to see the sentence it comes from."
        actions={
          <Select value={ticker} onValueChange={go}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(universe?.companies ?? []).map((c) => (
                <SelectItem key={c.ticker} value={c.ticker}>
                  {c.ticker} · {names[c.ticker] ?? c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {RELATIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => toggle(r)}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-opacity", !visible.has(r) && "opacity-40")}
          >
            <span className="size-2.5 rounded-full" style={{ background: RELATION_COLOR[r] }} />
            {RELATION_LABEL[r]} <span className="num text-muted-foreground">{counts[r]}</span>
          </button>
        ))}
        <span className="self-center text-xs text-muted-foreground">Line thickness = share of revenue or purchases, when the filing states it.</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[620px] min-w-0 overflow-hidden rounded-xl border bg-card">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : graph.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Network className="size-6" />
              No named customers or suppliers found in {focus.name}'s latest 10-K yet.
            </div>
          ) : (
            <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <SupplyMap focus={focus} graph={graph} visible={visible} selected={selected} onSelect={setSelected} />
              </Suspense>
            </ClientOnly>
          )}
        </div>

        <Panel title={sel ? sel.name : "Evidence"} subtitle={sel ? `${sel.relation} of ${focus.name}` : "Select a company on the map"} className="min-w-0">
          {sel ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CompanyLogo ticker={sel.ticker ?? sel.name.slice(0, 4).toUpperCase()} src={externalLogo(sel.domain, sel.ticker)} size="lg" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{sel.name}</p>
                  <p className="text-xs text-muted-foreground">{sel.ticker ?? "Not in coverage"}</p>
                </div>
              </div>
              {sel.links.map((l) => (
                <div key={l.id} className="rounded-lg border p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">
                    From {names[l.ticker] ?? l.ticker}'s {l.form}, filed {fmtDate(l.filed)}
                    {l.share_pct != null && <span className="ml-1 text-foreground">· {l.share_pct}%</span>}
                  </p>
                  <p className="mt-1">{l.detail}</p>
                  <blockquote className="mt-2 border-l-2 border-highlight pl-2 text-xs italic text-muted-foreground">“{l.quote}”</blockquote>
                  <button
                    type="button"
                    onClick={() => open({ ticker: l.ticker, label: `${sel.name} · ${l.relation}`, unit: "usd", value: 0, doc: { accn: l.accn, doc: l.doc, form: l.form, filed: l.filed, title: `${l.ticker} ${l.form}`, search: l.quote } })}
                    className="mt-2 inline-flex items-center gap-1 rounded bg-highlight-soft px-2 py-1 text-xs font-medium text-highlight-foreground hover:bg-highlight"
                  >
                    <FileText className="size-3" /> Open in {l.form}
                  </button>
                </div>
              ))}
              {sel.ticker && covered.has(sel.ticker) && (
                <button type="button" onClick={() => go(sel.ticker!)} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                  Map {sel.name} <ArrowRight className="size-3.5" />
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {graph.slice(0, 14).map((n) => (
                <li key={n.key}>
                  <button type="button" onClick={() => setSelected(n.key)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: RELATION_COLOR[n.relation] }} />
                    <span className="truncate">{n.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{n.relation}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
