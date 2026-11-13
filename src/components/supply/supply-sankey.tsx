// Supply flow: suppliers → company → customers as an Arc Sankey sized by the dollar figure each filing
// states, with the parties behind it listed underneath. Hover a node or ribbon to trace its share
// through the company; pick a row to open its filing evidence.
import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import "@/components/fu-landing/components/arc/foundation.css";
import { SankeyFlow } from "@/components/fu-landing/components/arc/sankey-flow/sankey-flow";
import SegmentedControl from "@/components/fu-landing/components/arc/segmented-control/segmented-control";
import { CompanyLogo } from "@/components/app/company-logo";
import type { GraphNode } from "@/lib/supply/core";
import { buildSupplySankey, flowParties, type FlowParty } from "@/lib/supply/flow";
import { fmtCompactUsd } from "@/lib/format";
import styles from "./supply-sankey.module.css";

type Show = "all" | "supplier" | "customer";

/** True when at least one supplier or customer has a dollar figure, so there is a flow to draw. */
export function hasSupplyFlow(graph: GraphNode[], revenue: Record<string, number | undefined>) {
  return flowParties(graph, revenue).some((p) => p.dollars != null);
}

export function SupplySankey({
  ticker,
  focusName,
  graph,
  revenue,
  selected,
  onSelect,
}: {
  ticker: string;
  focusName: string;
  graph: GraphNode[];
  revenue: Record<string, number | undefined>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [show, setShow] = useState<Show>("all");
  const parties = useMemo(() => flowParties(graph, revenue), [graph, revenue]);
  const flow = useMemo(() => buildSupplySankey(focusName, parties), [focusName, parties]);
  const listed = parties.filter((p) => show === "all" || p.relation === show);
  const top = Math.max(1, ...parties.map((p) => p.dollars ?? 0));
  const counts = { supplier: parties.filter((p) => p.relation === "supplier").length, customer: parties.filter((p) => p.relation === "customer").length };
  if (!flow) return null;

  return (
    <section className="fu-landing" data-accent="blue" aria-label={`${focusName} supply flow`} style={{ height: "100%" }}>
      <div className={styles.root}>
        <header className={styles.head}>
          <div className={styles.title}>
            <CompanyLogo ticker={ticker} size="md" />
            <div>
              <h2>Who {focusName} buys from and sells to, in dollars</h2>
              <p>Ribbon width is the figure each filing states. Hover a name or ribbon to trace it through the company.</p>
            </div>
          </div>
          <SegmentedControl
            label="Parties listed"
            value={show}
            onValueChange={(v) => setShow(v as Show)}
            options={[
              { value: "all", label: "All" },
              { value: "supplier", label: `Suppliers ${counts.supplier}` },
              { value: "customer", label: `Customers ${counts.customer}` },
            ]}
          />
        </header>

        <div className={styles.plot}>
          <SankeyFlow
            nodes={flow.nodes}
            links={flow.links}
            label={`Dollars flowing from ${focusName}'s suppliers, through ${focusName}, to its customers`}
            columns={flow.columns}
            totalLabel="disclosed dollars"
            formatValue={(v) => fmtCompactUsd(v)}
            height={300}
          />
        </div>

        <div className={styles.list}>
          {listed.map((p) => (
            <Party key={p.key} p={p} top={top} on={selected === p.key} onSelect={onSelect} />
          ))}
          <p className={styles.foot}>
            {flow.undisclosed > 0 && `${flow.undisclosed} named ${flow.undisclosed === 1 ? "relationship has" : "relationships have"} no dollar figure in the filings, so ${flow.undisclosed === 1 ? "it is" : "they are"} listed here but not drawn. `}
            Figures are as stated: some are annual sales, some are contract or booking values. Pick a row to read the sentence behind it.
          </p>
        </div>
      </div>
    </section>
  );
}

function Party({ p, top, on, onSelect }: { p: FlowParty; top: number; on: boolean; onSelect: (key: string) => void }) {
  return (
    <button type="button" className={styles.row} aria-pressed={on} onClick={() => onSelect(p.key)}>
      <span className={styles.mark}>{p.ticker ? <CompanyLogo ticker={p.ticker} size="sm" /> : <Landmark size={20} strokeWidth={1.75} aria-hidden="true" />}</span>
      <span className={styles.name}>
        <strong>
          <span>{p.name}</span>
          <span className={styles.tag}>{p.relation === "supplier" ? "Supplier" : "Customer"}</span>
          {p.sole && <span className={styles.tag}>Sole source</span>}
        </strong>
        <small>{p.detail}</small>
      </span>
      <span className={styles.value}>
        {p.dollars != null ? fmtCompactUsd(p.dollars) : p.share != null ? `${p.share}%` : "No figure"}
        {p.dollars != null ? (
          <span className={styles.bar} aria-hidden="true">
            <i style={{ width: `${Math.max(2, (p.dollars / top) * 100)}%` }} />
          </span>
        ) : (
          <small>{p.share != null ? (p.relation === "customer" ? "of revenue" : "of purchases") : "stated"}</small>
        )}
      </span>
    </button>
  );
}
