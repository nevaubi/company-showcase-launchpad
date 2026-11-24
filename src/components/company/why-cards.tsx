// Three headline figures that explain their own change: revenue by reported segment, operating income line
// by line, free cash flow from operations and capital spending. The text and the drivers are computed from
// the filings (src/lib/company/why.ts); no model is called, so there is nothing here the statements don't say.
import { useMemo } from "react";
import { FileText, Sigma } from "lucide-react";
import "@/components/fu-landing/components/arc/foundation.css";
import { AiInsightCard } from "@/components/fu-landing/components/arc/blocks/ai-insight-card/ai-insight-card";
import { whyCards, type Why } from "@/lib/company/why";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtCompactUsd } from "@/lib/format";
import styles from "./why-cards.module.css";

const THINKING: Record<Why["id"], string> = {
  revenue: "Reading the segment notes",
  operatingIncome: "Walking down the income statement",
  fcf: "Reading the cash flow statement",
};

/** Compact dollars that fit the card's delta column: $96.2B, $782M. */
const money = (v: number) => (Math.abs(v) >= 1e9 || Math.abs(v) < 1e6 ? fmtCompactUsd(v) : `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v) / 1e6)}M`);

const METHOD = { label: "Computed, no model", icon: <Sigma size={14} aria-hidden="true" /> };

export function WhyCards({ data }: { data: CompanyDataset }) {
  const cards = useMemo(() => whyCards(data), [data]);
  if (!cards.length) return null;
  return (
    <section className="fu-landing" data-accent="blue" aria-label="Why the headline figures moved" data-section="Why it moved">
      <div className={styles.grid} data-count={cards.length}>
        {cards.map((w) => (
          <AiInsightCard
            key={w.id}
            className={styles.card}
            metric={{ ...w.metric, seriesLabel: "Last eight quarters", previousSeriesLabel: "A year earlier", format: money }}
            insight={w.insight}
            // The first breakdown is what Explain shows, so only the others are offered as follow-ups.
            followUps={w.followUps.slice(1)}
            autoPlay={false}
            thinkingLabel={THINKING[w.id]}
            source={{ label: w.source, icon: <FileText size={14} aria-hidden="true" /> }}
            model={METHOD}
          />
        ))}
      </div>
    </section>
  );
}
